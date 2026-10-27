"""OpenAlex kaynağı (A2).

Kullanım özeti:

    from yarenler_pipeline.sources.openalex import OpenAlexClient, load_api_key
    with OpenAlexClient(api_key=load_api_key()) as oa:
        for work in oa.iter_institution_works(AYBU_OPENALEX_ID):
            ...

Erişim koşulu ve bütçe: docs/sources/openalex.md
"""

from .abstract import abstract_from_inverted_index
from .budget import BudgetExceeded, DailyBudget
from .client import (
    AYBU_OPENALEX_ID,
    AYBU_ROR,
    OpenAlexClient,
    OpenAlexError,
    PlanUpgradeRequired,
)
from .keyfile import ApiKeyError, extract_key, load_api_key, strip_rtf
from .models import Author, Institution, Topic, Work

__all__ = [
    "AYBU_OPENALEX_ID",
    "AYBU_ROR",
    "ApiKeyError",
    "Author",
    "BudgetExceeded",
    "DailyBudget",
    "Institution",
    "OpenAlexClient",
    "OpenAlexError",
    "PlanUpgradeRequired",
    "Topic",
    "Work",
    "abstract_from_inverted_index",
    "extract_key",
    "load_api_key",
    "strip_rtf",
]
