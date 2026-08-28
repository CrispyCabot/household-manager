# pi-agent

The Raspberry Pi–side half of the wall dashboard (Phase 1 in
[`FEATURE_ANALYSIS.md`](../FEATURE_ANALYSIS.md), which has the full narrative
— hardware recommendation, kiosk setup, SD-card protection, everything. This
file is just the install steps for the one script that lives here.

`dashboard_agent.py` polls `GET /v1/devices/me` every 60 seconds and switches
the display's backlight on or off to match the schedule you set in Settings
→ Devices — the thing a browser tab can't do on its own. It's stdlib-only
Python 3, no `pip install` needed.

## Why a separate credential file

The dashboard page pairs itself in the browser and keeps its own credential
in `localStorage` — this agent is a different OS process and can't see that.
Right after a successful pairing, the page POSTs a copy to this agent over
`127.0.0.1:8765` (loopback only, never exposed off the device), which is what
`credentials.json` below gets written by. You don't need to type anything in
by hand for normal setup — only for the manual-copy fallback in step 4.

## Install

```sh
sudo mkdir -p /opt/household-dashboard /etc/household-dashboard
sudo cp dashboard_agent.py /opt/household-dashboard/
sudo cp dashboard-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dashboard-agent
```

1. Confirm it's running: `systemctl status dashboard-agent`.
2. Pair the display as normal (open the dashboard URL in kiosk Chromium,
   enter the code it shows from your phone — see `FEATURE_ANALYSIS.md`'s
   Phase 1 pairing flow). The agent picks up its credential automatically at
   that point.
3. Confirm it arrived: `sudo cat /etc/household-dashboard/credentials.json`
   should now exist, mode `0600`.
4. **If it didn't arrive** (e.g. the browser and the agent started in the
   wrong order once, and the POST landed before the agent was listening):
   copy `credentials.example.json` to
   `/etc/household-dashboard/credentials.json`, fill in the three device
   fields from the same pairing response (visible in the browser's dev tools
   Network tab if you need to recover it, or just re-pair — pairing is
   idempotent, it just creates a new device each time), and restart the
   service.

## Logs

`journalctl -u dashboard-agent -f` — every schedule transition and any HTTP
error is logged there.
