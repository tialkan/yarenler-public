"""Araştırma alanları /{kullanici}/arastirma. JavaScript ile dolan faaliyete dayalı listeler Faz 1'de kullanılmaz."""

from __future__ import annotations

from ..models import ArastirmaSayfasi, Uyari
from .ana import arastirma_alanlari
from .ortak import agac, bolumler, ortak_baslik

BILINEN_BOLUMLER = {"Araştırma Alanları", "Akademik Faaliyetlere Dayalı Araştırma Alanları"}


def ayristir(html: str, kaynak_url: str | None = None) -> ArastirmaSayfasi:
    t = agac(html)
    ortak, uyarilar = ortak_baslik(t)
    alanlar, u = arastirma_alanlari(t)
    uyarilar += u
    for b in bolumler(t):
        if b.baslik not in BILINEN_BOLUMLER:
            uyarilar.append(Uyari(kod="bilinmeyen_bolum", bolum=b.baslik, mesaj="araştırma sekmesinde tanınmayan bölüm"))
        elif b.baslik.startswith("Akademik Faaliyetlere"):
            dolu = any(ul.css_first("li") is not None for ul in b.dugum.css("ul[id$='Areas']"))
            if dolu:
                uyarilar.append(Uyari(kod="beklenmeyen_statik_icerik", bolum=b.baslik,
                                      mesaj="faaliyete dayalı alanlar statik HTML'de dolu geldi; ayrıştırıcı güncellenmeli"))
    return ArastirmaSayfasi(sekme="arastirma", kaynak_url=kaynak_url, ortak=ortak,
                            arastirma_alanlari=alanlar, uyarilar=uyarilar)
