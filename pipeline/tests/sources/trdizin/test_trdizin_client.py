import importlib.util
from pathlib import Path

import httpx
import pytest

from yarenler_pipeline.sources.trdizin.client import Client, doi, metadata, valid_orcid

ORCID = '0000-0000-0000-0001'


def client(handler, **kwargs):
    return Client(transport=httpx.MockTransport(handler), interval=0, **kwargs)


def source(**kwargs):
    return dict(id=12, docType='PAPER', authors=[{'authorId': 7, 'orcid': ORCID}],
                abstracts=[{'title': 'Örnek yayın', 'abstract': 'x', 'keywords': ['alan']}],
                subjects=[{'name': 'Sosyoloji'}], **kwargs)


@pytest.mark.parametrize('value,expected', [(ORCID, True), ('0000-0000-0000-1090', False),
                                           ('https://orcid.org/' + ORCID, False), ('', False)])
def test_orcid_checksum(value, expected):
    assert valid_orcid(value) is expected


def test_empty_is_not_error():
    c = client(lambda r: httpx.Response(204))
    assert c.author(ORCID) is None
    assert c.requests == 1


def test_identity_mismatch_never_name_matches():
    c = client(lambda r: httpx.Response(200, json={'id': 7, 'orcid': 'other', 'fullName': 'Same name'}))
    with pytest.raises(ValueError, match='identity'):
        c.author(ORCID)


@pytest.mark.parametrize('status', [301, 403, 429, 500])
def test_remote_failure_stops_further_requests(status):
    c = client(lambda r: httpx.Response(status))
    with pytest.raises(RuntimeError, match='HTTP'):
        c.author(ORCID)
    with pytest.raises(RuntimeError, match='budget'):
        c.author(ORCID)
    assert c.requests == 1


def test_request_budget():
    c = client(lambda r: httpx.Response(204), budget=1)
    c.author(ORCID)
    with pytest.raises(RuntimeError):
        c.author(ORCID)


def test_no_contact_fulltext_citations_or_abstract_storage():
    data = source(email='private', pdf='private', orderCitationCount=100, doi='https://doi.org/10.1234/ABC')
    item = metadata(data, '7', ORCID)
    assert item['doi'] == '10.1234/abc'
    assert item['has_abstract'] and item['has_keywords']
    assert not {'email', 'pdf', 'orderCitationCount', 'abstracts', 'authors'} & item.keys()


def test_conflicting_or_missing_orcid_rejected():
    data = source()
    for authors in [[{'authorId': 8, 'orcid': ORCID}], [{'authorId': 7}],
                    [{'authorId': 7, 'orcid': ORCID}, {'authorId': 7, 'orcid': 'other'}]]:
        data['authors'] = authors
        assert metadata(data, '7', ORCID) is None


def test_list_duplicate_ids_and_unrequested_details():
    def handler(request):
        assert request.url.host == 'search.trdizin.gov.tr'
        if 'authorPublications' in request.url.path:
            return httpx.Response(200, json={'hits': {'total': {'value': 2}, 'hits': [{'_id': '12'}, {'_id': '12'}]}})
        other = source()
        other['id'] = 13
        return httpx.Response(200, json={'hits': {'hits': [{'_source': source()}, {'_source': source()}, {'_source': other}]}})
    result = client(handler).publications('7', ORCID)
    assert len(result['verified']) == 1
    assert result['truncated']


def test_wrong_envelope_and_size_limit():
    c = client(lambda r: httpx.Response(200, json=[]))
    with pytest.raises(ValueError, match='envelope'):
        c.author(ORCID)
    c = client(lambda r: httpx.Response(200, content=b'x' * 5_000_001))
    with pytest.raises(RuntimeError, match='size'):
        c.author(ORCID)


def test_live_interval_cannot_be_disabled():
    with pytest.raises(ValueError):
        Client(interval=0)


def load_runner():
    path = Path(__file__).resolve().parents[4] / 'scripts/ops/trdizin-pilot.py'
    spec = importlib.util.spec_from_file_location('pilot', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_hidden_publication_still_detected_as_existing():
    runner = load_runner()
    item = metadata(source(doi='10.1234/a'), '7', ORCID)
    assert runner.compare(item, [{'doi': '10.1234/a', 'title': 'Different', 'visible': False}]) == 'existing_doi'
    assert runner.compare(item, [{'doi': None, 'title': 'Örnek yayın', 'visible': False}]) == 'existing_title_candidate'
    assert runner.compare(item, []) == 'additional_candidate'


def test_doi_validation():
    assert doi('doi: 10.1234/AbC') == '10.1234/abc'
    assert doi('javascript:bad') is None


def test_field_overlap_does_not_guess_or_resolve_ambiguous_labels():
    runner = load_runner()
    rows = [{'verified': [{'id': '1', 'subjects': ['Sosyoloji', 'Bilinmeyen']}]}]
    areas = [{'id': 'a', 'name': 'Sosyoloji'}, {'id': 'b', 'name': 'SOSYOLOJİ'}]
    result = runner.field_feasibility(rows, areas)
    assert result['exact_catalog_subject_labels'] == 1
    assert result['exact_unambiguous_subject_labels'] == 0
    assert result['publications_with_exact_catalog_subject'] == 1
    assert result['catalog_matches']['Sosyoloji'] == ['a', 'b']


def test_projects_and_undocumented_endpoints_are_not_ingested():
    data = source()
    data['docType'] = 'PROJECT'
    assert metadata(data, '7', ORCID) is None
    c = client(lambda r: pytest.fail('No network request expected'))
    with pytest.raises(ValueError, match='allowlist'):
        c.get('/api/getFile/1')
