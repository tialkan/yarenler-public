"""Haftalık (pazar) ORCID yeniden kontrolü (0.4 kararı 3).

Yalnız ORCID'i eksik profillerin ANA sayfası yeniden okunur ve başlıktaki Orcid bağlantısı aranır.
Zamanlama dışarıdadır (Coolify zamanlanmış görevi); burada yalnız mantık vardır.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Callable

from pydantic import BaseModel, Field

from .parse import ana
from .profil import TABAN, orcid_bul

_KULLANICI = re.compile(r"^[A-Za-z0-9._-]+$")


class OrcidKontrolRaporu(BaseModel):
    tarih: dt.date
    kontrol_edilen: int = 0
    bulunan: dict[str, str] = Field(default_factory=dict)  # kullanıcı -> ORCID
    hala_eksik: list[str] = Field(default_factory=list)
    hatali: dict[str, str] = Field(default_factory=dict)  # kullanıcı -> hata açıklaması (sessiz atlama yok)


def pazar_mi(gun: dt.date) -> bool:
    return gun.weekday() == 6


def ana_sayfa_url(kullanici: str, taban: str = TABAN) -> str:
    if not _KULLANICI.match(kullanici):
        raise ValueError(f"geçersiz kullanıcı adı: {kullanici!r}")
    return f"{taban}/{kullanici}"


def haftalik_orcid_kontrolu(
    eksikler: list[str],
    cek: Callable[[str], str | None],
    bugun: dt.date | None = None,
    pazar_zorunlu: bool = True,
    taban: str = TABAN,
) -> OrcidKontrolRaporu:
    """cek(url) -> HTML ya da None (değişmedi/okunamadı). Gerçekte KibarIstemci.cek sarılarak verilir."""
    bugun = bugun or dt.date.today()
    if pazar_zorunlu and not pazar_mi(bugun):
        raise RuntimeError(f"ORCID kontrolü yalnız pazar çalışır; bugün {bugun.isoformat()}")
    rapor = OrcidKontrolRaporu(tarih=bugun)
    for k in dict.fromkeys(eksikler):  # sıra korunur, tekrarlar bir kez
        rapor.kontrol_edilen += 1
        try:
            html = cek(ana_sayfa_url(k, taban))
        except Exception as e:  # tek profildeki hata işi durdurmaz ama raporlanır
            rapor.hatali[k] = f"{e.__class__.__name__}: {e}"
            continue
        if html is None:
            rapor.hatali[k] = "sayfa içeriği alınamadı"
            continue
        sayfa = ana.ayristir(html)
        orcid, _ = orcid_bul(sayfa.ortak)
        if orcid:
            rapor.bulunan[k] = orcid
        else:
            rapor.hala_eksik.append(k)
    return rapor


def istemci_cekici(istemci) -> Callable[[str], str | None]:
    """KibarIstemci için sarmalayıcı: koşulsuz istek (ORCID değişimi ETag'e yansımayabilir)."""

    def cek(url: str) -> str | None:
        return istemci.cek(url, kosullu=False).icerik

    return cek
