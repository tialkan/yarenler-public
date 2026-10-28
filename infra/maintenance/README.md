# Weekly ORCID source maintenance

Runs on yarenler-01 only, Sunday01:30UTC / Sunday04:30Türkiye. The root-owned wrapper uses flock and a 256MiB/.5CPU container. It reads only active, unclaimed profiles lacking an ORCID and any explicit identifier resolution. Existing owners and prior conflict resolutions are excluded.

The existing pipeline permission layer checks live robots.txt against the recorded copy, rejects prohibited paths and checks every redirect. Requests have a three-second minimum interval, the 01:00–07:00Türkiye window, a source-error stop threshold and timeouts. Raw pages live only in a temporary directory. No model or paid API is called.

A new ORCID must pass the parser/checksum, be unique and match the exact normalized official ORCID given/family or credit name. A database row lock and repeat checks precede insertion. The verified resolution retains the official source and AVESİS evidence, so later imports preserve it. Name mismatches stay unlinked. Aggregate status is `/data/yarenler/maintenance/reports/last-orcid-check.json`, per-person attempts are in `orcid_check`.

Build from repository root with `docker build -f infra/maintenance/Dockerfile -t yarenler-maintenance:1 .`. Runtime DATABASE_URL belongs to the restricted yarenler_maintenance role in a root-only maintenance.env; never print it. The wrapper accepts explicit manual test arguments after the image: `python /app/recheck_orcid.py --limit 3 --allow-nonsunday --allow-daytime`. Routine cron uses the image default without overrides. This is ORCID maintenance, not automatic publication/field re-crawling.

## Daily violation record retention (migration 0016)

`retention.py` runs `SELECT yarenler_ihlal_temizle(180)` with the same restricted role and env file: violation records (text, IP address, User-Agent summary), announcement attempts and expired bans older than 180 days are deleted. The role may only execute that function (grants.sql, also granted by migration 0016 when the role exists). Root cron on yarenler-01, daily 03:17 UTC: `17 3 * * * /data/yarenler/maintenance/run.sh python /app/retention.py`. Rebuild the image once so it contains the script. The web application also calls the function at most every 12 hours per process as a fallback.

## Rolling profile and publication updates

From 24 October 2026, `profile_refresh.py` stages up to 250 profiles nightly. It uses a separate checked-at ledger, the live sitemap plus the known population, persistent conditional-request cache, a three-second source interval and the 01:00–07:00 Türkiye window. This covers the current 1,699-profile population across seven successful nights and discovers newly published profiles. It does not remove a person simply because a sitemap entry disappears. Five profile failures, a >5% batch failure rate, blocked access, missing source names, disappearance of all previous fields or >20% loss of a substantial publication list hold the affected data for review.

`refresh-sources.sh profiles` applies only a successfully staged batch with the idempotent Node importer; the freshness checkpoint advances after the transaction succeeds. Owner-edited title, ORCID ownership, reviewed fields, collaboration interests and hidden state are preserved. The same transaction synchronizes attributable publication-title evidence for the server semantic service. OpenAlex identifiers learned previously survive missing identifiers in later AVESİS records.

The root-owned worker has a host flock, memory/CPU bounds and a transient 0600 migration connection file made from the existing deployment secret. That owner credential is limited to the operational import container and removed by a shell trap; it never enters the web or model process. ORCID and retention continue to use the restricted maintenance role. This is an operational owner import, not a claim that arbitrary import SQL can execute under the restricted maintenance role.

Host UTC schedules on yarenler-01:

- `10 22 * * *`: profiles (01:10 Türkiye the next day).
- `15 0 * * *`: OpenAlex (03:15 Türkiye), successful batches cached for seven days.
- `17 3 * * *`: retention (06:17 Türkiye), violations and resolved appeals older than 180 days.
- Existing weekly ORCID recheck remains Sunday 01:30 UTC. Existing daily semantic refresh remains 03:30 UTC.

