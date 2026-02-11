#!/bin/bash
# Custom dev-server startup that keeps js-controller alive
# Usage: bash start-dev.sh
set -e
cd /home/clawdbot/clawd/ioBroker.admin

# Apply patches
bash patch-webserver.sh

PROFILE_DIR=".dev-server/default"
cd "$PROFILE_DIR"

# Kill any existing processes
for port in 26426 24426 20426; do
  kill -9 $(ss -tlnp | grep ":$port " | grep -oP 'pid=\K\d+') 2>/dev/null || true
done
sleep 1

echo "=== Starting js-controller ==="
node --preserve-symlinks --preserve-symlinks-main node_modules/iobroker.js-controller/controller.js &
JS_PID=$!
echo "js-controller PID: $JS_PID"

# Wait for Redis ports
for port in 26426 24426; do
  echo "Waiting for port $port..."
  for i in $(seq 1 30); do
    if ss -tlnp | grep -q ":$port "; then
      echo "Port $port ready"
      break
    fi
    sleep 1
  done
done

echo "=== Starting admin adapter ==="
node --preserve-symlinks --preserve-symlinks-main node_modules/iobroker.admin/build/main.js --debug 0 &
ADMIN_PID=$!
echo "admin PID: $ADMIN_PID"

# Wait for admin port
echo "Waiting for port 20426..."
for i in $(seq 1 30); do
  if ss -tlnp | grep -q ":20426 "; then
    echo "Admin ready on port 20426"
    break
  fi
  sleep 1
done

echo ""
echo "=== Dev environment running ==="
echo "Admin: http://localhost:20426"
echo "js-controller PID: $JS_PID"
echo "admin PID: $ADMIN_PID"
echo ""
echo "Press Ctrl+C to stop"

# Monitor and restart js-controller if it dies
cleanup() {
  echo "Shutting down..."
  kill $ADMIN_PID 2>/dev/null
  kill -9 $JS_PID 2>/dev/null  # SIGKILL because SIGTERM is patched out
  wait
  exit 0
}
trap cleanup SIGINT SIGTERM

while true; do
  if ! kill -0 $JS_PID 2>/dev/null; then
    echo "=== js-controller died, restarting ==="
    node --preserve-symlinks --preserve-symlinks-main node_modules/iobroker.js-controller/controller.js &
    JS_PID=$!
    echo "New js-controller PID: $JS_PID"
    sleep 5
  fi
  if ! kill -0 $ADMIN_PID 2>/dev/null; then
    echo "=== admin died, restarting ==="
    node --preserve-symlinks --preserve-symlinks-main node_modules/iobroker.admin/build/main.js --debug 0 &
    ADMIN_PID=$!
    echo "New admin PID: $ADMIN_PID"
    sleep 5
  fi
  sleep 5
done
