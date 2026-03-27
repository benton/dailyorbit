#!/usr/bin/env bash
# Copies a local script to the production EC2 instance and runs it.
# Usage: ./run_in_prod.sh <local-script> [script-args...]
#
# The script is uploaded to /tmp on the remote host, made executable, and run.
# All script arguments are forwarded.
set -euo pipefail

HOST="api.dailyorbit.org"
USER="ubuntu"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <local-script> [script-args...]" >&2
  exit 1
fi

LOCAL_SCRIPT="$1"
shift
SCRIPT_ARGS=("$@")

if [ ! -f "$LOCAL_SCRIPT" ]; then
  echo "Error: file not found: $LOCAL_SCRIPT" >&2
  exit 1
fi

REMOTE_PATH="/tmp/$(basename "$LOCAL_SCRIPT")"

echo "==> Uploading $(basename "$LOCAL_SCRIPT") to ${HOST}:${REMOTE_PATH}"
scp ${SSH_OPTS} "$LOCAL_SCRIPT" "${USER}@${HOST}:${REMOTE_PATH}"

echo "==> Running on ${HOST}"
ssh ${SSH_OPTS} "${USER}@${HOST}" "chmod +x ${REMOTE_PATH} && ${REMOTE_PATH} ${SCRIPT_ARGS[*]:-}"
