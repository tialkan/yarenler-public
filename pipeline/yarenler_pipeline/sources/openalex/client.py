"""OpenAlex HTTP istemcisi (httpx).

- Anahtar ``Authorization: Bearer`` başlığıyla gönderilir; adrese yazılmaz,
  böylece httpx'in istek logunda da görünmez.
- Anahtar varsa imleçli sayfalama (``cursor=``), yoksa sayfa numaralı
  sayfalama kullanılır. 22 Ekim 2026'da anahtarsız imleçli sayfalama ilk
  sayfadan sonra 401 döndürüyor; sayfa numaralı yol en fazla 10.000 sonuca
  kadar çalışır.
- 429 ve 5xx yanıtlarında ``Retry-After`` ya da üstel geri çekilme.
  "Plan upgrade required" 429'u bütçe değil plan sorunudur, tekrar denenmez.
- ``from_updated_date`` (artımlı mod) OpenAlex'te ücretli "daily sync"
  planlarına bağlı (Member+ ve Partner). Ücretsiz anahtarla ``PlanUpgradeRequired``
  döner; o durumda ``from_publication_date`` penceresiyle yedek mod kullanılır.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterator
from typing import Any

import httpx

from .budget import BudgetExceeded, DailyBudget, Kind
from .keyfile import redact
from .models import Author, Institution, Work, short_id

log = logging.getLogger(__name__)

BASE_URL = "https://api.openalex.org"
USER_AGENT = "YarenlerBot/0.1 (+https://yarenler.org/bot)"

# 22 Ekim 2026'da doğrulandı (data/reports/2026-10-22-openalex-envanter.md)
AYBU_OPENALEX_ID = "I4210150808"
AYBU_ROR = "https://ror.org/05ryemn72"

MAX_PER_PAGE = 100
BASIC_PAGING_LIMIT = 10_000

WORK_SELECT = (
    "id,doi,title,display_name,publication_year,publication_date,language,type,"
    "cited_by_count,abstract_inverted_index,primary_topic,topics,authorships,"
    "updated_date,open_access"
)
AUTHOR_SELECT = (
    "id,display_name,orcid,works_count,cited_by_count,last_known_institutions,"
    "topics,updated_date"
)


class OpenAlexError(RuntimeError):
    pass


class PlanUpgradeRequired(OpenAlexError):
    """İstenen filtre ücretli plan gerektiriyor (ör. from_updated_date)."""


def _kind(path: str, params: dict[str, Any]) -> Kind:
    if params.get("search") or ".search" in str(params.get("filter", "")):
        return "search"
    parts = [p for p in path.strip("/").split("/") if p]
    if len(parts) >= 2:
        return "single"
    return "list"


class OpenAlexClient:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        budget: DailyBudget | None = None,
        transport: httpx.BaseTransport | None = None,
        base_url: str = BASE_URL,
        timeout: float = 30.0,
        max_retries: int = 5,
        backoff_base: float = 1.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._key = api_key
        self.budget = budget or DailyBudget.for_mode(has_key=bool(api_key))
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self._sleep = sleep
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._http = httpx.Client(
            base_url=base_url, headers=headers, timeout=timeout, transport=transport
        )

    # -- yaşam döngüsü ------------------------------------------------------
    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "OpenAlexClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def __repr__(self) -> str:  # anahtar asla görünmez
        return f"OpenAlexClient(has_key={bool(self._key)})"

    @property
    def has_key(self) -> bool:
        return bool(self._key)

    # -- çekirdek istek ----------------------------------------------------
    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        params = {k: v for k, v in (params or {}).items() if v is not None}
        kind = _kind(path, params)
        attempt = 0
        while True:
            self.budget.check(kind)
            try:
                resp = self._http.get(path, params=params)
            except httpx.TransportError as exc:
                self.budget.record(kind)
                if attempt >= self.max_retries:
                    raise OpenAlexError(f"Ağ hatası: {type(exc).__name__}") from None
                self._backoff(attempt, None)
                attempt += 1
                continue
            data: dict[str, Any] = {}
            try:
                data = resp.json()
            except ValueError:
                data = {}
            cost = (data.get("meta") or {}).get("cost_usd") if isinstance(data, dict) else None
            self.budget.record(kind, cost)
            if resp.status_code == 200:
                return data
            msg = redact(f"{resp.status_code} {data.get('error', '')}: {data.get('message', '')}", self._key)
            if resp.status_code == 429 and "plan upgrade" in str(data.get("error", "")).lower():
                raise PlanUpgradeRequired(msg)
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt >= self.max_retries:
                    raise OpenAlexError(f"Tekrar denemeler tükendi: {msg}")
                log.warning("OpenAlex %s, geri çekiliyor (deneme %d)", resp.status_code, attempt + 1)
                self._backoff(attempt, resp.headers.get("Retry-After"))
                attempt += 1
                continue
            raise OpenAlexError(msg)

    def _backoff(self, attempt: int, retry_after: str | None) -> None:
        delay = self.backoff_base * (2**attempt)
        if retry_after:
            try:
                delay = max(delay, float(retry_after))
            except ValueError:
                pass
        self._sleep(min(delay, 120.0))

    # -- yardımcılar --------------------------------------------------------
    def count(self, entity: str, filter: str) -> int:
        data = self.get(f"/{entity}", {"filter": filter, "per_page": 1, "select": "id"})
        return int(data["meta"]["count"])

    def group_by(self, entity: str, filter: str, key: str, per_page: int | None = None) -> list[dict[str, Any]]:
        data = self.get(f"/{entity}", {"filter": filter, "group_by": key, "per_page": per_page})
        return list(data.get("group_by") or [])

    def iter_list(
        self,
        entity: str,
        *,
        filter: str | None = None,
        select: str | None = None,
        sort: str | None = None,
        per_page: int = MAX_PER_PAGE,
        max_records: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        """Liste uç noktasını sonuna kadar dolaşır. Kimliğe göre tekilleştirir."""
        per_page = min(per_page, MAX_PER_PAGE)
        base = {"filter": filter, "select": select, "per_page": per_page}
        seen: set[str] = set()
        yielded = 0
        if self.has_key:
            cursor: str | None = "*"
            while cursor:
                data = self.get(f"/{entity}", {**base, "sort": sort, "cursor": cursor})
                results = data.get("results") or []
                for rec in results:
                    rid = rec.get("id")
                    if rid in seen:
                        continue
                    seen.add(rid)
                    yield rec
                    yielded += 1
                    if max_records and yielded >= max_records:
                        return
                cursor = (data.get("meta") or {}).get("next_cursor") if results else None
            return
        # Anahtarsız: sayfa numaralı, kararlı sıralama ile
        if not sort:
            sort = "publication_date" if entity == "works" else "works_count:desc"
        page = 1
        total: int | None = None
        while True:
            if (page - 1) * per_page >= BASIC_PAGING_LIMIT:
                log.warning("Sayfa numaralı sınır (10.000) aşıldı; anahtar ve imleç gerekir.")
                break
            data = self.get(f"/{entity}", {**base, "sort": sort, "page": page})
            total = (data.get("meta") or {}).get("count", total)
            results = data.get("results") or []
            for rec in results:
                rid = rec.get("id")
                if rid in seen:
                    continue
                seen.add(rid)
                yield rec
                yielded += 1
                if max_records and yielded >= max_records:
                    return
            if not results or (total is not None and page * per_page >= total):
                break
            page += 1
        if total is not None and len(seen) < min(total, BASIC_PAGING_LIMIT):
            log.warning("Beklenen %s kayıt, tekil %s kayıt alındı.", total, len(seen))

    # -- varlıklar ----------------------------------------------------------
    def institution_by_ror(self, ror: str) -> list[Institution]:
        data = self.get("/institutions", {"filter": f"ror:{ror}"})
        return [Institution.model_validate(r) for r in data.get("results") or []]

    def get_work(self, work_id: str, select: str | None = WORK_SELECT) -> Work:
        return Work.from_api(self.get(f"/works/{short_id(work_id)}", {"select": select}))

    def get_author(self, author_id: str, select: str | None = AUTHOR_SELECT) -> Author:
        return Author.model_validate(self.get(f"/authors/{short_id(author_id)}", {"select": select}))

    def iter_institution_works(
        self,
        institution_id: str = AYBU_OPENALEX_ID,
        *,
        from_updated_date: str | None = None,
        from_publication_date: str | None = None,
        to_publication_date: str | None = None,
        select: str = WORK_SELECT,
        max_records: int | None = None,
    ) -> Iterator[Work]:
        """Kurum bağlantılı yayınlar.

        ``from_updated_date`` artımlı moddur ve ücretli plan ister; plan yoksa
        ``PlanUpgradeRequired`` yükselir. Ücretsiz yedek: son N günün
        ``from_publication_date`` penceresi + haftalık tam yenileme.
        """
        parts = [f"institutions.id:{short_id(institution_id)}"]
        if from_updated_date:
            parts.append(f"from_updated_date:{from_updated_date}")
        if from_publication_date:
            parts.append(f"from_publication_date:{from_publication_date}")
        if to_publication_date:
            parts.append(f"to_publication_date:{to_publication_date}")
        for rec in self.iter_list("works", filter=",".join(parts), select=select, max_records=max_records):
            yield Work.from_api(rec)

    def iter_institution_authors(
        self,
        institution_id: str = AYBU_OPENALEX_ID,
        *,
        select: str = AUTHOR_SELECT,
        max_records: int | None = None,
    ) -> Iterator[Author]:
        """``last_known_institutions`` bu kurum olan yazarlar."""
        flt = f"last_known_institutions.id:{short_id(institution_id)}"
        for rec in self.iter_list("authors", filter=flt, select=select, sort="works_count:desc", max_records=max_records):
            yield Author.model_validate(rec)


__all__ = [
    "AYBU_OPENALEX_ID",
    "AYBU_ROR",
    "BudgetExceeded",
    "OpenAlexClient",
    "OpenAlexError",
    "PlanUpgradeRequired",
]
