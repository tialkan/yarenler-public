"""Sekme sonuçlarını 0.4 kararlarındaki sade profile birleştirir.

Asıl çıktılar: ad (özgün ve Türkçe kurallı), unvan, birim, AVESİS kullanıcı adı ve adresi, ORCID, YÖK authorId,
üç sınıflamada araştırma alanları. İkincil: yayınlar (profilde yalnız sayı ve son beş yayın), ders adları, kendi tez başlıkları.
Biyografi, iletişim, burs, hakemlik, üyelik hiçbir alanda yer almaz.
"""

from __future__ import annotations

import re

from .metin import baslik_duzeni
from .parse.yayinlar import kaynak_adi
from .models import (
    Ad, AnaSayfa, ArastirmaAlanlari, ArastirmaSayfasi, DeneyimSayfasi, EgitimSayfasi, Ikincil, KurumBilgisi,
    OrtakBaslik, Profil, SayfaSonucu, Unvan, Uyari, YayinlarSayfasi, YayinOzeti,
)

TABAN = "https://avesis.aybu.edu.tr"
ORCID_KALIBI = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")
_YAYIN_YOLU = re.compile(r"^/yayin/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[^\s?#]*)?$")


def orcid_dogrula(deger: str | None) -> bool:
    """Biçim ve ISO 7064 11,2 sağlama basamağı denetimi."""
    if not deger or not ORCID_KALIBI.match(deger):
        return False
    rakamlar = deger.replace("-", "")
    toplam = 0
    for c in rakamlar[:-1]:
        toplam = (toplam + int(c)) * 2
    sonuc = (12 - toplam % 11) % 11
    beklenen = "X" if sonuc == 10 else str(sonuc)
    return rakamlar[-1] == beklenen


def orcid_bul(ortak: OrtakBaslik) -> tuple[str | None, list[Uyari]]:
    """Başlıktaki Orcid bağlantısından ORCID. Yoksa (None, ['orcid_yok'])."""
    adaylar = [k for k in ortak.dis_kimlikler if k.tur == "orcid"]
    if not adaylar:
        return None, [Uyari(kod="orcid_yok", mesaj="başlıkta Orcid bağlantısı yok; haftalık yeniden kontrol listesine")]
    deger = adaylar[0].deger
    if not orcid_dogrula(deger):
        return None, [Uyari(kod="orcid_gecersiz", mesaj=f"Orcid bağlantısı geçersiz: {adaylar[0].url!r}")]
    return deger, []


def _yok_id(ortak: OrtakBaslik) -> str | None:
    return next((k.deger for k in ortak.dis_kimlikler if k.tur == "yok_author" and k.deger), None)


def yayin_adresi(href: str | None, taban: str = TABAN) -> str | None:
    """Yayının AVESİS ayrıntı sayfası: yalnız aynı kökteki /yayin/<uuid>/... yolu kabul edilir."""
    if not href or not _YAYIN_YOLU.match(href):
        return None
    return taban.rstrip("/") + href


def yayin_ozetleri(yay: YayinlarSayfasi, taban: str = TABAN) -> list[YayinOzeti]:
    return [YayinOzeti(baslik=y.baslik, yil=y.yil, tur=y.tur, openalex_id=y.openalex_id, doi=y.doi,
                       yazarlar=[k.ham_ad for k in sorted(y.yazarlar, key=lambda k: k.sira)],
                       kaynak_adi=kaynak_adi(y.tur, y.dergi, y.kaynak_ham),
                       avesis_yayin_id=y.avesis_yayin_id, avesis_url=yayin_adresi(y.url, taban))
            for y in yay.yayinlar if y.baslik]


def birlestir(kullanici: str, sayfalar: dict[str, SayfaSonucu], taban: str = TABAN) -> Profil:
    ana = sayfalar.get("ana")
    if not isinstance(ana, AnaSayfa):
        raise ValueError("ana sayfa sonucu zorunludur")
    uyarilar: list[Uyari] = []
    rozetler = []
    for sekme, s in sayfalar.items():
        uyarilar += [u.model_copy(update={"mesaj": f"[{sekme}] {u.mesaj}"}) for u in s.uyarilar]
        rozetler += s.rozetler

    b = ana.ortak.baslik
    ad = Ad(ozgun=b.ad_ozgun, gorunen=b.ad_gorunen, ad=b.ad, soyad=b.soyad) if b else None
    unvan = Unvan(metin=b.unvan_metni if b else None, kod=b.unvan_kodu if b else None)

    orcid, u = orcid_bul(ana.ortak)
    uyarilar += u

    birim, birim_kaynagi = ana.kurum, "ana:kurum_bilgileri" if ana.kurum else None
    den = sayfalar.get("deneyim")
    if birim is None and isinstance(den, DeneyimSayfasi):
        guncel = [g for g in den.akademik_unvanlar if g.tarih.devam_ediyor]
        if guncel:
            g = guncel[0]
            birim = KurumBilgisi(ham=g.ham, fakulte=baslik_duzeni(g.fakulte), bolum=baslik_duzeni(g.birim))
            birim_kaynagi = "deneyim:akademik_unvan"
    if birim is None:
        uyarilar.append(Uyari(kod="birim_yok", mesaj="ne Kurum Bilgileri ne süren akademik unvan bulundu"))

    ar = sayfalar.get("arastirma")
    alanlar = ar.arastirma_alanlari if isinstance(ar, ArastirmaSayfasi) else ana.arastirma_alanlari
    if isinstance(ar, ArastirmaSayfasi) and ana.arastirma_alanlari != ArastirmaAlanlari() \
            and ana.arastirma_alanlari != ar.arastirma_alanlari:
        uyarilar.append(Uyari(kod="alan_uyumsuz", mesaj="ana sayfa ve araştırma sekmesi alanları farklı; sekme esas alındı"))
    if alanlar == ArastirmaAlanlari():
        uyarilar.append(Uyari(kod="alan_yok", mesaj="üç sınıflamada da araştırma alanı yok"))

    ik = Ikincil()
    yay = sayfalar.get("yayinlar")
    if isinstance(yay, YayinlarSayfasi):
        ik.yayinlar = yayin_ozetleri(yay, taban)
    if isinstance(den, DeneyimSayfasi):
        ik.dersler = [d.ad for d in den.dersler]
    eg = sayfalar.get("egitim")
    if isinstance(eg, EgitimSayfasi):
        ik.tez_basliklari = [t.baslik for t in eg.tezler if t.baslik]

    return Profil(
        avesis_kullanici=kullanici, avesis_url=f"{taban}/{kullanici}", ad=ad, unvan=unvan, birim=birim,
        birim_kaynagi=birim_kaynagi, orcid=orcid, orcid_eksik=orcid is None, yok_author_id=_yok_id(ana.ortak),
        arastirma_alanlari=alanlar, ikincil=ik, rozetler=rozetler, uyarilar=uyarilar,
    )
