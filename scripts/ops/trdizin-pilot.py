#!/usr/bin/env python3
"""Read-only 25-ORCID pilot. Input: local JSONL export, output: ignored report directory.

Run with pipeline's Python environment. No database writes, AI or embeddings.
Cohort is purposive, stratified by unit; not representative of all researchers.
"""
import argparse
import json
import re
import unicodedata
from pathlib import Path

from yarenler_pipeline.sources.trdizin.client import Client, doi, valid_orcid


def norm(value):
    value = unicodedata.normalize('NFKC', value).replace('İ', 'i').replace('I', 'ı').lower()
    return ''.join(c for c in value if c.isalnum())


def group(unit):
    for name, pattern in [('hukuk', 'hukuk'), ('sosyal', 'sosyoloji|işletme|iktisat|siyasal|psikoloji'),
                          ('beşeri', 'ilahiyat|tarih|edebiyat|felsefe|dil'),
                          ('sağlık', 'tıp|sağlık|diş|hemşire|fizyoterapi')]:
        if re.search(pattern, unit.lower()):
            return name
    return 'fen-mühendislik-diğer'


def select(rows):
    buckets = {}
    seen = set()
    for row in sorted(rows, key=lambda r: (-len(r['publications']), r['id'])):
        if not valid_orcid(row['orcid']) or row['orcid'] in seen:
            continue
        bucket = buckets.setdefault(group(row['unit']), [])
        if len(bucket) < 5:
            bucket.append(row)
            seen.add(row['orcid'])
    if len(buckets) != 5 or any(len(b) != 5 for b in buckets.values()):
        raise RuntimeError('Insufficient five-stratum cohort')
    return [dict(r, stratum=g) for g, bucket in sorted(buckets.items()) for r in bucket]


def compare(item, existing):
    if item['doi'] and any(doi(p['doi']) == item['doi'] for p in existing):
        return 'existing_doi'
    # Exact normalized title is only a duplicate candidate, never a global merge.
    titles = {norm(p['title']) for p in existing}
    if any(norm(t) in titles for t in item['titles']):
        return 'existing_title_candidate'
    return 'additional_candidate'


def field_feasibility(rows, areas):
    labels = {}
    for area in areas:
        for label in (area['name'], area.get('alias')):
            if label:
                labels.setdefault(norm(label), set()).add(area['id'])
    pubs = {p['id']: p for row in rows for p in row.get('verified', [])}
    subjects = {s for p in pubs.values() for s in p['subjects']}
    matches = {s: sorted(labels[norm(s)]) for s in subjects if norm(s) in labels}
    return {'unique_subject_labels': len(subjects), 'exact_catalog_subject_labels': len(matches),
            'exact_unambiguous_subject_labels': sum(len(ids) == 1 for ids in matches.values()),
            'publications_with_exact_catalog_subject': sum(any(s in matches for s in p['subjects']) for p in pubs.values()),
            'catalog_matches': matches,
            'note': 'Label overlap only. No personal expertise assignment or matching change.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--areas', type=Path, help='Optional local canonical area JSONL: id, name, alias')
    args = parser.parse_args()
    cohort = select([json.loads(line) for line in args.input.read_text().splitlines() if line])
    args.output.mkdir(parents=True, exist_ok=True)
    client = Client(budget=90)
    rows = []
    for person in cohort:
        path = args.output / (person['orcid'] + '.json')
        if path.exists():
            cached = json.loads(path.read_text())
            if cached.get('orcid') != person['orcid'] or cached.get('id') != person['id'] or cached.get('status') not in ('matched', 'no_record'):
                raise ValueError('Checkpoint identity or status mismatch; use a fresh output directory')
            rows.append(cached)
            continue
        row = {k: person[k] for k in ('id', 'orcid', 'name', 'unit', 'stratum')}
        try:
            aid = client.author(person['orcid'])
            row.update(author_id=aid, status='matched' if aid else 'no_record')
            if aid:
                row.update(client.publications(aid, person['orcid']))
                for pub in row['verified']:
                    pub['comparison'] = compare(pub, person['publications'])
                    # Includes hidden publications in duplicate detection. Never restore visibility.
            path.write_text(json.dumps(row, ensure_ascii=False, indent=2) + '\n')
            rows.append(row)
            print(json.dumps({'progress': len(rows), 'stratum': row['stratum'], 'status': row['status'],
                              'verified': len(row.get('verified', [])), 'requests': client.requests}), flush=True)
        except Exception as exc:
            # Stop rather than turn outages or identity mismatches into missing authors.
            print(f'Pilot stopped: {type(exc).__name__}: {exc}', flush=True)
            raise
    pubs = [p for r in rows for p in r.get('verified', [])]
    unique = {p['id']: p for p in pubs}
    summary = {'sample': len(rows), 'matched': sum(r['status'] == 'matched' for r in rows),
               'no_record': sum(r['status'] == 'no_record' for r in rows),
               'verified_person_publication_links': len(pubs), 'unique_publications': len(unique),
               'comparison_links': {k: sum(p['comparison'] == k for p in pubs) for k in
                                    ('existing_doi', 'existing_title_candidate', 'additional_candidate')},
               'metadata_unique': {k: sum(bool(p[k]) for p in unique.values()) for k in
                                   ('doi', 'subjects', 'has_abstract', 'has_keywords')},
               'truncated_authors': sum(bool(r.get('truncated')) for r in rows),
               'requests_this_run': client.requests, 'production_writes': 0,
               'matching_effect': 'not_applied_not_measured'}
    (args.output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    if args.areas:
        feasibility = field_feasibility(rows, [json.loads(line) for line in args.areas.read_text().splitlines() if line])
        (args.output / 'field-feasibility.json').write_text(json.dumps(feasibility, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
