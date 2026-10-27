"""Ana sayfa /{kullanici}: kurum bilgileri, üç araştırma alanı listesi, metrikler. Biyografi ve iletişim ATILIR (0.4)."""

from __future__ import annotations

import re

from selectolax.lexbor import LexborHTMLParser

from ..metin import baslik_duzeni, bos_ise_none, temizle, virgullu_liste
from ..models import AnaSayfa, ArastirmaAlanlari, KurumBilgisi, Uyari
from .ortak import agac, bolumler, kendi_metni, metin, metrikler, ortak_baslik

BILINEN_BOLUMLER = {"Metrikler"}
ATILAN_BOLUMLER = {"Biyografi", "İletişim"}  # okunmaz, yalnız adı kaydedilir
_ALAN_ETIKETI = re.compile(r"^(.*)Araştırma Alanları:$")
_SEMA = {"avesis": "avesis", "wos": "wos", "scopus": "scopus"}


def arastirma_alanlari(t: LexborHTMLParser) -> tuple[ArastirmaAlanlari, list[Uyari]]:
    """strong 'X Araştırma Alanları:' etiketinden sonra gelen virgüllü liste (ana sayfa ve arastirma sekmesi)."""
    sonuc = ArastirmaAlanlari()
    uyarilar = []
    kok = t.css_first("main") or t.root
    for st in kok.css("strong"):
        etiket = metin(st)
        m = _ALAN_ETIKETI.match(etiket)
        if not m:
            continue
        kap = st.parent
        deger = temizle(metin(kap)[len(etiket):]) if kap is not None else ""
        semalar = [s.strip().lower() for s in m.group(1).split("/") if s.strip()]
        taninan = [s for s in semalar if s in _SEMA]
        if not taninan or len(taninan) != len(semalar):
            uyarilar.append(Uyari(kod="bilinmeyen_alan_semasi", mesaj=f"tanınmayan etiket: {etiket!r}"))
        if len(taninan) > 1:
            uyarilar.append(Uyari(kod="birlesik_alan_etiketi",
                                  mesaj=f"tek etikette birden çok şema: {etiket!r}; liste hepsine yazıldı"))
        for s in taninan:
            getattr(sonuc, _SEMA[s]).extend(baslik_duzeni(x) for x in virgullu_liste(deger))
    return sonuc, uyarilar


def _kurum(ham: str, p: list[str | None]) -> KurumBilgisi:
    """Parçalar başlık düzeninde (bağlaçlar küçük), ham metin özgün haliyle saklanır."""
    return KurumBilgisi(ham=ham, fakulte=baslik_duzeni(p[0]), bolum=baslik_duzeni(p[1]),
                        anabilim_dali=baslik_duzeni(", ".join(x for x in p[2:] if x) or None))


def ayristir(html: str, kaynak_url: str | None = None) -> AnaSayfa:
    t = agac(html)
    ortak, uyarilar = ortak_baslik(t)
    kurum = None
    ci = t.css_first("span.corporateInformation")
    legacy_parts = []
    if ci is None:
        for heading in t.css(".identity-header-info > h4"):
            if heading.css_first("strong") is None:
                value = kendi_metni(heading)
                if value:
                    legacy_parts.append(value)
            if len(legacy_parts) == 2:
                break
        if legacy_parts:
            ham = ", ".join(legacy_parts)
            p = [bos_ise_none(x) for x in ham.split(",")]
            p += [None] * max(0, 3-len(p))
            kurum = _kurum(ham, p)
    if ci is not None:
        ham = kendi_metni(ci)
        p = [bos_ise_none(x) for x in ham.split(",")]
        p += [None] * (3 - len(p))
        if len(p) > 3:
            uyarilar.append(Uyari(kod="kurum_parca_sayisi", mesaj=f"beklenen 3 parça, gelen {len(p)}: {ham!r}"))
        kurum = _kurum(ham, p)
    alanlar, u = arastirma_alanlari(t)
    uyarilar += u
    atilan = []
    for b in bolumler(t):
        if b.baslik in ATILAN_BOLUMLER:
            atilan.append(b.baslik)
        elif b.baslik not in BILINEN_BOLUMLER:
            uyarilar.append(Uyari(kod="bilinmeyen_bolum", bolum=b.baslik, mesaj="ana sayfada tanınmayan bölüm"))
    return AnaSayfa(sekme="ana", kaynak_url=kaynak_url, ortak=ortak, kurum=kurum, arastirma_alanlari=alanlar,
                    metrikler=metrikler(t), uyarilar=uyarilar, atilan_bolumler=atilan)
