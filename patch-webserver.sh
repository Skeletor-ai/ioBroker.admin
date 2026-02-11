#!/bin/bash
cd /home/clawdbot/clawd/ioBroker.admin

SRC="/home/clawdbot/clawd/webserver/build/lib"
DST="node_modules/@iobroker/webserver/build/lib"

# Copy built webserver files
cp "$SRC"/webauthn.* "$DST/"
cp "$SRC"/oauth2.* "$DST/"
cp "$SRC"/oauth2-model.* "$DST/"

# Patch js-controller to ignore SIGINT (keeps Redis DB alive)
JS_CTRL=".dev-server/default/node_modules/iobroker.js-controller/build/esm/main.js"
if [ -f "$JS_CTRL" ]; then
  sed -i '/process\.on.*SIGINT.*() => {/{n;n;s|stop(false);|// DEV-SERVER PATCH: Do not stop on SIGINT\n        // stop(false);|}' "$JS_CTRL"
fi

# Patch web.js to default rpId to 'localhost'
sed -i "s/rpId: this.adapter.config.webauthnRpId || undefined/rpId: this.adapter.config.webauthnRpId || 'localhost'/" build/lib/web.js 2>/dev/null

echo "Webserver files patched"
