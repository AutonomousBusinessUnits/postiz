#!/bin/sh
# Fork: Vercel Daemon entry. With Temporal Cloud (TEMPORAL_ADDRESS + API key)
# this only starts the orchestrator. With TEMPORAL_BRIDGE=postgres it first
# starts a Temporal dev server on loopback (state in /tmp: lost on restart;
# spike only) and the orchestrator drains the Postgres bridge into it.
set -e
if [ "$TEMPORAL_BRIDGE" = "postgres" ]; then
  temporal server start-dev --headless --ip 127.0.0.1 --port 7233 \
    --db-filename /tmp/temporal.db --log-level warn \
    --search-attribute postId=Text --search-attribute organizationId=Text &
  export TEMPORAL_ADDRESS=127.0.0.1:7233
  unset TEMPORAL_TLS TEMPORAL_API_KEY
  node -e '
    const net=require("net");let n=0;
    (function t(){const s=net.connect(7233,"127.0.0.1",()=>{s.end();console.log("temporal dev server up");process.exit(0)});
     s.on("error",()=>{if(++n>120){console.error("temporal dev server did not start");process.exit(1)}setTimeout(t,500)})})()'
fi
echo "worker: starting orchestrator (region ${VERCEL_REGION:-local})"
cd /app/apps/orchestrator
exec node --experimental-require-module ./dist/apps/orchestrator/src/main.js
