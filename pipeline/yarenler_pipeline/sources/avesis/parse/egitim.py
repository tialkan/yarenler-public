"""Eğitim /{kullanici}/egitim: eğitim bilgileri ve kendi tezleri. Yabancı diller ve sertifikalar ATILIR (0.4)."""

from __future__ import annotations

from ..metin import bos_ise_none
from ..models import EgitimKaydi, EgitimSayfasi, TezKaydi, Uyari
from .ortak import (
    agac, bolumler, genel_liste_kaydi, h3_ayir, liste_ogeleri, metin, ortak_baslik, rozet_kontrol, tarih_coz, uuid_bul,
)



def _virgul_parcalari(s: str) -> list[str | None]:
    return [bos_ise_none(x) for x in s.split(",")]


def _egitim(li) -> EgitimKaydi:
    etiket, derece, _ = h3_ayir(li)
    ham = metin(li.css_first(".description p"))
    p = _virgul_parcalari(ham)
    uni = p[0] if p else None
    ulke = p[-1] if len(p) >= 2 else None
    birim = p[1] if len(p) >= 3 else None
    bolum = ", ".join(x for x in p[2:-1] if x) or None if len(p) >= 4 else None
    return EgitimKaydi(tarih=tarih_coz(etiket), derece=derece, universite=uni, birim=birim, bolum=bolum,
                       ulke=ulke, ham=ham)


def _tez(li) -> TezKaydi:
    etiket, derece, _ = h3_ayir(li)
    a = li.css_first("a.thesis-detail-link")
    href = a.attributes.get("href") if a is not None else None
    ps = li.css(".description > p")
    kurum = None
    for p in ps:
        if p.css_first("a.thesis-detail-link") is None:
            kurum = bos_ise_none(metin(p)) or kurum
    return TezKaydi(tarih=tarih_coz(etiket), derece=derece, baslik=metin(a.css_first("strong") or a) if a else "",
                    avesis_tez_id=uuid_bul(href), url=href, kurum_ham=kurum)


ISLEYICILER = {
    "Eğitim Bilgileri": ("egitim", _egitim),
    "Yaptığı Tezler": ("tezler", _tez),
}
ATILAN_BOLUMLER = {"Yabancı Diller", "Sertifika, Kurs ve Eğitimler", "Burslar"}


def ayristir(html: str, kaynak_url: str | None = None) -> EgitimSayfasi:
    t = agac(html)
    ortak, uyarilar = ortak_baslik(t)
    sonuc = EgitimSayfasi(sekme="egitim", kaynak_url=kaynak_url, ortak=ortak)
    for b in bolumler(t):
        ogeler = liste_ogeleri(b.govde)
        if b.baslik in ATILAN_BOLUMLER:
            sonuc.atilan_bolumler.append(b.baslik)
            continue
        if b.baslik in ISLEYICILER:
            alan, f = ISLEYICILER[b.baslik]
            getattr(sonuc, alan).extend(f(li) for li in ogeler)
        else:
            uyarilar.append(Uyari(kod="bilinmeyen_bolum", bolum=b.baslik,
                                  mesaj="eğitim sekmesinde tanınmayan bölüm; genel kayıt olarak ayrıştırıldı"))
            sonuc.diger.extend(genel_liste_kaydi(b.baslik, li) for li in ogeler)
        r, u = rozet_kontrol(b, len(ogeler))
        sonuc.rozetler.append(r)
        uyarilar += u
    if not sonuc.rozetler:
        uyarilar.append(Uyari(kod="bos_sayfa", mesaj="sayfada bölüm yok"))
    sonuc.uyarilar = uyarilar
    return sonuc
