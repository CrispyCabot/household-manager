#!/bin/sh
# Runs a command on the wall-dashboard Pi (or opens a shell with no args),
# logging in with the password from the gitignored .env.pi at the repo root.
#   scripts/pi-ssh.sh 'systemctl status dashboard-agent'
# Pipe a file to the Pi with stdin:
#   scripts/pi-ssh.sh 'sudo tee /opt/household-dashboard/dashboard_agent.py >/dev/null' < pi-agent/dashboard_agent.py
set -eu
repo_root=$(cd "$(dirname "$0")/.." && pwd)
env_file="$repo_root/.env.pi"
[ -f "$env_file" ] || { echo "missing $env_file — see CLAUDE.md" >&2; exit 1; }
set -a
. "$env_file"
set +a
export SSH_ASKPASS="$repo_root/scripts/pi-askpass.sh" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
exec ssh -o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no -o ConnectTimeout=10 \
  "$PI_USER@$PI_HOST" "$@"
