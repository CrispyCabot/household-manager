# household-manager

See [README.md](README.md) for layout and stack. Pushing to `main` deploys
automatically via CI (`.github/workflows/deploy.yml`) — there is no manual
`cdk deploy` step.

## Checks

- `npm run typecheck` — whole repo.
- `cd pi-agent && python -m unittest test_dashboard_agent` — the Pi agent's tests.

## The wall-dashboard Pi

A real device on the home network, and you're allowed to connect to it and
run commands on it whenever it helps. Its setup is documented step by step in
[pi-agent/README.md](pi-agent/README.md).

### Logging in

Login details live in the gitignored `.env.pi` at the repo root
(`PI_HOST`, `PI_USER`, `PI_PASSWORD`), with the originals in the gitignored
`connected-dashboards.md`. Never commit either, or copy the password into a
tracked file. If `.env.pi` is missing, recreate it from
`connected-dashboards.md`:

```sh
PI_HOST=household-dashboard-pi.local
PI_USER=<username from connected-dashboards.md>
PI_PASSWORD=<password from connected-dashboards.md>
```

Then, from the repo root (Git Bash):

```sh
scripts/pi-ssh.sh 'systemctl status dashboard-agent'      # command as the desktop user
scripts/pi-sudo.sh 'journalctl -u dashboard-agent -n 50'  # command as root
```

`pi-ssh.sh` logs in with the password through `SSH_ASKPASS` (the Pi has no
key from this machine). `pi-sudo.sh` uses stdin for sudo's password, so to
install a file, stream it to `/tmp` with `pi-ssh.sh` first and then move it
into place with `pi-sudo.sh`:

```sh
scripts/pi-ssh.sh 'cat > /tmp/dashboard_agent.py' < pi-agent/dashboard_agent.py
scripts/pi-sudo.sh 'install -m 644 /tmp/dashboard_agent.py /opt/household-dashboard/dashboard_agent.py && systemctl restart dashboard-agent'
```

To write a config file on the Pi, create it locally with the Write tool and
stream it the same way. Building it with `sed`/heredocs through the Bash tool
mangles backslashes (systemd line continuations come out as a literal `\n`).

### What's on it

- Raspberry Pi 3 Model B, Raspberry Pi OS on Debian 13 (trixie), 64-bit.
- Desktop: **labwc** (Wayland). `wlopm` is installed and is the agent's
  display driver. X11 tips (`xset`, `unclutter`, lightdm `-nocursor`) don't apply.
- Kiosk: user service `~/.config/systemd/user/kiosk.service` (Chromium →
  `/dashboard`), managed with `systemctl --user`.
- Agent: `/opt/household-dashboard/dashboard_agent.py`, system service
  `dashboard-agent`, credential at `/etc/household-dashboard/credentials.json`.
- Chromium policy `/etc/chromium/policies/managed/household-dashboard.json`
  lets the dashboard reach the agent on `127.0.0.1:8765`.
- Overlay (read-only) filesystem is **off**, so changes persist. If it's
  turned on later (`grep boot=overlay /proc/cmdline`), changes vanish on
  reboot until it's disabled.
- To see the screen: `scripts/pi-ssh.sh 'WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 grim -s 0.5 -' > screen.png`.
- To run Chromium by hand over SSH (e.g. with `--log-net-log` to debug),
  stop `kiosk.service`, wait for `pgrep -x chromium` to come back empty
  (otherwise the new copy just hands its URL to the old one and exits), and
  pass `--ozone-platform=wayland` plus the two env vars above, or it looks
  for an X server and quits.
- The Pi doesn't pull from this repo: an updated `pi-agent/dashboard_agent.py`
  has to be copied over as above. Page changes arrive on their own after a
  deploy (the kiosk reloads when it sees a new build).
