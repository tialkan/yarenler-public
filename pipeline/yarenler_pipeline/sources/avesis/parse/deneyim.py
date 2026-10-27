"""Akademik ve idari deneyim /{kullanici}/deneyim: unvanlar, idari görevler, akademi dışı deneyim, verdiği dersler."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from ..metin import bos_ise_none
from ..models import DeneyimSayfasi, DersKaydi, GorevKaydi, Uyari
from .ortak import (
    agac, bolumler, genel_liste_kaydi, h3_ayir, liste_ogeleri, metin, ortak_baslik, rozet_kontrol, tarih_coz,
)

DERS_DUZEYLERI = {"Ön Lisans", "Lisans", "Yüksek Lisans", "Doktora"}


def _gorev(bolum: str, li, akademik: bool) -> GorevKaydi:
    etiket, baslik, _ = h3_ayir(li)
    ham = metin(li.css_first(".description p"))
    p = [x for x in (bos_ise_none(s) for s in ham.split(",")) if x is not None] if ham else []
    k = GorevKaydi(bolum=bolum, tarih=tarih_coz(etiket), baslik=baslik, parcalar=p, ham=ham)
    if akademik:
        # "Üniversite, Fakülte, Bölüm"
        k.universite = p[0] if p else None
        k.fakulte = p[1] if len(p) > 1 else None
        k.birim = ", ".join(p[2:]) or None
    else:
        # Görülen kalıp: "Kurum türü, Kurum, Birim, Rol". Ham metin her zaman saklanır.
        k.universite = p[1] if len(p) > 1 else (p[0] if p else None)
        k.birim = ", ".join(p[2:-1]) or None if len(p) > 3 else None
    return k


def _dersler(li) -> list[DersKaydi]:
    duzey = None
    ilk = li.css_first("span")
    if ilk is not None and ilk.parent is not None and ilk.parent.tag == "li":
        duzey = metin(ilk)
    out = []
    for h3 in li.css("h3.title"):
        ders_id = None
        a = h3.css_first("a[data-link]")
        if a is not None:
            q = parse_qs(urlsplit(a.attributes.get("data-link") or "").query)
            ders_id = (q.get("lessonId") or [None])[0]
        out.append(DersKaydi(duzey=duzey, ad=metin(h3), avesis_ders_id=ders_id))
    return out


def ayristir(html: str, kaynak_url: str | None = None) -> DeneyimSayfasi:
    t = agac(html)
    ortak, uyarilar = ortak_baslik(t)
    sonuc = DeneyimSayfasi(sekme="deneyim", kaynak_url=kaynak_url, ortak=ortak)
    for b in bolumler(t):
        ogeler = liste_ogeleri(b.govde)
        if b.baslik == "Akademik Ünvanlar":
            sonuc.akademik_unvanlar.extend(_gorev(b.baslik, li, True) for li in ogeler)
            sayi = len(ogeler)
        elif b.baslik == "İdari Görevler":
            sonuc.idari_gorevler.extend(_gorev(b.baslik, li, True) for li in ogeler)
            sayi = len(ogeler)
        elif b.baslik == "Akademi Dışı Deneyim":
            sonuc.akademi_disi.extend(_gorev(b.baslik, li, False) for li in ogeler)
            sayi = len(ogeler)
        elif b.baslik == "Verdiği Dersler":
            dersler = [d for li in ogeler for d in _dersler(li)]
            for d in dersler:
                if d.duzey not in DERS_DUZEYLERI:
                    uyarilar.append(Uyari(kod="bilinmeyen_ders_duzeyi", bolum=b.baslik,
                                          mesaj=f"tanınmayan düzey {d.duzey!r}: {d.ad}"))
            sonuc.dersler.extend(dersler)
            sayi = len(dersler)  # rozet toplamı = ders sayısı
        else:
            uyarilar.append(Uyari(kod="bilinmeyen_bolum", bolum=b.baslik,
                                  mesaj="deneyim sekmesinde tanınmayan bölüm; genel kayıt olarak ayrıştırıldı"))
            sonuc.diger.extend(genel_liste_kaydi(b.baslik, li) for li in ogeler)
            sayi = len(ogeler)
        r, u = rozet_kontrol(b, sayi)
        sonuc.rozetler.append(r)
        uyarilar += u
    if not sonuc.rozetler:
        uyarilar.append(Uyari(kod="bos_sayfa", mesaj="sayfada bölüm yok"))
    sonuc.uyarilar = uyarilar
    return sonuc
