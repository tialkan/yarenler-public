"""Public metadata only; exact ORCID identity, fixed host, bounded requests."""
import re
import time
from urllib.parse import quote

import httpx

BASE = 'https://search.trdizin.gov.tr'


def valid_orcid(value):
    if not re.fullmatch(r'\d{4}-\d{4}-\d{4}-\d{3}[\dX]', value or ''):
        return False
    total = 0
    for digit in value.replace('-', '')[:-1]:
        total = (total + int(digit)) * 2
    check = (12 - total % 11) % 11
    return value[-1] == ('X' if check == 10 else str(check))


def doi(value):
    value = re.sub(r'^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)', '', (value or '').strip(), flags=re.I).lower()
    return value if re.fullmatch(r'10\.\d{4,9}/\S+', value) else None


def metadata(source, author_id, orcid):
    """Never infer authorship from names or flattened unrelated author arrays."""
    if source.get('docType') != 'PAPER':
        return None
    authors = source.get('authors') or []
    linked = [a for a in authors if str(a.get('authorId')) == str(author_id)]
    if not linked or any(a.get('orcid') not in (None, '', orcid) for a in linked):
        return None
    if not any(a.get('orcid') == orcid for a in linked):
        return None
    pid = str(source.get('id', ''))
    if not pid.isdigit():
        return None
    abstracts = source.get('abstracts') or []
    titles = list(dict.fromkeys(a['title'].strip() for a in abstracts if isinstance(a.get('title'), str) and a['title'].strip()))
    return {'id': pid, 'doc_type': 'PAPER', 'doi': doi(source.get('doi')), 'titles': titles,
            'year': source.get('publicationYear'),
            'subjects': list(dict.fromkeys(s['name'] for s in source.get('subjects', []) if isinstance(s.get('name'), str))),
            'has_abstract': any(bool(a.get('abstract')) for a in abstracts),
            'has_keywords': any(bool(a.get('keywords')) for a in abstracts),
            'url': f'{BASE}/tr/yayin/detay/{pid}'}


class Client:
    def __init__(self, *, transport=None, interval=3, budget=90, before_request=None):
        if transport is None and interval < 3:
            raise ValueError('Live request interval must be at least 3 seconds')
        self.http = httpx.Client(transport=transport, timeout=20, follow_redirects=False,
                                 headers={'User-Agent': 'YarenlerResearchPilot/1.0 (+https://yarenler.org)', 'Accept': 'application/json'})
        self.interval, self.remaining, self.last = interval, budget, 0
        self.requests = 0
        self.stopped = False
        self.before_request = before_request

    def close(self):
        self.http.close()

    def get(self, path):
        if not re.fullmatch(r'/api/(?:public/yazar/orcid/\?orcid=[0-9X-]+|authorPublicationsById/[0-9]+|findPublicationByIdList/[0-9%20]+)', path):
            raise ValueError('Endpoint outside TR Dizin allowlist')
        if self.stopped or self.remaining <= 0:
            raise RuntimeError('Pilot request budget exhausted or remote stop received')
        time.sleep(max(0, self.interval - (time.monotonic() - self.last)))
        if self.before_request:
            self.before_request()
        self.last = time.monotonic()
        self.remaining -= 1
        self.requests += 1
        with self.http.stream('GET', BASE + path) as response:
            if response.status_code == 204:
                return None
            if response.status_code != 200:
                self.stopped = True
                raise RuntimeError(f'Pilot stopped: HTTP {response.status_code}')
            raw = bytearray()
            for chunk in response.iter_bytes():
                raw.extend(chunk)
                if len(raw) > 5_000_000:
                    self.stopped = True
                    raise RuntimeError('Response size limit')
            import json
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError('Unexpected API envelope')
            return data

    def author(self, orcid):
        if not valid_orcid(orcid):
            raise ValueError('Invalid ORCID')
        data = self.get('/api/public/yazar/orcid/?orcid=' + orcid)
        if data is None:
            return None
        if data.get('orcid') != orcid or not str(data.get('id', '')).isdigit():
            raise ValueError('Author identity mismatch')
        return str(data['id'])

    def publications(self, author_id, orcid):
        if not str(author_id).isdigit() or not valid_orcid(orcid):
            raise ValueError('Invalid identity')
        listing = self.get('/api/authorPublicationsById/' + author_id)
        if listing is None:
            raise ValueError('Unexpected empty publication envelope')
        hits = listing['hits']['hits']
        ids = list(dict.fromkeys(str(h['_id']) for h in hits if str(h.get('_id', '')).isdigit()))[:100]
        result = []
        for offset in range(0, len(ids), 50):
            batch = ids[offset:offset + 50]
            details = self.get('/api/findPublicationByIdList/' + quote(' '.join(batch), safe=''))
            for hit in details['hits']['hits']:
                item = metadata(hit.get('_source', {}), author_id, orcid)
                if item and item['id'] in batch and item['id'] not in {p['id'] for p in result}:
                    result.append(item)
        total = listing['hits'].get('total', {})
        total = total.get('value', len(hits)) if isinstance(total, dict) else total
        return {'listed': total, 'selected': len(ids), 'verified': result,
                'truncated': total > len(ids)}
