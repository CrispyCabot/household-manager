#!/usr/bin/env python3
"""Wall-dashboard schedule agent — FEATURE_ANALYSIS.md's Phase 1, "layer 2"
of the two-layer schedule enforcement. The dashboard page itself (Dashboard.tsx)
renders a black overlay or screensaver, which is the only thing a browser can
do — this process is what actually drives the panel's backlight, because that
requires shelling out to the display stack, which a browser cannot do.

Runs as a long-lived systemd service (see dashboard-agent.service) rather
than a timer-triggered short process — simpler to reason about for a loop
this small, and avoids a fresh Python interpreter start every minute.

Stdlib only, deliberately — a fresh Raspberry Pi OS image should be able to
run this with no `pip install` step.
"""

from __future__ import annotations

import http.server
import json
import logging
import os
import select
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

CREDENTIALS_PATH = Path("/etc/household-dashboard/credentials.json")
POLL_INTERVAL_SECONDS = 60
# Loopback-only — see CredentialBridgeHandler below for why this exists at
# all. Never exposed off the device: bound to 127.0.0.1, not 0.0.0.0.
BRIDGE_PORT = 8765
# Refresh the device JWT at half its life (deviceToken.ts's
# DEVICE_TOKEN_TTL_SECONDS is 900s) — wide margin for a slow or flaky
# connection without ever operating on an expired token.
TOKEN_RENEW_MARGIN = 0.5
HTTP_TIMEOUT_SECONDS = 15
# How long a touch keeps the panel lit through a scheduled "off" window —
# kept equal to Dashboard.tsx's WAKE_OVERRIDE_MS, which makes the page show
# the real dashboard for the same stretch.
WAKE_OVERRIDE_SECONDS = 15 * 60

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dashboard-agent")


class AgentError(Exception):
    pass


def load_credentials() -> dict:
    """`{deviceId, householdId, deviceSecret, apiUrl}` — apiUrl is included here
    (rather than hardcoded) so the same script works against a staging stack
    without editing code, matching how the app itself reads VITE_API_URL."""
    try:
        raw = CREDENTIALS_PATH.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise AgentError(
            f"{CREDENTIALS_PATH} does not exist yet. Pair this display in a "
            "browser first (it writes its own credential to localStorage, "
            "not this file) — see pi-agent/README.md for how to copy it "
            "into place for this agent."
        ) from exc
    data = json.loads(raw)
    for key in ("deviceId", "householdId", "deviceSecret", "apiUrl"):
        if not data.get(key):
            raise AgentError(f"{CREDENTIALS_PATH} is missing required field '{key}'")
    return data


def http_json(url: str, method: str = "GET", body: Optional[dict] = None, token: Optional[str] = None) -> dict:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise AgentError(f"{method} {url} -> {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise AgentError(f"{method} {url} -> {exc.reason}") from exc


def fetch_device_token(creds: dict) -> tuple[str, float]:
    """Returns (token, unix_expiry). Mirrors DeviceAuthProvider.tsx's exchangeAndSchedule."""
    result = http_json(
        f"{creds['apiUrl']}/v1/devices/token",
        method="POST",
        body={"deviceId": creds["deviceId"], "householdId": creds["householdId"], "deviceSecret": creds["deviceSecret"]},
    )
    expires_in = result["expiresIn"]
    return result["token"], time.time() + expires_in * TOKEN_RENEW_MARGIN


def fetch_mode(creds: dict, token: str) -> str:
    result = http_json(f"{creds['apiUrl']}/v1/devices/me", token=token)
    return result["mode"]


# --- display driver ---------------------------------------------------------
# Tried in order; the first command that can reach the display wins. Which
# one actually works depends on the Pi model and OS release (FEATURE_ANALYSIS.md's
# "Wayland display control varies" risk) — this is deliberately a ladder,
# not a single hardcoded call.

def _session_env() -> dict[str, str]:
    """This agent runs as root under systemd, with none of the desktop
    session's environment — without WAYLAND_DISPLAY/DISPLAY, wlopm, wlr-randr
    and xset have no display to talk to and all fail. Borrows the auto-login
    user's session by finding their runtime dir under /run/user."""
    import pwd  # Unix-only; imported here so the tests can import this module anywhere

    env = dict(os.environ)
    try:
        runtime_dirs = sorted(p for p in Path("/run/user").iterdir() if p.name.isdigit() and int(p.name) >= 1000)
    except OSError:
        runtime_dirs = []
    if runtime_dirs:
        runtime_dir = runtime_dirs[0]
        env["XDG_RUNTIME_DIR"] = str(runtime_dir)
        sockets = sorted(p.name for p in runtime_dir.glob("wayland-*") if not p.name.endswith(".lock"))
        if sockets:
            env["WAYLAND_DISPLAY"] = sockets[0]
        try:
            xauthority = Path(pwd.getpwuid(int(runtime_dir.name)).pw_dir) / ".Xauthority"
            if xauthority.exists():
                env["XAUTHORITY"] = str(xauthority)
        except KeyError:
            pass
    env.setdefault("DISPLAY", ":0")
    return env


def _run(cmd: list[str], env: Optional[dict[str, str]] = None) -> bool:
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=10, env=env)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


