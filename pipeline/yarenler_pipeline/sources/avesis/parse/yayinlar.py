"""Yayınlar /{kullanici}/yayinlar: başlık, yıl, tür, OpenAlex W kimliği, DOI, sıralı yazarlar.

a.journalDetailModalLink hedefi (/journal/...) robots.txt'de kapalıdır: izlenmez, yalnız metni alınır.
/publication/showdocument/... izlenmez, yalnız varlığı not edilir.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

from ..metin import temizle
from ..models import Uyari, Yayin, YayinlarSayfasi, Kisi
from .ortak import agac, bolumler, kisi_listesi, metin, metrikler, ortak_baslik, rozet_kontrol, uuid_bul

BOLUM_TURLERI = {
    "Makaleler": "makale",
    "Hakemli Bilimsel Toplantılarda Yayımlanmış Bildiriler": "bildiri",
    "Kitaplar": "kitap",
    "Kitap & Kitap Bölümleri": "kitap_bolumu",
    "Kitap Bölümleri": "kitap_bolumu",
    "Ansiklopedide Bölümler": "ansiklopedi_bolumu",
    "Diğer Yayınlar": "diger",
}
BILINEN_DIGER = {"Metrikler"}

_YIL = re.compile(r"\b(19\d{2}|20\d{2})\b")
_INDEKS = re.compile(r"\(([^()]+)\)\s*$")
_W = re.compile(r"openalex\.org/works/(W\d+)", re.I)
_SIRA = re.compile(r"^(\d+)\.$")
_CILT = re.compile(r"cilt\.\s*([^,]+)")
_SAYI = re.compile(r"sa\.\s*([^,]+)")
_SAYFA = re.compile(r"ss\.\s*(\w+)\s*-\s*(\w+)")
_FILTRE = re.compile(r"^(.*?)\s*\((\d+)\)$")
BILDIRI_TURLERI = ("Tam Metin Bildiri", "Özet Bildiri")
_AYLAR = "Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık"
# Bildiri kaynağındaki etkinlik tarihi: "22 - 26 Aralık 2021", "30 Nisan - 04 Mayıs 2025", "01 Mart 2019".
_ETKINLIK_TARIHI = re.compile(rf"^\d{{1,2}}\b.*\b({_AYLAR})\b.*\b(19|20)\d{{2}}$")
_KAYNAK_SONU = ("cilt.", "sa.", "ss.", "(")
GENEL_KAYNAKLAR = {"Diğer"}
KAYNAK_EN_UZUN = 300


def kaynak_adi(tur: str, dergi: str | None, kaynak_ham: str | None) -> str | None:
    """Yayının görünen kaynağı: makalede dergi, bildiride etkinlik, kitapta kitap ya da yayınevi adı.

    Yalnız AVESİS'in yazdığı metinden türetilir; bulunamazsa None (uydurma yok).
    """
    if dergi:
        ad = temizle(dergi).lstrip(". ").strip()
        return ad[:KAYNAK_EN_UZUN] or None
    parcalar = [p for p in (temizle(x) for x in (kaynak_ham or "").split(",")) if p]
    if not parcalar:
        return None
    if tur == "bildiri":
        # Ad [, şehir, ülke], tarih, cilt/sayfa...: tarihten önceki parçalar; şehir ve ülke varsa düşer.
        son = next((i for i, p in enumerate(parcalar) if _ETKINLIK_TARIHI.match(p) or p.startswith(_KAYNAK_SONU)),
                   len(parcalar))
        ad_parcalari = parcalar[:son]
        if len(ad_parcalari) >= 3:
            ad_parcalari = ad_parcalari[:-2]
        ad = ", ".join(ad_parcalari)
    else:
        ad = parcalar[0]
        if ad.startswith(_KAYNAK_SONU) or _YIL.fullmatch(ad) or ad in GENEL_KAYNAKLAR:
            return None
    ad = ad.lstrip(". ").strip()
    return ad[:KAYNAK_EN_UZUN] or None


def _kaynak_metni(cit) -> str:
    """İkinci .citation içindeki görünür kaynak metni (bağlantı simgeleri metin taşımaz)."""
    return temizle(metin(cit).replace(" ,", ","))


def _yil(kaynak: str, tur: str) -> int | None:
    # Bildiride etkinlik tarihi yer alır ("22 - 26 Aralık 2021"); ilk yıl yayın yılı kabul edilir.
    yillar = [int(y) for y in _YIL.findall(kaynak)]
    if not yillar:
        return None
    return yillar[-1] if tur == "makale" else yillar[0]


def _baglantilar(y: Yayin, item) -> None:
    """OpenAlex W kimliği, DOI (plu.mx), lisans ve tam metin varlığı; bağlantılar izlenmez."""
    for lnk in item.css("a[href]"):
        h = lnk.attributes.get("href") or ""
        w = _W.search(h)
        if w:
            y.openalex_id = w.group(1)
        elif "plu.mx" in h and "doi=" in h:
            y.doi = (parse_qs(urlsplit(h).query).get("doi") or [None])[0]
        elif "creativecommons.org" in h:
            y.lisans_url = h
        elif h.startswith("/publication/showdocument/"):
            y.avesis_tam_metin = True


def _yayin(bolum: str, tur: str, item) -> Yayin:
    a = item.css_first("h3.title a")
    href = a.attributes.get("href") if a is not None else None
    sira = None
    if a is not None:
        sp = a.css_first("span")
        m = _SIRA.match(metin(sp)) if sp is not None else None
        sira = int(m.group(1)) if m else None
    baslik = metin(a.css_first("strong") if a is not None and a.css_first("strong") is not None else a)
    cits = item.css(".description > .citation")
    yazarlar = kisi_listesi(cits[0]) if cits else []
    kaynak_ham = _kaynak_metni(cits[1]) if len(cits) > 1 else ""
    y = Yayin(bolum=bolum, tur=tur, sira_no=sira, avesis_yayin_id=uuid_bul(href), url=href, baslik=baslik,
              yazarlar=yazarlar, kaynak_ham=kaynak_ham, yil=_yil(kaynak_ham, tur))
    dergi = item.css_first("a.journalDetailModalLink")
    if dergi is not None:
        y.dergi = metin(dergi) or None
    m = _CILT.search(kaynak_ham)
    y.cilt = temizle(m.group(1)) if m else None
    m = _SAYI.search(kaynak_ham)
    y.sayi = temizle(m.group(1)) if m else None
    m = _SAYFA.search(kaynak_ham)
    if m:
        y.sayfa_baslangic, y.sayfa_bitis = m.group(1), m.group(2)
    m = _INDEKS.search(kaynak_ham)
    if m:
        ic = temizle(m.group(1))
        if ic in BILDIRI_TURLERI:
            y.bildiri_turu = ic
        elif tur == "makale":
            y.indeksler = [temizle(x) for x in ic.split(",") if temizle(x)]
    _baglantilar(y, item)
    dis = item.css_first("a.link-with-icon")
    if dis is not None:
        y.dis_baglanti = dis.attributes.get("href")
    filtre = item.attributes.get("data-filters")
    if filtre:
        y.filtre_etiketleri = [x for x in filtre.split() if x]
    return y


def ayristir(html: str, kaynak_url: str | None = None) -> YayinlarSayfasi:
    t = agac(html)
    ortak, uyarilar = ortak_baslik(t)
    sonuc = YayinlarSayfasi(sekme="yayinlar", kaynak_url=kaynak_url, ortak=ortak, metrikler=metrikler(t))
    for b in bolumler(t):
        if b.baslik in BILINEN_DIGER:
            continue
        tur = BOLUM_TURLERI.get(b.baslik)
        if tur is None:
            uyarilar.append(Uyari(kod="bilinmeyen_bolum", bolum=b.baslik,
                                  mesaj="yayınlar sekmesinde tanınmayan bölüm; tür 'bilinmeyen' olarak ayrıştırıldı"))
            tur = "bilinmeyen"
        ogeler = list(b.govde.css(".pub-item")) if b.govde is not None else []
        sonuc.yayinlar.extend(_yayin(b.baslik, tur, it) for it in ogeler)
        for f in (b.govde.css(".filter-container .filter") if b.govde is not None else []):
            m = _FILTRE.match(metin(f))
            if m and f.attributes.get("data-key") != "all":
                ad = m.group(1)
                sonuc.indeks_dagilimi[ad] = sonuc.indeks_dagilimi.get(ad, 0) + int(m.group(2))
        r, u = rozet_kontrol(b, len(ogeler))
        sonuc.rozetler.append(r)
        uyarilar += u
    for y in sonuc.yayinlar:
        if not y.baslik:
            uyarilar.append(Uyari(kod="bos_baslik", bolum=y.bolum, mesaj=f"başlıksız yayın kaydı: {y.url}"))
    # Legacy profile template embeds attributable publications on the public profile itself.
    if not sonuc.yayinlar:
        seen = set()
        for item in t.css('.pubs-wrapper .cv-item'):
            link = item.css_first('a[href^="/yayin/"]')
            title = link.css_first('h3 strong') if link is not None else None
            if title is None:
                continue
            href = link.attributes.get('href', '')
            if href in seen:
                continue
            seen.add(href)
            period = metin(item.css_first('.period'))
            match = _YIL.search(period)
            # Eski şablonda dergi bağlantısı yalnız makalelerde bulunur (yeni şablonda da yalnız Makaleler bölümünde).
            dergi = item.css_first('a.journalDetailModalLink')
            h5 = item.css_first('h5 span')
            y = Yayin(bolum='Yayınlar', tur='makale' if dergi is not None else 'bilinmeyen',
                avesis_yayin_id=uuid_bul(href), url=href, baslik=metin(title),
                yil=int(match.group(1)) if match else None,
                yazarlar=[Kisi(sira=i+1,ham_ad=metin(a)) for i,a in enumerate(item.css('a.authorsRichText'))],
                kaynak_ham=_kaynak_metni(h5) if h5 is not None else "",
                dergi=(metin(dergi) or None) if dergi is not None else None)
            _baglantilar(y, item)
            sonuc.yayinlar.append(y)
    if not sonuc.yayinlar:
        uyarilar.append(Uyari(kod="bos_sayfa", mesaj="yayın kaydı yok"))
    sonuc.uyarilar = uyarilar
    return sonuc
