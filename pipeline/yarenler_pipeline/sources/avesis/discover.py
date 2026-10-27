"""Kişi ve yayın listesi keşfi: sitemap_index.xml -> cvpages.xml ve publications.xml?page=N.

lastmod ile artımlı liste çıkarılır. 22 Ekim 2026'da sitemap_index.xml içinde lastmod yoktu;
alt haritalarda (avesis-yapi.md'ye göre) günlük lastmod var.
"""

from __future__ import annotations

import datetime as dt
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from urllib.parse import urlsplit

from pydantic import BaseModel

NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


class KesifHatasi(Exception):
    pass


class HaritaGirdisi(BaseModel):
    loc: str
    lastmod: dt.datetime | dt.date | None = None


class ProfilAdresi(HaritaGirdisi):
    kullanici: str


@dataclass
class ArtimliListe:
    yeni: list[str]
    degisen: list[str]
    ayni: list[str]
    kalkan: list[str]


def _guvenli_xml(metin: str | bytes) -> ET.Element:
    ham = metin if isinstance(metin, str) else metin.decode("utf-8")
    if "<!DOCTYPE" in ham.upper() or "<!ENTITY" in ham.upper():
        raise KesifHatasi("site haritasında DOCTYPE/ENTITY kabul edilmez")
    try:
        return ET.fromstring(ham.encode("utf-8"))
    except ET.ParseError as e:
        raise KesifHatasi(f"site haritası ayrıştırılamadı: {e}") from e


def _tarih(s: str | None) -> dt.datetime | dt.date | None:
    if not s:
        return None
    s = s.strip()
    try:
        if "T" in s:
            return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def _girdiler(kok: ET.Element, kap: str) -> list[HaritaGirdisi]:
    out = []
    for el in kok.findall(f"{NS}{kap}"):
        loc = (el.findtext(f"{NS}loc") or "").strip()
        if not loc:
            continue
        out.append(HaritaGirdisi(loc=loc, lastmod=_tarih(el.findtext(f"{NS}lastmod"))))
    return out


def site_haritasi_dizini(metin: str | bytes) -> list[HaritaGirdisi]:
    kok = _guvenli_xml(metin)
    if kok.tag != f"{NS}sitemapindex":
        raise KesifHatasi(f"beklenen sitemapindex, gelen {kok.tag}")
    return _girdiler(kok, "sitemap")


def url_kumesi(metin: str | bytes) -> list[HaritaGirdisi]:
    kok = _guvenli_xml(metin)
    if kok.tag != f"{NS}urlset":
        raise KesifHatasi(f"beklenen urlset, gelen {kok.tag}")
    return _girdiler(kok, "url")


def harita_turu(loc: str) -> str:
    yol = urlsplit(loc).path.rsplit("/", 1)[-1]
    if yol.startswith("cvpages"):
        return "profil"
    if yol.startswith("publications"):
        return "yayin"
    return "bilinmeyen"


def profil_adresleri(metin: str | bytes) -> list[ProfilAdresi]:
    """cvpages.xml: her adres /{kullanici}. Kullanıcı adı yalnız adres için kullanılır, kimlik bizden gelir."""
    out = []
    for g in url_kumesi(metin):
        parcalar = [p for p in urlsplit(g.loc).path.split("/") if p]
        if len(parcalar) != 1:
            raise KesifHatasi(f"beklenmeyen profil adresi: {g.loc}")
        out.append(ProfilAdresi(loc=g.loc, lastmod=g.lastmod, kullanici=parcalar[0]))
    return out


def artimli(guncel: list[HaritaGirdisi], onceki: dict[str, str | None]) -> ArtimliListe:
    """onceki: {loc: lastmod ISO metni ya da None}. lastmod yoksa adres 'değişen' sayılır (yeniden çekilir)."""
    yeni, degisen, ayni = [], [], []
    gorulen = set()
    for g in guncel:
        gorulen.add(g.loc)
        lm = g.lastmod.isoformat() if g.lastmod else None
        if g.loc not in onceki:
            yeni.append(g.loc)
        elif lm is None or onceki[g.loc] != lm:
            degisen.append(g.loc)
        else:
            ayni.append(g.loc)
    kalkan = [loc for loc in onceki if loc not in gorulen]
    return ArtimliListe(yeni, degisen, ayni, kalkan)


def kesfet(istemci, dizin_url: str) -> dict[str, list[HaritaGirdisi]]:
    """Canlı keşif: dizin ve alt haritaları KibarIstemci ile okur. Tam tarama onayı olmadan çağrılmaz."""
    sonuc = istemci.cek(dizin_url)
    if sonuc.icerik is None:
        raise KesifHatasi(f"site haritası dizini okunamadı ({sonuc.durum})")
    out: dict[str, list[HaritaGirdisi]] = {"profil": [], "yayin": [], "bilinmeyen": []}
    for g in site_haritasi_dizini(sonuc.icerik):
        tur = harita_turu(g.loc)
        if tur == "bilinmeyen":
            out["bilinmeyen"].append(g)
            continue
        alt = istemci.cek(g.loc)
        if alt.icerik is None:
            raise KesifHatasi(f"alt harita okunamadı: {g.loc} ({alt.durum})")
        out[tur].extend(profil_adresleri(alt.icerik) if tur == "profil" else url_kumesi(alt.icerik))
    return out
