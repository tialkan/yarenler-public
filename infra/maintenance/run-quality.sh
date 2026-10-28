#!/bin/sh
set -eu
exec flock -n /run/lock/yarenler-quality.lock docker run --rm --network coolify --memory 512m --cpus .5 --env-file /data/yarenler/secrets/web.env --env SEMANTIC_URL=http://yarenler-semantic:8000 --mount type=bind,src=/data/yarenler/maintenance/reports,dst=/reports yarenler-maintenance:7 python /app/network_quality.py "$@"
