import json

import logging

import httpx

import pytest

from yarenler_pipeline.sources.openalex import (
    AYBU_OPENALEX_ID,
    BudgetExceeded,
    DailyBudget,
    OpenAlexClient,
    OpenAlexError,
    PlanUpgradeRequired,
)

FAKE = "FAKEKEY0testonly9x8y7z6w5v4u"

def _page(results, count, next_cursor=None, cost=0.0001):
    return {"meta": {"count": count, "next_cursor": next_cursor, "cost_usd": cost}, "results": results}

def make(handler, key=None, **kw):
    sleeps = []
    c = OpenAlexClient(api_key=key, transport=httpx.MockTransport(handler), sleep=sleeps.append, **kw)
    return c, sleeps

def test_sayfa_numarali_anahtarsiz():
    pages = []

    def h(req):
        p = int(req.url.params["page"])
        pages.append(p)
        assert "cursor" not in req.url.params
        assert req.url.params["sort"] == "publication_date"
        assert "Authorization" not in req.headers
        data = {1: [{"id": "W1"}, {"id": "W2"}], 2: [{"id": "W3"}]}[p]
        return httpx.Response(200, json=_page(data, 3))

    c, _ = make(h)
    ids = [r["id"] for r in c.iter_list("works", filter="x", per_page=2)]
    assert ids == ["W1", "W2", "W3"] and pages == [1, 2]

def test_429_geri_cekilme_retry_after():
    calls = {"n": 0}

    def h(req):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, headers={"Retry-After": "7"}, json={"error": "Too Many Requests"})
        return httpx.Response(200, json=_page([], 0))

    c, sleeps = make(h)
    assert c.count("works", "x") == 0
    assert sleeps == [7.0, 7.0]
    assert c.budget.run_calls == 3

def test_429_ustel_ve_tukenme():
    def h(req):
        return httpx.Response(503)

    c, sleeps = make(h, max_retries=3)
    with pytest.raises(OpenAlexError):
        c.count("works", "x")
    assert sleeps == [1.0, 2.0, 4.0]

def test_artimli_filtre_iletilir():
    got = {}

    def h(req):
        got["f"] = req.url.params["filter"]
        return httpx.Response(200, json=_page([], 0))

    c, _ = make(h, key=FAKE)
    list(c.iter_institution_works(from_updated_date="2026-10-21"))
    assert got["f"] == f"institutions.id:{AYBU_OPENALEX_ID},from_updated_date:2026-10-21"

def test_butce_istekten_once_durdurur():
    n = {"v": 0}

    def h(req):
        n["v"] += 1
        return httpx.Response(200, json=_page([{"id": f"W{n['v']}"}], 10))

    c, _ = make(h, budget=DailyBudget.for_mode(has_key=False, run_limit=2))
    with pytest.raises(BudgetExceeded):
        list(c.iter_list("works", filter="x", per_page=1))
    assert n["v"] == 2

def test_anahtar_loglara_girmez(caplog):
    def h(req):
        return httpx.Response(400, json={"error": "bad", "message": f"api_key={FAKE} gecersiz"})

    caplog.set_level(logging.DEBUG)
    c, _ = make(h, key=FAKE)
    with pytest.raises(OpenAlexError) as e:
        c.count("works", "x")
    assert FAKE not in str(e.value)
    assert FAKE not in caplog.text
