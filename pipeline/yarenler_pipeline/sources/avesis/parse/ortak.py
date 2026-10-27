"""Ortak ayrıştırma parçaları: başlık, dış kimlikler, menü, bölümler, rozet, tarih, kişi, metrik."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote, urlsplit

from selectolax.lexbor import LexborHTMLParser, LexborNode

from ..metin import bos_ise_none, temizle, tr_baslik
from ..models import (
    Baslik, DisKimlik, Kisi, ListeKaydi, MenuOgesi, Metrik, OrtakBaslik, RozetKontrolu, TarihAraligi, Uyari,
)
from ..temizlik import agactan_iletisimi_sil

# Uzundan kısaya: önce en uzun eşleşme denenir.
UNVANLAR: tuple[tuple[str, str], ...] = (
    ("Dr. Öğr. Üyesi", "dr_ogr_uyesi"),
    ("Öğr. Gör. Dr.", "ogr_gor_dr"),
    ("Arş. Gör. Dr.", "ars_gor_dr"),
    ("Prof. Dr.", "prof"),
    ("Doç. Dr.", "doc"),
    ("Uzm. Dr.", "uzm_dr"),
    ("Öğr. Gör.", "ogr_gor"),
    ("Arş. Gör.", "ars_gor"),
    ("Öğretim Görevlisi", "ogr_gor"),
    ("Araştırma Görevlisi", "ars_gor"),
    ("Uzm.", "uzm"),
    ("Okt.", "okt"),
    ("Prof.", "prof"),
    ("Doç.", "doc"),
    ("Dr.", "dr"),
)

SEKMELER = ("ana", "egitim", "arastirma", "deneyim", "yayinlar", "projeler", "bilimselfaaliyetler", "basarilar")

DIS_KIMLIK_TURLERI = {
    "google akademik": "google_scholar",
    "orcid": "orcid",
    "publons / web of science researcherid": "researcherid",
    "yöksis": "yok_author",
    "scopus": "scopus",
}

_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
_YIL = re.compile(r"\b(1[89]\d{2}|20\d{2})\b")
AYLAR = ("Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık")


def agac(html: str) -> LexborHTMLParser:
    t = LexborHTMLParser(html)
    agactan_iletisimi_sil(t)
    return t


def metin(n: LexborNode | None) -> str:
    return temizle(n.text(deep=True, separator="", strip=False)) if n is not None else ""


def kendi_metni(n: LexborNode) -> str:
    """Yalnız düğümün doğrudan metin çocukları (iç içe etiketler hariç)."""
    return temizle("".join(c.text_content or "" for c in n.iter(include_text=True) if c.tag == "-text"))


def uuid_bul(s: str | None) -> str | None:
    m = _UUID.search(s or "")
    return m.group(0).lower() if m else None


def unvan_ayir(ham: str) -> tuple[str | None, str | None, str]:
    t = temizle(ham)
    for metin_, kod in UNVANLAR:
        if t.startswith(metin_ + " ") or t == metin_:
            return metin_, kod, t[len(metin_):].strip()
    return None, None, t


def baslik_coz(ham: str) -> tuple[Baslik, list[Uyari]]:
    uyarilar = []
    unvan, kod, ad = unvan_ayir(ham)
    if unvan is None:
        uyarilar.append(Uyari(kod="bilinmeyen_unvan", mesaj=f"unvan sözlükte yok: {temizle(ham)!r}"))
    gorunen = tr_baslik(ad) if ad else ""
    parca = gorunen.split(" ")
    soyad = parca[-1] if len(parca) > 1 else None
    ad_kismi = " ".join(parca[:-1]) if len(parca) > 1 else (gorunen or None)
    return Baslik(ham=temizle(ham), unvan_metni=unvan, unvan_kodu=kod, ad_ozgun=ad, ad_gorunen=gorunen,
                  ad=ad_kismi, soyad=soyad), uyarilar


def dis_kimlik(a: LexborNode) -> DisKimlik:
    etiket = temizle(a.attributes.get("title"))
    href = a.attributes.get("href") or ""
    tur = DIS_KIMLIK_TURLERI.get(etiket.lower(), "bilinmeyen")
    p = urlsplit(href)
    q = parse_qs(p.query)
    deger: str | None
    if tur == "google_scholar":
        deger = (q.get("user") or [None])[0]
    elif tur == "yok_author":
        deger = (q.get("authorId") or [None])[0]
    elif tur == "scopus" and q.get("authorId"):
        deger = q["authorId"][0]
    elif tur in ("orcid", "researcherid", "scopus"):
        deger = unquote(p.path.rstrip("/").rsplit("/", 1)[-1]) or None
    else:
        deger = None
    return DisKimlik(tur=tur, deger=deger, url=href, etiket=etiket)


def menu_sekmesi(href: str) -> str | None:
    p = urlsplit(href)
    if p.query or href.startswith("#"):
        return None
    parca = [x for x in p.path.split("/") if x]
    if len(parca) == 1:
        return "ana"
    if len(parca) == 2 and parca[1] in SEKMELER:
        return parca[1]
    return None


def ortak_baslik(t: LexborHTMLParser) -> tuple[OrtakBaslik, list[Uyari]]:
    uyarilar: list[Uyari] = []
    h1 = t.css_first("h1.title") or t.css_first(".identity-header-info > h2")
    baslik = None
    if h1 is not None:
        baslik, u = baslik_coz(metin(h1))
        uyarilar += u
    else:
        uyarilar.append(Uyari(kod="baslik_yok", mesaj="h1.title bulunamadı"))
    kimlikler = []
    for a in t.css(".social-media-links .contact a[title], a.social-icon[title]"):
        k = dis_kimlik(a)
        if k.tur == "bilinmeyen":
            uyarilar.append(Uyari(kod="bilinmeyen_dis_kimlik", mesaj=f"tanınmayan bağlantı türü: {k.etiket!r}"))
        kimlikler.append(k)
    menu = []
    for a in t.css("#primary-menu > li > a[href]"):
        href = a.attributes.get("href") or ""
        menu.append(MenuOgesi(href=href, etiket=metin(a), sekme=menu_sekmesi(href)))
    return OrtakBaslik(baslik=baslik, dis_kimlikler=kimlikler, menu=menu), uyarilar


def menudeki_sekmeler(o: OrtakBaslik) -> list[str]:
    """Taranacak sekmeler: menüde görünen ve izinli olanlar. Menüde olmayan sekme istenmez."""
    return [m.sekme for m in o.menu if m.sekme]


@dataclass
class Bolum:
    baslik: str
    rozet: int | None
    govde: LexborNode | None
    dugum: LexborNode


def bolumler(t: LexborHTMLParser) -> list[Bolum]:
    out = []
    kok = t.css_first("main") or t.root
    for item in kok.css(".ac-item"):
        bas = item.css_first(".item-head")
        if bas is None:
            continue
        span = bas.css_first("span")
        baslik = metin(span)
        rozet_n = bas.css_first(".badge")
        rozet = None
        if rozet_n is not None:
            r = metin(rozet_n).replace(".", "")
            rozet = int(r) if r.isdigit() else None
        out.append(Bolum(baslik=baslik, rozet=rozet, govde=item.css_first(".item-body"), dugum=item))
    return out


def rozet_kontrol(b: Bolum, kayit: int) -> tuple[RozetKontrolu, list[Uyari]]:
    uyumlu = b.rozet is None or b.rozet == kayit
    u = [] if uyumlu else [Uyari(kod="rozet_uyumsuz", bolum=b.baslik,
                                 mesaj=f"rozet {b.rozet}, ayrıştırılan kayıt {kayit}")]
    return RozetKontrolu(bolum=b.baslik, rozet=b.rozet, kayit=kayit, uyumlu=uyumlu), u


def tarih_coz(ham: str) -> TarihAraligi:
    t = temizle(ham)
    devam = "Devam" in t
    yillar = [int(y) for y in _YIL.findall(t)]
    ay = next((a for a in AYLAR if t.startswith(a + " ")), None)
    bas = yillar[0] if yillar else None
    if "-" in t:
        bit = None if devam else (yillar[1] if len(yillar) > 1 else None)
    else:
        bit = bas
    return TarihAraligi(ham=t, baslangic_yil=bas, bitis_yil=bit, devam_ediyor=devam, ay=ay)


def h3_ayir(li: LexborNode) -> tuple[str, str, LexborNode | None]:
    """li içindeki ilk h3.title: (etiket metni, kalan metin, h3)."""
    h3 = li.css_first("h3.title")
    if h3 is None:
        return "", "", None
    lbl = h3.css_first(".shaded-label")
    etiket = metin(lbl)
    tum = metin(h3)
    kalan = temizle(tum[len(etiket):]) if etiket and tum.startswith(etiket) else tum
    return etiket, kalan, h3


def kisi_listesi(kap: LexborNode | None) -> list[Kisi]:
    if kap is None:
        return []
    out = []
    for i, a in enumerate(kap.css("a.authorsRichText"), start=1):
        ham = metin(a)
        editor = False
        if ham.endswith("(Editör)"):
            editor = True
            ham = temizle(ham[: -len("(Editör)")])
        nuid = a.attributes.get("data-networkuserid")
        tam = bos_ise_none(a.attributes.get("title"))
        out.append(Kisi(
            sira=i, ham_ad=ham, tam_ad=tam, kurum_ham=bos_ise_none(a.attributes.get("data-content")),
            profil_sahibi=bool(nuid) and tam is None, editor=editor, avesis_network_user_id=nuid,
        ))
    return out


def metrikler(t: LexborHTMLParser | LexborNode) -> list[Metrik]:
    out = []
    for bas in t.css(".metrics-title"):
        kap = bas.parent
        sayi = kap.css_first(".metrics-count") if kap is not None else None
        ham = metin(sayi)
        r = ham.replace(".", "").replace(",", "")
        out.append(Metrik(ad=metin(bas), deger=int(r) if r.isdigit() else None, ham=ham))
    return out


def liste_ogeleri(govde: LexborNode | None) -> list[LexborNode]:
    if govde is None:
        return []
    return list(govde.css("ul.with-shaded-label > li"))


def genel_liste_kaydi(bolum: str, li: LexborNode) -> ListeKaydi:
    etiket, kalan, h3 = h3_ayir(li)
    a = h3.css_first("a[href]") if h3 is not None else None
    baglanti = a.attributes.get("href") if a is not None else None
    tur_n = li.css_first(".citation")
    desc = li.css_first(".description")
    ayrinti = []
    kisiler: list[Kisi] = []
    if desc is not None:
        kisiler = kisi_listesi(desc)
        for p in desc.css("p"):
            if p.css_first("a.authorsRichText") is not None:
                continue
            m = metin(p)
            if m:
                ayrinti.append(m)
    return ListeKaydi(
        bolum=bolum, tarih=tarih_coz(etiket) if etiket else None, baslik=kalan, baglanti=baglanti,
        avesis_kimlik=uuid_bul(baglanti), tur=metin(tur_n) or None, kisiler=kisiler, ayrintilar=ayrinti,
    )
