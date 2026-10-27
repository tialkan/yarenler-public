"""OpenAlex günlük bütçe sayacı.

OpenAlex bütçeyi dolar cinsinden UTC gece yarısı sıfırlar (docs/sources/openalex.md).
22 Ekim 2026'da gözlenen istek maliyetleri (yanıttaki ``meta.cost_usd``):

- tekil kayıt (``/works/W...``): 0 dolar
- liste, filtre, ``group_by``: 0,0001 dolar
- arama (``search=``): 0,001 dolar

Anahtarsız günlük bütçe 0,10 dolar (aynı IP'yi kullanan herkesle paylaşılır),
ücretsiz anahtarla 1 dolar. Bu sınıf hem çağrı sayısını hem yanıtlardaki
gerçek maliyeti sayar ve tavan aşılmadan önce ``BudgetExceeded`` fırlatır.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Literal

Kind = Literal["single", "list", "search"]

# Görev tanımındaki günlük çağrı tavanları
KEYLESS_LIMITS: dict[str, int] = {"single": 10**9, "list": 1_000, "search": 100}
KEYED_LIMITS: dict[str, int] = {"single": 10**9, "list": 10_000, "search": 1_000}
KEYLESS_USD = 0.10
KEYED_USD = 1.00


class BudgetExceeded(RuntimeError):
    """Günlük ya da çalıştırma bütçesi doldu."""


def _utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


@dataclass
class DailyBudget:
    limits: dict[str, int]
    usd_limit: float
    run_limit: int | None = None
    state_path: Path | None = None
    today: Callable[[], str] = _utc_today
    day: str = ""
    counts: dict[str, int] = field(default_factory=lambda: {"single": 0, "list": 0, "search": 0})
    usd: float = 0.0
    run_calls: int = 0

    @classmethod
    def for_mode(
        cls,
        has_key: bool,
        run_limit: int | None = None,
        state_path: Path | None = None,
        today: Callable[[], str] = _utc_today,
    ) -> "DailyBudget":
        b = cls(
            limits=dict(KEYED_LIMITS if has_key else KEYLESS_LIMITS),
            usd_limit=KEYED_USD if has_key else KEYLESS_USD,
            run_limit=run_limit,
            state_path=state_path,
            today=today,
        )
        b._load()
        return b

    # -- kalıcılık --------------------------------------------------------
    def _load(self) -> None:
        self.day = self.today()
        if self.state_path and self.state_path.exists():
            try:
                data = json.loads(self.state_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return
            if data.get("day") == self.day:
                self.counts.update({k: int(v) for k, v in data.get("counts", {}).items()})
                self.usd = float(data.get("usd", 0.0))

    def _save(self) -> None:
        if not self.state_path:
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(
            json.dumps({"day": self.day, "counts": self.counts, "usd": round(self.usd, 6)}),
            encoding="utf-8",
        )

    def _roll(self) -> None:
        d = self.today()
        if d != self.day:
            self.day = d
            self.counts = {"single": 0, "list": 0, "search": 0}
            self.usd = 0.0

    # -- kullanım ---------------------------------------------------------
    def check(self, kind: Kind) -> None:
        """İstekten önce çağrılır. Tavan doluysa ``BudgetExceeded``."""
        self._roll()
        if self.run_limit is not None and self.run_calls >= self.run_limit:
            raise BudgetExceeded(f"Çalıştırma tavanı doldu: {self.run_calls}/{self.run_limit} çağrı.")
        if self.counts[kind] >= self.limits[kind]:
            raise BudgetExceeded(f"Günlük '{kind}' tavanı doldu: {self.counts[kind]}/{self.limits[kind]}.")
        if self.usd >= self.usd_limit:
            raise BudgetExceeded(f"Günlük dolar bütçesi doldu: {self.usd:.4f}/{self.usd_limit:.2f}.")

    def record(self, kind: Kind, cost_usd: float | None = None) -> None:
        """İstekten sonra çağrılır (yanıt başarılı olsun olmasın)."""
        self.counts[kind] += 1
        self.run_calls += 1
        if cost_usd:
            self.usd += float(cost_usd)
        self._save()

    def summary(self) -> dict[str, object]:
        return {
            "gun": self.day,
            "cagri": dict(self.counts),
            "calistirma_cagri": self.run_calls,
            "usd": round(self.usd, 6),
            "usd_tavan": self.usd_limit,
        }