class DisplayDriver:
    """Re-detected on every switch rather than once at startup: the agent
    normally starts before the desktop session exists (it has to — see the
    credential bridge below), so a startup probe finds nothing to talk to and
    would lock in the wrong answer for the life of the process. Switches are
    rare — schedule transitions and touch wakes — so the extra probe is free."""

    def __init__(self):
        self._last_kind: Optional[str] = None

    def _detect(self, env: dict[str, str]) -> str:
        # wlopm first: it puts the panel into DPMS standby but leaves the
        # output in the compositor's layout, so a touch on the dark screen
        # still reaches the page (which wakes itself). wlr-randr --off
        # removes the output entirely, after which the compositor may have
        # nowhere to deliver that touch — the touch watcher below still
        # relights the panel, but the page may need a second tap.
        if _run(["wlopm"], env):
            return "wlopm"
        if _run(["wlr-randr"], env):
            return "wlr-randr"
        if _run(["xset", "q"], env):
            return "xset"
        if _run(["vcgencmd", "version"], env):
            return "vcgencmd"
        return "none"

    def set_power(self, on: bool) -> None:
        env = _session_env()
        kind = self._detect(env)
        if kind != self._last_kind:
            log.info("display driver: %s", kind)
            self._last_kind = kind

        if kind == "wlopm":
            _run(["wlopm", "--on" if on else "--off", "*"], env)
        elif kind == "wlr-randr":
            output = self._wlr_output_name(env)
            _run(["wlr-randr", "--output", output, "--on" if on else "--off"], env)
        elif kind == "xset":
            _run(["xset", "dpms", "force", "on" if on else "off"], env)
        elif kind == "vcgencmd":
            _run(["vcgencmd", "display_power", "1" if on else "0"], env)
        else:
            log.warning("no working display driver found — schedule is tracked but the panel is not being switched")

    def _wlr_output_name(self, env: dict[str, str]) -> str:
        # wlr-randr needs an output name (e.g. "HDMI-A-1"); `wlr-randr` with
        # no arguments lists connected outputs. Falls back to a common
        # default if parsing fails rather than crashing the loop over it.
        try:
            result = subprocess.run(["wlr-randr"], check=True, capture_output=True, timeout=10, text=True, env=env)
            for line in result.stdout.splitlines():
                if line and not line.startswith(" "):
                    return line.split()[0]
        except Exception:
            pass
        return "HDMI-A-1"


