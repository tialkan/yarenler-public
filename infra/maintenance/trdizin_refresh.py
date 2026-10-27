"""Bounded exact-ORCID TR Dizin refresh. Default dry-run; no destructive snapshot sync.

Automatic network access is off until explicitly configured. Uses maintenance role,
never owner/migration credentials. Successful normalized metadata cached seven days.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import time
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from yarenler_pipeline.sources.trdizin.client import Client, valid_orcid, doi

PEOPLE_SQL = 'SELECT id::text,orcid FROM person WHERE aktif AND NOT yonetici_gizledi AND orcid IS NOT NULL ORDER BY id'
APPLY_SQL = 'SELECT yarenler_trdizin_kaydet(%s::uuid,%s::text,%s::text,%s::text,%s::text,%s::smallint,%s::text,%s::jsonb,%s::jsonb) result'


def atomic_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


class DailyRequests:
    def __init__(self, path, now=time.time, sleep=time.sleep):
        self.path, self.now, self.sleep = path, now, sleep

    def reserve(self):
        now = self.now()
        day = dt.datetime.fromtimestamp(now, dt.timezone.utc).date().isoformat()
        data = json.loads(self.path.read_text()) if self.path.exists() else {}
        if data.get('day') != day:
            data = {'day': day, 'requests': 0, 'last': data.get('last', 0)}
        if data['requests'] >= 90:
            raise RuntimeError('Daily TR Dizin request budget exhausted')
        self.sleep(max(0, 3 - (now - data.get('last', 0))))
        data.update(requests=data['requests'] + 1, last=self.now())
        atomic_json(self.path, data)  # Reserve before I/O, including failed requests.


def validate(row, person):
    if row.get('version') != 2 or row.get('person_id') != person['id'] or row.get('orcid') != person['orcid'] or not valid_orcid(person['orcid']):
        raise ValueError('Cached identity mismatch')
    if row.get('status') not in ('matched', 'no_record'):
        raise ValueError('Invalid source status')
    if row['status'] == 'no_record':
        if row.get('verified'):
            raise ValueError('Unexpected publications without author')
        return
    if not str(row.get('author_id', '')).isdigit() or len(str(row['author_id'])) > 20:
        raise ValueError('Invalid source author')
    for pub in row.get('verified', []):
        if pub.get('doc_type') != 'PAPER' or not str(pub.get('id', '')).isdigit() or len(str(pub['id'])) > 20:
            raise ValueError('Invalid source publication')
        titles = pub.get('titles')
        if not isinstance(titles, list) or not 1 <= len(titles) <= 10 or any(not isinstance(t, str) or not 1 <= len(t) <= 2000 for t in titles):
            raise ValueError('Invalid publication titles')
        if pub.get('year') is not None and (type(pub['year']) is not int or not 1900 <= pub['year'] <= 2100):
            raise ValueError('Invalid publication year')
        if pub.get('doi') is not None and (doi(pub['doi']) != pub['doi'] or len(pub['doi']) > 300):
            raise ValueError('Invalid DOI')
        subjects = pub.get('subjects')
        if not isinstance(subjects, list) or len(subjects) > 100 or any(not isinstance(s, str) or not 1 <= len(s) <= 300 for s in subjects):
            raise ValueError('Invalid subjects')


def fetch_person(client, person):
    aid = client.author(person['orcid'])
    row = {'version': 2, 'person_id': person['id'], 'orcid': person['orcid'],
           'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'author_id': aid,
           'status': 'matched' if aid else 'no_record', 'verified': []}
    if aid:
        row.update(client.publications(aid, person['orcid']))
    validate(row, person)
    return row


def apply(connection, row):
    # The SQL function rechecks the live person's ORCID and active status inside its transaction.
    person = {'id': row['person_id'], 'orcid': row['orcid']}
    validate(row, person)
    counts = {}
    reviews = []
    for pub in row['verified']:
        result = connection.execute(APPLY_SQL, (row['person_id'], row['orcid'], row['author_id'], pub['id'],
                  pub['titles'][0], pub['year'], pub['doi'], Jsonb(pub['titles']), Jsonb(pub['subjects'])), prepare=True).fetchone()['result']
        status = result['status']
        counts[status] = counts.get(status, 0) + 1
        if status in ('title_review', 'identifier_conflict', 'identity_changed'):
            reviews.append({'source_id': pub['id'], 'person_id': row['person_id'], 'status': status})
    return counts, reviews


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=Path('/state/trdizin'))
    parser.add_argument('--limit', type=int, default=25)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--offline', action='store_true', help='Use existing validated cache only')
    args = parser.parse_args()
    if not 1 <= args.limit <= 25:
        parser.error('limit must be 1–25')
    if not args.offline and os.environ.get('TRDIZIN_REFRESH_ENABLED') != '1':
        print(json.dumps({'status': 'disabled', 'reason': 'TRDIZIN_REFRESH_ENABLED is not 1'}))
        return
    os.umask(0o077)
    args.state.mkdir(parents=True, exist_ok=True)
    with (args.state / 'refresh.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run(args)


def run(args):
    with psycopg.connect(os.environ['DATABASE_URL'], row_factory=dict_row) as c:
        role = c.execute('SELECT current_user role').fetchone()['role']
        if role != 'yarenler_maintenance':
            raise RuntimeError('TR Dizin requires the restricted yarenler_maintenance role')
        people = c.execute(PEOPLE_SQL, prepare=True).fetchall()
        c.commit()
        def cache_path(p):
            return args.state / (hashlib.sha256((p['id'] + '|' + p['orcid']).encode()).hexdigest() + '.json')
        # Round robin by observation time; cache age controls network refresh, never removal.
        people = sorted((p for p in people if valid_orcid(p['orcid'])), key=lambda p: (cache_path(p).stat().st_mtime if cache_path(p).exists() else 0, p['id']))
        if args.offline:
            people = [p for p in people if cache_path(p).exists()]
        budget = DailyRequests(args.state / 'budget.json')
        client = Client(budget=90, before_request=budget.reserve)
        summary = {'people': 0, 'cached': 0, 'no_record': 0, 'truncated': 0, 'apply': args.apply, 'outcomes': {}}
        reviews = []
        try:
            for person in people[:args.limit]:
                path = cache_path(person)
                hit = path.exists() and (args.offline or time.time() - path.stat().st_mtime < 7 * 86400)
                row = json.loads(path.read_text()) if hit else fetch_person(client, person)
                validate(row, person)
                if not hit:
                    atomic_json(path, row)
                summary['people'] += 1
                summary['cached'] += int(hit)
                summary['no_record'] += row['status'] == 'no_record'
                summary['truncated'] += bool(row.get('truncated'))
                if args.apply:
                    with c.transaction():
                        counts, deferred = apply(c, row)
                    reviews.extend(deferred)
                    for key, count in counts.items():
                        summary['outcomes'][key] = summary['outcomes'].get(key, 0) + count
                else:
                    summary['validated_publication_links'] = summary.get('validated_publication_links', 0) + len(row['verified'])
            summary['status'] = 'complete'
        except Exception:
            summary['status'] = 'stopped'  # Do not print exception payloads or connection strings.
            raise
        finally:
            client.close()
            summary.update(requests=client.requests, at=dt.datetime.now(dt.timezone.utc).isoformat())
            atomic_json(args.state / 'last-result.json', summary)
            # Carry forward unresolved reviews rather than dropping earlier batches on restart.
            review_path = args.state / 'reviews.json'
            previous = json.loads(review_path.read_text()) if review_path.exists() else []
            combined = {(r['person_id'], r['source_id']): r for r in previous + reviews}
            atomic_json(review_path, list(combined.values()))
            print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'status': 'failed', 'message': 'Refresh stopped; inspect private state and remote access conditions.'}), flush=True)
        raise SystemExit(1)
