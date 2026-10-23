#!/bin/sh
# Runs one command as root on the wall-dashboard Pi, feeding sudo the
# password from .env.pi. stdin is taken by the password, so to install a
# file, copy it to /tmp with pi-ssh.sh first, then move it with this.
#   scripts/pi-sudo.sh 'systemctl restart dashboard-agent'
set -eu
repo_root=$(cd "$(dirname "$0")/.." && pwd)
. "$repo_root/.env.pi"
printf '%s\n' "$PI_PASSWORD" | "$repo_root/scripts/pi-ssh.sh" "sudo -S -p '' sh -c $(printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\''/g")")"
