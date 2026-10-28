#!/bin/sh
set -eu
# Separate process: neither the web container nor the auth role receives the mail key or PDF read access.
key=/data/yarenler/secrets/resend-api-key
if [ ! -s "$key" ]; then
  echo '{"event":"institution_notices_not_configured"}'
  exit 0
fi
exec flock -n /run/lock/yarenler-institution-notices.lock docker run --rm --network coolify --memory 256m --cpus .5 --env-file /data/yarenler/secrets/maintenance.env --env 'EMAIL_FROM=Yarenler <bildirim@yarenler.org>' --env RESEND_API_KEY_FILE=/run/secrets/resend-api-key --mount type=bind,src=/data/yarenler/secrets/resend-api-key,dst=/run/secrets/resend-api-key,readonly yarenler-maintenance:7 python /app/institution_notices.py
