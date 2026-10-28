#!/bin/bash
set -euo pipefail
exec 9>/run/lock/yarenler-orcid.lock
flock -n 9 || exit 75
docker run --rm --name yarenler-orcid-check --network coolify --memory 256m --cpus .5 --env-file /data/yarenler/secrets/maintenance.env -v /data/yarenler/maintenance/reports:/reports yarenler-maintenance:7 "$@"
