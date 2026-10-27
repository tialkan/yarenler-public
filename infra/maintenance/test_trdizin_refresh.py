import copy
import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('trdizin_refresh', Path(__file__).with_name('trdizin_refresh.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
ORCID = '0000-0000-0000-0001'


def record():
    return {'version': 2, 'person_id': 'person', 'orcid': ORCID, 'author_id': '7', 'status': 'matched',
            'verified': [{'doc_type': 'PAPER', 'id': '12', 'doi': '10.1234/a', 'year': 2026,
                          'titles': ['Türkçe yayın başlığı'], 'subjects': ['Sosyoloji']}]}


def test_daily_budget_survives_worker_restart_and_counts_failures(tmp_path):
    path = tmp_path / 'budget.json'
    for _ in range(90):
        worker.DailyRequests(path, now=lambda: 1800000000, sleep=lambda _: None).reserve()
    with pytest.raises(RuntimeError, match='Daily'):
        worker.DailyRequests(path, now=lambda: 1800000000, sleep=lambda _: None).reserve()
    assert json.loads(path.read_text())['requests'] == 90
    worker.DailyRequests(path, now=lambda: 1800086400, sleep=lambda _: None).reserve()
    assert json.loads(path.read_text())['requests'] == 1


def test_reservation_spaces_requests_across_process_restarts(tmp_path):
    path = tmp_path / 'budget.json'
    sleeps = []
    worker.DailyRequests(path, now=lambda: 1800000000, sleep=sleeps.append).reserve()
    worker.DailyRequests(path, now=lambda: 1800000001, sleep=sleeps.append).reserve()
    assert sleeps[-1] == 2


def test_normalized_cache_is_validated_before_application():
    row = record()
    worker.validate(row, {'id': 'person', 'orcid': ORCID})
    for key, value in [('version', 1), ('person_id', 'other'), ('orcid', 'wrong'), ('status', 'error')]:
        bad = {**copy.deepcopy(row), key: value}
        with pytest.raises(ValueError):
            worker.validate(bad, {'id': 'person', 'orcid': ORCID})
    for key, value in [('doc_type', 'PROJECT'), ('id', '../bad'), ('titles', []), ('year', 1800),
                       ('subjects', [{'name': 'Sosyoloji'}]), ('doi', 'https://doi.org/10.1234/a')]:
        bad = copy.deepcopy(row)
        bad['verified'][0][key] = value
        with pytest.raises(ValueError):
            worker.validate(bad, {'id': 'person', 'orcid': ORCID})


def test_empty_source_does_not_become_a_delete_snapshot():
    row = {**record(), 'status': 'no_record', 'author_id': None, 'verified': []}
    class NoQueries:
        def execute(self, *_):
            pytest.fail('Empty source must not execute deletes or updates')
    assert worker.apply(NoQueries(), row) == ({}, [])


def test_disabled_network_mode_does_not_even_connect(monkeypatch):
    monkeypatch.delenv('TRDIZIN_REFRESH_ENABLED', raising=False)
    monkeypatch.setattr('sys.argv', ['worker'])
    monkeypatch.setattr(worker.psycopg, 'connect', lambda *_args, **_kwargs: pytest.fail('No DB expected'))
    worker.main()


def test_apply_casts_all_parameters_and_keeps_review_outcomes():
    seen = []
    class Fake:
        def execute(self, query, values, **options):
            assert options == {'prepare': True}
            seen.append((query, values))
            return self
        def fetchone(self):
            return {'result': {'status': 'title_review'}}
    counts, reviews = worker.apply(Fake(), record())
    assert counts == {'title_review': 1}
    assert reviews == [{'source_id': '12', 'person_id': 'person', 'status': 'title_review'}]
    assert seen[0][0].count('%s::') == 9
