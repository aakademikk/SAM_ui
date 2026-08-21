#!/usr/bin/env bash
# Install the SAM UI systemd user service.
#
# Prerequisites (one-time):
#   sudo loginctl enable-linger $USER   # already done on this machine
#
# Usage:
#   ./scripts/install-service.sh

set -euo pipefail

UNIT_NAME="sam-ui.service"
UNIT_SRC="$(dirname "$0")/sam-ui.service"
UNIT_DEST="${HOME}/.config/systemd/user/${UNIT_NAME}"

echo "→ Copying unit file to ${UNIT_DEST}"
mkdir -p "$(dirname "${UNIT_DEST}")"
cp "${UNIT_SRC}" "${UNIT_DEST}"

echo "→ Reloading systemd user daemon"
systemctl --user daemon-reload

echo "→ Enabling and starting ${UNIT_NAME}"
systemctl --user enable --now "${UNIT_NAME}"

echo "→ Done. Check status with:"
echo "    systemctl --user status ${UNIT_NAME}"
echo "    journalctl --user -u ${UNIT_NAME} -f"
