import pytest

from yarenler_pipeline.sources.openalex import BudgetExceeded, DailyBudget


def test_anahtarsiz_tavanlar():
    b = DailyBudget.for_mode(has_key=False)
    assert b.limits["list"] == 1000 and b.limits["search"] == 100 and b.usd_limit == 0.10


def test_calistirma_tavani():
    b = DailyBudget.for_mode(has_key=False, run_limit=2)
    for _ in range(2):
        b.check("list")
        b.record("list", 0.0001)
    with pytest.raises(BudgetExceeded):
        b.check("single")


def test_dolar_tavani():
    b = DailyBudget.for_mode(has_key=False)
    b.record("search", 0.10)
    with pytest.raises(BudgetExceeded):
        b.check("single")


def test_kalicilik_ve_gun_degisimi(tmp_path):
    day = {"v": "2026-10-22"}
    path = tmp_path / "butce.json"
    b = DailyBudget.for_mode(has_key=True, state_path=path, today=lambda: day["v"])
    b.check("list")
    b.record("list", 0.0001)
    b2 = DailyBudget.for_mode(has_key=True, state_path=path, today=lambda: day["v"])
    assert b2.counts["list"] == 1
    day["v"] = "2026-10-23"
    b2.check("list")
    assert b2.counts["list"] == 0 and b2.usd == 0