class Panel:
    """What the panel should be doing, from two inputs: the schedule (polled
    by the main loop) and touches (from the watcher thread) — FEATURE_ANALYSIS.md's
    "Touch overrides the schedule". Locked because both threads call in, and
    only switches the driver when the answer actually changes."""

    def __init__(self, driver, clock=time.time):
        self._driver = driver
        self._clock = clock
        self._lock = threading.Lock()
        self._schedule_on: Optional[bool] = None
        self._wake_until = 0.0
        self._powered_on: Optional[bool] = None

    def set_schedule(self, on: bool) -> None:
        with self._lock:
            self._schedule_on = on
            self._apply()

    def wake(self) -> None:
        with self._lock:
            self._wake_until = self._clock() + WAKE_OVERRIDE_SECONDS
            self._apply()

    def _apply(self) -> None:
        woken = self._clock() < self._wake_until
        if woken:
            should_be_on = True
        elif self._schedule_on is None:
            return  # no schedule yet and no touch — nothing to decide on
        else:
            should_be_on = self._schedule_on

        if should_be_on != self._powered_on:
            reason = "touch" if woken and not self._schedule_on else "schedule"
            log.info("turning display %s (%s)", "on" if should_be_on else "off", reason)
            self._driver.set_power(should_be_on)
            self._powered_on = should_be_on


# --- touch wake -------------------------------------------------------------
# The page wakes itself on a tap, but it can't touch the backlight, so this
# watches the input devices directly for the same taps. Reading an evdev node
# doesn't grab it — the compositor (and so the page) still gets every event.

EV_KEY = 0x01
# The kernel-side equivalents of the page's `pointerdown`: a finger landing,
# or a mouse button going down. Movement alone doesn't count, same as the page.
WAKE_KEY_CODES = {0x110, 0x111, 0x112, 0x14A}  # BTN_LEFT, BTN_RIGHT, BTN_MIDDLE, BTN_TOUCH
# struct input_event: two native longs of timestamp, then type, code, value —
# 24 bytes on a 64-bit OS, 16 on a 32-bit one.
INPUT_EVENT = struct.Struct("llHHi")
DEVICE_RESCAN_SECONDS = 30


def contains_press(data: bytes) -> bool:
    size = INPUT_EVENT.size
    for offset in range(0, len(data) - size + 1, size):
        _sec, _usec, ev_type, code, value = INPUT_EVENT.unpack_from(data, offset)
        if ev_type == EV_KEY and code in WAKE_KEY_CODES and value == 1:
            return True
    return False


def watch_for_touches(on_press) -> None:
    devices: dict[int, str] = {}  # fd -> /dev/input path
    last_scan = 0.0
    while True:
        # Rescanned periodically so a touch cable plugged in after boot still gets picked up.
        if time.time() - last_scan >= DEVICE_RESCAN_SECONDS:
            open_paths = set(devices.values())
            for path in sorted(Path("/dev/input").glob("event*")):
                if str(path) not in open_paths:
                    try:
                        devices[os.open(path, os.O_RDONLY | os.O_NONBLOCK)] = str(path)
                    except OSError:
                        pass
            last_scan = time.time()

        if not devices:
            time.sleep(DEVICE_RESCAN_SECONDS)
            continue

        readable, _, _ = select.select(list(devices), [], [], DEVICE_RESCAN_SECONDS)
        for fd in readable:
            try:
                data = os.read(fd, INPUT_EVENT.size * 64)
            except BlockingIOError:
                continue
            except OSError:
                data = b""
            if not data:  # device unplugged
                os.close(fd)
                devices.pop(fd, None)
                continue
            if contains_press(data):
                on_press()


def start_touch_watcher(panel: Panel) -> None:
    def run() -> None:
        while True:
            try:
                watch_for_touches(panel.wake)
            except Exception:  # noqa: BLE001 - a watcher crash must never take the schedule loop with it
                log.exception("touch watcher failed — restarting")
                time.sleep(DEVICE_RESCAN_SECONDS)

    threading.Thread(target=run, daemon=True).start()
    log.info("watching input devices for touch-to-wake")


