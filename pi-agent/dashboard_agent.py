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
# Tried in order; the first command that runs without error "wins" and is
# used for every subsequent call this process makes. Which one actually
# works depends on the Pi model and OS release (FEATURE_ANALYSIS.md's
# "Wayland display control varies" risk) — this is deliberately a ladder,
# not a single hardcoded call.

def _run(cmd: list[str]) -> bool:
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=10)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


class DisplayDriver:
    """Detected once at startup, then reused — avoids re-probing every minute."""

    def __init__(self):
        self._kind = self._detect()
        log.info("display driver: %s", self._kind)

    def _detect(self) -> str:
        if _run(["wlr-randr"]):
            return "wlr-randr"
        if _run(["which", "xset"]):
            return "xset"
        if _run(["which", "vcgencmd"]):
            return "vcgencmd"
        return "none"

    def set_power(self, on: bool) -> None:
        if self._kind == "wlr-randr":
            output = self._wlr_output_name()
            _run(["wlr-randr", "--output", output, "--on" if on else "--off"])
        elif self._kind == "xset":
            _run(["xset", "dpms", "force", "on" if on else "off"])
        elif self._kind == "vcgencmd":
            _run(["vcgencmd", "display_power", "1" if on else "0"])
        else:
            log.warning("no working display driver found — schedule is tracked but the panel is not being switched")

    def _wlr_output_name(self) -> str:
        # wlr-randr needs an output name (e.g. "HDMI-A-1"); `wlr-randr` with
        # no arguments lists connected outputs. Falls back to a common
        # default if parsing fails rather than crashing the loop over it.
        try:
            result = subprocess.run(["wlr-randr"], check=True, capture_output=True, timeout=10, text=True)
            for line in result.stdout.splitlines():
                if line and not line.startswith(" "):
                    return line.split()[0]
        except Exception:
            pass
        return "HDMI-A-1"


# --- credential bridge ------------------------------------------------------
# The pairing secret is delivered exactly once (routes/devices.ts's
# pollPairing deletes the pairing record the instant it's read back), and
# only the browser's poll loop ever sees it — this agent is a separate OS
# process with no way to intercept or independently re-request it without a
# second, racing pairing flow. Instead, DeviceAuthProvider.tsx POSTs its
# credential here, once, right after a successful claim, as a best-effort
# side channel: harmless to fail (e.g. running this same app in an ordinary
# browser during development, nowhere near a Pi) and nothing else depends on
# it succeeding immediately, since a stale/missing credentials.json just
# means this loop logs the error above and waits for the next cycle.

class CredentialBridgeHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 - http.server's naming convention
        if self.path != "/credential":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(length))
            for key in ("deviceId", "householdId", "deviceSecret", "apiUrl"):
                if not data.get(key):
                    raise ValueError(f"missing '{key}'")
            CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
            CREDENTIALS_PATH.write_text(json.dumps(data), encoding="utf-8")
            CREDENTIALS_PATH.chmod(0o600)
            log.info("received a new device credential from the dashboard page")
            self.send_response(204)
            self.end_headers()
        except Exception as exc:  # noqa: BLE001 - this must never crash the bridge thread
            log.error("rejected a credential POST: %s", exc)
            self.send_response(400)
            self.end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - http.server's signature
        pass  # the agent's own logger covers this; suppress the default per-request stderr line


def start_credential_bridge() -> None:
    server = http.server.HTTPServer(("127.0.0.1", BRIDGE_PORT), CredentialBridgeHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("credential bridge listening on 127.0.0.1:%d", BRIDGE_PORT)


def main() -> int:
    start_credential_bridge()
    driver = DisplayDriver()
    token: Optional[str] = None
    token_expiry = 0.0
    last_powered_on: Optional[bool] = None

    while True:
        try:
            creds = load_credentials()

            if token is None or time.time() >= token_expiry:
                token, token_expiry = fetch_device_token(creds)
                log.info("refreshed device token")

            mode = fetch_mode(creds, token)
            # 'screensaver' is rendered by the browser itself (Dashboard.tsx) —
            # only 'off' actually needs the backlight switched here.
            should_be_on = mode != "off"

            if should_be_on != last_powered_on:
                log.info("schedule mode is '%s' — turning display %s", mode, "on" if should_be_on else "off")
                driver.set_power(should_be_on)
                last_powered_on = should_be_on

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
