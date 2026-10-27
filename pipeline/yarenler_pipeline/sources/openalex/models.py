"""OpenAlex varlıkları için pydantic modelleri.

Yalnız Yarenler'in kullandığı alanlar tanımlıdır; diğerleri yok sayılır.
``select=`` ile daraltılmış yanıtlar da doğrulanır (tüm alanlar isteğe bağlı).
Kimlikler kısa biçime (``W123``, ``A123``, ``I123``, ``T123``) çevrilir.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .abstract import abstract_from_inverted_index

OPENALEX_PREFIX = "https://openalex.org/"


def short_id(value: str | None) -> str | None:
    """``https://openalex.org/W123`` -> ``W123``. Diğer biçimler olduğu gibi."""
    if value is None:
        return None
    return value[len(OPENALEX_PREFIX):] if value.startswith(OPENALEX_PREFIX) else value


def bare_doi(value: str | None) -> str | None:
    """``https://doi.org/10.x/Y`` -> ``10.x/y`` (DOI büyük-küçük harf duyarsızdır)."""
    if not value:
        return None
    v = value.strip()
    for p in ("https://doi.org/", "http://doi.org/", "doi:"):
        if v.lower().startswith(p):
            v = v[len(p):]
    return v.lower() or None


def bare_orcid(value: str | None) -> str | None:
    if not value:
        return None
    return value.rsplit("/", 1)[-1] or None


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class _IdModel(_Base):
    id: str

    @field_validator("id", mode="before")
    @classmethod
    def _short(cls, v: Any) -> Any:
        return short_id(v) if isinstance(v, str) else v


class Ref(_Base):
    """Konu hiyerarşisindeki alt alan, alan ve alan grubu başvurusu."""

    id: str | None = None
    display_name: str | None = None


class Institution(_IdModel):
    display_name: str | None = None
    ror: str | None = None
    country_code: str | None = None
    type: str | None = None
    lineage: list[str] = Field(default_factory=list)
    display_name_alternatives: list[str] = Field(default_factory=list)
    works_count: int | None = None
    cited_by_count: int | None = None

    @field_validator("lineage", mode="before")
    @classmethod
    def _lineage(cls, v: Any) -> Any:
        return [short_id(x) for x in v] if isinstance(v, list) else (v or [])


class Topic(_IdModel):
    display_name: str | None = None
    score: float | None = None
    count: int | None = None
    subfield: Ref | None = None
    field: Ref | None = None
    domain: Ref | None = None
    works_count: int | None = None


class AuthorRef(_Base):
    id: str | None = None
    display_name: str | None = None
    orcid: str | None = None

    @field_validator("id", mode="before")
    @classmethod
    def _short(cls, v: Any) -> Any:
        return short_id(v) if isinstance(v, str) else v


class Authorship(_Base):
    author_position: str | None = None
    author: AuthorRef = Field(default_factory=AuthorRef)
    institutions: list[Institution] = Field(default_factory=list)
    is_corresponding: bool | None = None
    raw_author_name: str | None = None
    raw_affiliation_strings: list[str] = Field(default_factory=list)

    def has_institution(self, institution_id: str) -> bool:
        iid = short_id(institution_id)
        return any(i.id == iid or iid in i.lineage for i in self.institutions)


class Work(_IdModel):
    doi: str | None = None
    title: str | None = None
    display_name: str | None = None
    publication_year: int | None = None
    publication_date: str | None = None
    language: str | None = None
    type: str | None = None
    cited_by_count: int | None = None
    abstract_inverted_index: dict[str, list[int]] | None = None
    primary_topic: Topic | None = None
    topics: list[Topic] = Field(default_factory=list)
    authorships: list[Authorship] = Field(default_factory=list)
    updated_date: str | None = None
    is_oa: bool | None = None

    @field_validator("doi", mode="before")
    @classmethod
    def _doi(cls, v: Any) -> Any:
        return bare_doi(v) if isinstance(v, str) else v

    @property
    def abstract(self) -> str | None:
        return abstract_from_inverted_index(self.abstract_inverted_index)

    def institution_author_ids(self, institution_id: str) -> list[str]:
        """Bu yayında verilen kurumla bağlantılı yazarların kısa kimlikleri."""
        return [
            a.author.id
            for a in self.authorships
            if a.author.id and a.has_institution(institution_id)
        ]

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "Work":
        d = dict(data)
        oa = d.get("open_access")
        if isinstance(oa, dict) and "is_oa" not in d:
            d["is_oa"] = oa.get("is_oa")
        return cls.model_validate(d)


class Author(_IdModel):
    display_name: str | None = None
    orcid: str | None = None
    works_count: int | None = None
    cited_by_count: int | None = None
    last_known_institutions: list[Institution] = Field(default_factory=list)
    topics: list[Topic] = Field(default_factory=list)
    updated_date: str | None = None

    @property
    def orcid_id(self) -> str | None:
        return bare_orcid(self.orcid)