# --- credential bridge ------------------------------------------------------
# The pairing secret is delivered exactly once (routes/devices.ts's
# pollPairing deletes the pairing record the instant it's read back), and
# only the browser's poll loop ever sees it — this agent is a separate OS
# process with no way to intercept or independently re-request it without a
# second, racing pairing flow. Instead, DeviceAuthProvider.tsx POSTs its
# credential here — right after a successful claim, and again on every page
# load, so an agent installed (or wiped) after pairing still catches up — as
# a best-effort side channel: harmless to fail (e.g. running this same app in
# an ordinary browser during development, nowhere near a Pi) and nothing else
# depends on it succeeding immediately, since a stale/missing
# credentials.json just means this loop logs the error above and waits for
# the next cycle.
#
# The page is an https site calling http://127.0.0.1, so this is a
# cross-origin request: its JSON body makes Chromium send a CORS preflight
# first, and without the OPTIONS answer below the POST is never sent at all.

# Only the dashboard itself may hand over a credential — any other page the
# Pi's browser loads could otherwise overwrite it.
ALLOWED_ORIGINS = {"https://household-manager.chrisbridewell.dev"}


class CredentialBridgeHandler(http.server.BaseHTTPRequestHandler):
    def _cors_headers(self) -> bool:
        origin = self.headers.get("Origin")
        if origin not in ALLOWED_ORIGINS:
            return False
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Chromium's private/local-network-access preflight asks for this
        # before letting a public site reach a loopback address.
        self.send_header("Access-Control-Allow-Private-Network", "true")
        return True

    def do_OPTIONS(self):  # noqa: N802 - http.server's naming convention
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):  # noqa: N802 - http.server's naming convention
        if self.path != "/credential":
            self.send_response(404)
            self.end_headers()
            return
        if self.headers.get("Origin") not in ALLOWED_ORIGINS:
            log.error("rejected a credential POST from origin %r", self.headers.get("Origin"))
            self.send_response(403)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(length))
            for key in ("deviceId", "householdId", "deviceSecret", "apiUrl"):
                if not data.get(key):
                    raise ValueError(f"missing '{key}'")
            serialized = json.dumps(data)
            existing = CREDENTIALS_PATH.read_text(encoding="utf-8") if CREDENTIALS_PATH.exists() else None
            if serialized != existing:
                CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
                CREDENTIALS_PATH.write_text(serialized, encoding="utf-8")
                CREDENTIALS_PATH.chmod(0o600)
                log.info("received a new device credential from the dashboard page")
            self.send_response(204)
            self._cors_headers()
            self.end_headers()
        except Exception as exc:  # noqa: BLE001 - this must never crash the bridge thread
            log.error("rejected a credential POST: %s", exc)
            self.send_response(400)
            self._cors_headers()
            self.end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - http.server's signature
        pass  # the agent's own logger covers this; suppress the default per-request stderr line


def start_credential_bridge() -> None:
    server = http.server.HTTPServer(("127.0.0.1", BRIDGE_PORT), CredentialBridgeHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("credential bridge listening on 127.0.0.1:%d", BRIDGE_PORT)


def main() -> int:
    start_credential_bridge()
    panel = Panel(DisplayDriver())
    start_touch_watcher(panel)
    token: Optional[str] = None
    token_expiry = 0.0

    while True:
        try:
            creds = load_credentials()

            if token is None or time.time() >= token_expiry:
                token, token_expiry = fetch_device_token(creds)
                log.info("refreshed device token")

            mode = fetch_mode(creds, token)
            # 'screensaver' is rendered by the browser itself (Dashboard.tsx) —
            # only 'off' actually needs the backlight switched here. Also
            # where an expired touch wake hands back to the schedule.
            panel.set_schedule(mode != "off")

        except AgentError as exc:
            log.error(str(exc))
            # A bad/expired credential means the next token fetch should
            # start fresh rather than retry a token that will just fail
            # the same way again.
            token = None
        except Exception:
            log.exception("unexpected error in agent loop")

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
