#!/usr/bin/bash
# Controls the daily-orbit systemd service on the production host.
# Usage: ./run_in_prod.sh server_systemctl.sh <start|stop|restart|status>
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <start|stop|restart|status>" >&2
  exit 1
fi

ACTION="$1"

case "$ACTION" in
  start|stop|restart|status)
    sudo systemctl "$ACTION" daily-orbit.service
    echo "==> daily-orbit.service: $(systemctl is-active daily-orbit.service)"
    ;;
  *)
    echo "Error: unknown action '$ACTION'. Use start|stop|restart|status" >&2
    exit 1
    ;;
esac
