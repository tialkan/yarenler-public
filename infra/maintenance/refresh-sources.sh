#!/bin/bash
# Root-only operational worker. Migration credentials never enter the web or model container.
set -euo pipefail
exec 9>/run/lock/yarenler-source-refresh.lock
flock -n 9 || exit 75
umask 077
root=/data/yarenler
mode=${1:-profiles}
case "$mode" in profiles|openalex|trdizin) ;; *) exit 64;; esac
if [ "$mode" = trdizin ]; then
 # Separate restricted DB role. No migration credentials are passed to this worker.
 docker run --rm --name yarenler-trdizin-refresh --network coolify --memory 512m --cpus .5 --env-file "$root/secrets/maintenance.env" --env-file "$root/secrets/trdizin.env" -v "$root/maintenance/trdizin:/state/trdizin" yarenler-maintenance:8 python /app/trdizin_refresh.py --apply
 exit 0
fi
secret=$(mktemp "$root/secrets/source-job.XXXXXX.env")
trap 'rm -f "$secret"' EXIT
python3 - "$root/secrets/deployment-database-roles.json" "$secret" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[2]).write_text('DATABASE_URL='+json.loads(Path(sys.argv[1]).read_text())['MIGRATION_DATABASE_URL']+'\n')
PY
if [ "$mode" = profiles ]; then
 docker run --rm --name yarenler-profile-refresh --network coolify --memory 512m --cpus .5 -v "$root/maintenance/profiles:/state/profiles" yarenler-maintenance:7 python /app/profile_refresh.py
 docker run --rm --network coolify --memory 512m --cpus .5 --env-file "$secret" -v "$root/maintenance/profiles/batch.jsonl:/input.jsonl:ro" --entrypoint node yarenler-source-importer:4 apps/web/scripts/import.mjs /input.jsonl
 docker run --rm --network none --memory 256m -v "$root/maintenance/profiles:/state/profiles" yarenler-maintenance:7 python /app/profile_refresh.py --commit
else
 docker run --rm --name yarenler-openalex-refresh --network coolify --memory 512m --cpus .5 --env-file "$secret" -v "$root/maintenance/openalex:/state/openalex" yarenler-maintenance:7 python /app/openalex_refresh.py
fi
# The semantic service hashes inputs and embeds only changed evidence, on yarenler-01.
docker restart yarenler-semantic >/dev/null
