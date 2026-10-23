#!/bin/sh
# SSH_ASKPASS helper for scripts/pi-ssh.sh — hands ssh the password it was given.
printf '%s\n' "$PI_PASSWORD"
