# pi-agent

The Raspberry Pi–side half of the wall dashboard (Phase 1 in
[`FEATURE_ANALYSIS.md`](../FEATURE_ANALYSIS.md), which has the fuller
narrative — why each piece exists, and the monitor-buying advice if you
haven't picked one yet). This file is the complete, start-to-finish setup
walkthrough: a blank SD card to a working wall display, written for someone
setting up a Pi for the first time in a while.

Follow the steps in order — each one exists because skipping it causes a
specific, annoying failure, called out as it comes up.

## What you'll need

- The Raspberry Pi itself, and its power supply (the official one — a weak
  phone charger causes flaky boots).
- A microSD card, 16GB or bigger. A2-rated cards are more reliable for this
  kind of always-on use, but any decent card works.
- **Another computer** (Mac, Windows, or Linux) with an SD card slot or a
  cheap USB card reader — this is what you use to prepare the card before it
  ever goes in the Pi.
- A monitor and the right HDMI cable for your Pi model (Pi 4/5 use
  **micro-HDMI**, older Pis use full-size HDMI).
- Your Wi-Fi network name and password.

You do **not** need a keyboard or mouse for the Pi itself — step 1 sets up
Wi-Fi and remote access before the Pi ever boots, which is the whole point.

## 1. Flash Raspberry Pi OS onto the SD card

This is the step that was missing if you plugged in a truly blank card and
saw nothing on screen — an SD card with nothing written to it has no
operating system for the Pi to boot into, so it just sits there.

1. On your other computer, download **Raspberry Pi Imager** from
   [raspberrypi.com/software](https://www.raspberrypi.com/software/) and
   install it.
2. Put the SD card into that computer.
3. Open Raspberry Pi Imager:
   - **Choose Device** → your exact Pi model.
   - **Choose OS** → **Raspberry Pi OS (64-bit)** — the regular one with the
     desktop, not the "Lite" version (Lite has no GUI, and this needs one
     for the kiosk browser).
   - **Choose Storage** → the SD card. Double-check you've picked the right
     drive here — this step erases it.
4. Click the **gear icon** in the bottom-right corner (or press
   **Ctrl+Shift+X**) to open advanced options *before* writing. Set:
   - **Hostname** — e.g. `household-dashboard`. This is what lets you find
     the Pi on your network by name afterward.
   - **Enable SSH**, with a password (or your public key, if you have one).
   - **Configure wireless LAN** — your Wi-Fi network name, password, and
     country. This is what lets the Pi get online with no keyboard attached.
   - **Set username and password** for the account you'll use.
   - Locale/timezone/keyboard layout, while you're there.
   - Save.
5. Click **Write**, confirm, and wait — a few minutes.

## 2. First boot

1. Eject the card from your other computer and put it in the Pi.
2. Connect the monitor **before** powering on, and to the **right HDMI
   port** — on a Pi 4 or 5, that's the one labeled `HDMI0`, closest to the
   power connector. The other port outputs nothing by default.
3. Power on the Pi.
4. Wait. First boot resizes the filesystem to fill the card and can take a
   couple of minutes, sometimes with a reboot partway through — that's
   normal, not a hang. You should land on the desktop automatically (no
   login prompt — that's what "Set username and password" plus the default
   auto-login behavior gives you).

**If the screen is still blank after a few minutes:** check the Pi's second
LED (green, next to the red power one) — if it never flickers, the Pi isn't
reading the card at all (reseat it, or re-flash it). If it *is* flickering
but there's still no picture, it's almost always the HDMI port or the
monitor's input source — try the other HDMI port, and confirm the monitor
is on the right input.

## 3. Confirm it's online

If you set up Wi-Fi in step 1, it should already be connected — check the
network icon in the top-right of the desktop. From your other computer, try:

```sh
ssh <username>@<hostname>.local
# e.g. ssh pi@household-dashboard.local
```

This isn't required for anything below, but it means you can do the rest of
this from a real keyboard instead of one plugged into the Pi, if you'd
rather.

## 4. Confirm auto-login is on

`sudo raspi-config` → **System Options** → **Boot / Auto Login** → **Desktop
Autologin**. (Imager usually sets this for you from the username/password
you gave it in step 1 — this just confirms it, since without it boot stops
at a login prompt and nothing on this list runs automatically.)

## 5. Turn off every sleep path

There are three independent ones — missing any one leaves you with a screen
that still blanks itself:

1. `sudo raspi-config` → **Display Options** → **Screen Blanking** → **Off**.
2. Desktop-compositor idle blanking: on Wayfire (Pi 5's default), add to
   `~/.config/wayfire.ini`:
   ```ini
   [idle]
   dpms_timeout = 0
   ```
   On labwc (Pi 4's default on recent images) there's nothing enabled by
   default — just confirm nothing named `swayidle` is running
   (`pgrep swayidle` should print nothing).
3. If you somehow end up on an older X11 session instead of Wayland, add
   `xset s off -dpms s noblank` to the autostart file from step 6 below.

(The Pi has no lid and no battery, so there's no "sleep" to disable — only
screen blanking.)

## 6. Launch the dashboard in kiosk mode, automatically

This makes Chromium open full-screen, with no browser chrome, pointed at
your dashboard, every time the Pi boots — and restart itself if it crashes.

1. Create the systemd user service:
   ```sh
   mkdir -p ~/.config/systemd/user
   nano ~/.config/systemd/user/kiosk.service
   ```
2. Paste this in (replace the URL if your domain is different):
   ```ini
   [Unit]
   Description=Household dashboard kiosk
   After=graphical-session.target
   PartOf=graphical-session.target

   [Service]
   ExecStart=/usr/bin/chromium-browser \
     --kiosk \
     --noerrdialogs \
     --disable-infobars \
     --disable-session-crashed-bubble \
     --disable-features=Translate,TranslateUI \
     --check-for-update-interval=31536000 \
     --user-data-dir=%h/.dashboard-profile \
     https://household-manager.chrisbridewell.dev/dashboard
   Restart=always
   RestartSec=3

   [Install]
   WantedBy=graphical-session.target
   ```
   Save and exit (Ctrl+O, Enter, Ctrl+X in nano).
3. Enable it:
   ```sh
   systemctl --user enable --now kiosk.service
   ```
   Chromium should open full-screen within a few seconds, showing the
   pairing screen (see step 9).

Two details worth knowing, not just copying blindly:

- **`--user-data-dir` with a stable path is not optional.** The device's
  pairing credential lives in this browser profile's `localStorage` — an
  incognito or temporary profile would throw it away on every reboot and
  force you to re-pair constantly. Never add `--incognito` here.
- **If it doesn't start automatically after a reboot**, check
  `systemctl --user status kiosk.service`. A minimal image can occasionally
  need `loginctl enable-linger $USER` (run once, as your normal user) for
  user services to start alongside an auto-login desktop session.

## 7. Hide the mouse cursor

A stray arrow parked in the middle of a wall display looks broken even when
it isn't.

```sh
sudo apt update && sudo apt install -y unclutter
```

Then add it to the same autostart mechanism:
```sh
nano ~/.config/systemd/user/unclutter.service
```
```ini
[Unit]
Description=Hide the mouse cursor
After=graphical-session.target
PartOf=graphical-session.target

[Service]
ExecStart=/usr/bin/unclutter -idle 0.5 -root
Restart=always

[Install]
WantedBy=graphical-session.target
```
```sh
systemctl --user enable --now unclutter.service
```

## 8. Protect the SD card

An always-on Pi that eventually loses power (and it will) is the classic way
an SD card gets silently corrupted. This makes the filesystem read-only, with
writes going to RAM instead and vanishing on reboot — so a power cut can't
corrupt anything.

```sh
sudo raspi-config
# Performance Options -> Overlay File System -> enable, with the boot
# partition write-protected too.
```

**Important:** once this is on, changes you make to the Pi (including
anything below, or a future software update) won't survive a reboot unless
you disable the overlay first, make your change, then re-enable it. Do the
remaining steps below *before* turning this on, and remember it's there the
next time you need to touch this Pi — it's easy to forget in six months.

## 9. Install the dashboard schedule agent

`dashboard_agent.py` is what makes the wall display's backlight actually
turn on and off on a schedule — the browser tab from step 6 can dim its own
content, but it can't touch the physical backlight; only this agent, running
as its own process, can. It polls `GET /v1/devices/me` every 60 seconds and
switches the display only when the schedule mode actually changes. It's
plain Python 3 using only the standard library — no `pip install` needed.

```sh
sudo mkdir -p /opt/household-dashboard /etc/household-dashboard
sudo cp dashboard_agent.py /opt/household-dashboard/
sudo cp dashboard-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dashboard-agent
```

Confirm it's running: `systemctl status dashboard-agent`.

### Why a separate credential file

The dashboard page (step 6) pairs itself in the browser and keeps its own
credential in `localStorage` — this agent is a completely different process
and has no way to see that. Right after a successful pairing, the page POSTs
a copy to this agent over `127.0.0.1:8765` (loopback only — never reachable
from anywhere off the device), which is what writes
`/etc/household-dashboard/credentials.json`. You shouldn't need to type
anything in by hand for a normal setup — that file appears on its own once
you pair (step 10 below).

**If it doesn't appear** (e.g. the browser paired before the agent finished
starting up once): copy `credentials.example.json` to
`/etc/household-dashboard/credentials.json`, fill in the three device fields
from the pairing response (visible in the browser's dev tools Network tab if
you need to recover it, or just re-pair — pairing is idempotent, it just
creates a new device each time), and restart the service.

## 10. Pair the display

The kiosk browser from step 6 should already be showing a large pairing
code. On your phone, signed in to household-manager: **Settings → Devices**,
enter that code, give the device a name. Within a few seconds the wall
display should pick it up and start showing your household's boards.

Set a schedule for it from that same Settings → Devices page whenever you're
ready — see the main app for that, nothing further needed here on the Pi.

## Troubleshooting

- **Power LED on, nothing on screen, right after inserting a fresh
  card** — the SD card almost certainly has no OS on it yet; go back to
  step 1. (The activity LED — the second one, usually green — staying
  completely dark, never flickering, confirms this: it means the Pi isn't
  reading anything off the card at all.)
- **Still nothing after re-flashing** — wrong HDMI port (try the other one),
  wrong/loose cable, or the monitor's on the wrong input. Try powering the
  monitor on *before* the Pi, too — the HDMI handshake happens early in
  boot, and some monitors miss it if they wake up after the Pi's already
  past that point.
- **Chromium doesn't come up after a reboot** —
  `systemctl --user status kiosk.service`; see step 6's note about
  `loginctl enable-linger`.
- **Display never sleeps/wakes on schedule** —
  `systemctl status dashboard-agent`, then `journalctl -u dashboard-agent -f`
  (see Logs below). Confirm a display driver was actually detected — the
  agent logs which one (`wlr-randr`, `xset`, or `vcgencmd`) it picked at
  startup, and warns if none worked.
- **Made a change and it disappeared after a reboot** — the overlay
  filesystem from step 8 is on; disable it in `raspi-config`, redo the
  change, re-enable it.

## Logs

`journalctl -u dashboard-agent -f` — every schedule transition and any HTTP
error is logged there.