OpenAlex requests use exact OpenAlex/DOI identifiers, never person-name matches. Only `id,doi,primary_topic,topics,updated_date` are requested. The source hierarchy is stored in `research_area` with `sema=openalex`, English names stay English, and up to three source topics annotate each matched publication. This does not silently replace a researcher's selected expertise with all publication topics. A maximum 600 network calls per run and US$0.08 daily accounting ceiling keep the initial and routine jobs within the anonymous free allowance; failures keep successful cache files and leave live topic metadata unchanged. Neither an API key nor a paid subscription is required for this bounded population.

State and aggregate reports: `/data/yarenler/maintenance/{profiles,openalex}`. Worker logs: `/data/yarenler/maintenance/{profiles-refresh,openalex-refresh,retention}.log`. Inspect exit status and reports after a failed run; do not bypass a changed robots policy. Source-date freshness is separate from the date a parser or import was rerun.

For a source template change, loss guard or access failure, keep existing public records and review the blocked batch before resuming. Never turn an incomplete crawl into a mass deletion. New institutional AVESİS sources require the completed institutional protocol and explicit source-scope configuration; this AYBÜ connector must not be pointed at another host by changing its URL alone.

## TR Dizin publication connector (migration 0029)

The connector is implemented but **not scheduled or enabled by a web push**. A deployment must provision and test a restricted `yarenler_maintenance` connection first. Use the existing private `/data/yarenler/secrets/maintenance.env`, and a separate root-only `trdizin.env` containing `TRDIZIN_REFRESH_ENABLED=1` only after operator review of source access conditions. TR Dizin documents API access, but no published quota or explicit continuous redistribution licence was found; confirm operating limits and intended metadata reuse with ULAKBİM. A draft is `docs/sources/trdizin-kosul-teyit-taslagi.md` and is not sent automatically.

Before enabling any TR Dizin import, update **both** maintenance and AVESİS source importer images from the same committed revision. The existing source importer image `:3` does not contain cross-source reconciliation and must not be used after TR Dizin records are imported. Build `yarenler-maintenance:8` from `infra/maintenance/Dockerfile` and `yarenler-source-importer:4` from `infra/maintenance/Dockerfile.source-importer`; install the updated wrapper and have its profiles branch use `:4` first. This is a separate operational step, not performed by the web container deployment.

The TR Dizin path in `refresh-sources.sh` uses the restricted role and never receives migration credentials. Establish a persistent private state directory under `/data/yarenler/maintenance/trdizin`, a root-only environment file, and a separately configured schedule only after the images and wrapper are verified. The worker accepts up to 25 researchers per run, 90 requests per UTC day across restarts, at least three seconds between requests, seven-day successful-result cache, and stops on HTTP errors or redirects. The limits are Yarenler's own conservative choices, not an official TR Dizin quota. Per-author retrieval is bounded to the first 100 listed identifiers; truncation is reported and additional pages require further work. Empty or partial source responses never remove existing publications.

`last-result.json` contains aggregate counts, and private `reviews.json` lists unresolved identity/title conflicts by source and person identifiers. Cache and reports are private files, not served by the web. Do not treat title-only matches as proof of identity. Stored metadata excludes full texts, abstracts, contact information and citation metrics. A DOI or exact TR Dizin identity reuses an existing publication, and owner-hidden choices remain authoritative. Source subjects are not automatically assigned as expertise. Remove or correct stale review entries only after resolving the specific identity conflict; there is no automatic resolution UI yet.

## Image retention and recovery

Coolify cleanup can remove images that are not associated with running containers, which stops scheduled jobs. On yarenler-01 the maintenance and source importer images are retained by minimal, networkless sleep containers with a restart policy. Recreate the anchors when replacing either image, and check job logs after cleanup. The images do not receive secrets. Create `/data/yarenler/logs` with mode 0700 before installing the notification cron. The source refresh wrapper uses importer image `:4`; do not revert to `:3` after cross-source imports.
