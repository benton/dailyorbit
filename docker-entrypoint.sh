#!/bin/sh
# Start Xvfb in the background for headed Playwright, then exec the app.
# Tini (ENTRYPOINT) is PID 1 — handles signal forwarding and zombie reaping.
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
export DISPLAY=:99
exec ./daily-orbit "$@"
