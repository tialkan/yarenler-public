#!/bin/sh
# Container entrypoint: apply pending migrations ("up" only, advisory lock), then start
# Next.js behind the CSP front server. A failed migration stops here, so Coolify keeps the previous container.
# The migration credential is removed from the environment of the web server process.
set -eu
node apps/web/scripts/migrate.mjs --on-start
# The front server loads Next.js (server.js) on 127.0.0.1:3001 (host name localhost) and serves PORT with the HTML CSP hashes.
exec env -u MIGRATION_DATABASE_URL node apps/web/scripts/front-server.mjs
