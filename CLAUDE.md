# household-manager

See [README.md](README.md) for layout and stack. Pushing to `main` deploys
automatically via CI (`.github/workflows/deploy.yml`) — there is no manual
`cdk deploy` step.

## Web app and Android app

The Android app (`app/android/`) is the same React app as the website, wrapped
with [Capacitor](https://capacitorjs.com). **Every feature must work in both.**
Usually that's automatic, since they share `app/src`. What needs care:

- Anything that leaves the app (sign-in, Google consent, Cognito logout) goes
  through `openExternalPage` / `browserTabNavigator` in `app/src/native.ts`,
  never a bare `window.location.assign` to another site.
- A new browser API, native capability or redirect URL needs its Android
  side too (a Capacitor plugin, a manifest entry, the app's URL scheme).
- The API must keep accepting the app's origin (`ANDROID_APP_ORIGIN` in
  `api/src/app.ts`), and Cognito its redirects (`nativeAppScheme`).
- Task reminders go out by each person's `notifyVia` (email, app, both,
  none) from `api/src/reminder.ts`; a new kind of reminder respects it too.
  Phone notifications only exist in builds with `google-services.json`
  (`phoneNotificationsBuiltIn` in `app/src/push.ts`).
- Phones registered with `actionButtons` get data-only messages and draw the
  reminder themselves (`ReminderNotifications.java`), with Mark complete and
  Dismiss. Those buttons call the task routes with a phone credential
  (`api/src/phoneCredential.ts`), which gets device-level access only. Older
  APKs still get Firebase-drawn notifications.
- CI builds the APK on every PR; it must stay green. The phone only gets a
  change once a new APK is installed (see README).

## Checks

- `npm run typecheck` — whole repo.
- `cd pi-agent && python -m unittest test_dashboard_agent` — the Pi agent's tests.

## Custom dashboards

A specific device can have its own look, kept entirely in
`app/src/dashboards/<slug>/` (the Kitchen Wall's is `kitchen-wall/`). See
[app/src/dashboards/README.md](app/src/dashboards/README.md). Restyle a
dashboard there, never in shared app code or `styles.css`.

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
- Touchscreen: SiS HID touch controller over USB. `~/.config/labwc/rc.xml`
  maps it to `HDMI-A-1` and must say `mouseEmulation="no"`. With `yes`
  (which got written once, apparently by the Pi's own screen/touch settings
  tool), taps still click but drags don't scroll. After editing, reload with
  `kill -HUP $(pgrep -x labwc)`.
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
