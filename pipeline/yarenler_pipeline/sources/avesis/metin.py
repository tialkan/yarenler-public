"""Türkçe metin yardımcıları: boşluk ve Unicode normalleştirme, tr yerel ayarına uygun büyük-küçük harf.

Türkçe karakterler hiçbir aşamada ASCII'ye düşürülmez (plan 14.1 kural 6).
"""

from __future__ import annotations

import re
import unicodedata

_BOSLUK = re.compile(r"\s+")


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def temizle(s: str | None) -> str:
    """NFC, &nbsp; ve art arda boşlukları tek boşluğa indirir, kenarları kırpar."""
    if s is None:
        return ""
    s = nfc(s).replace(" ", " ")
    return _BOSLUK.sub(" ", s).strip()


def bos_ise_none(s: str | None) -> str | None:
    """'-' ya da boş metin AVESİS'te 'veri yok' demektir."""
    t = temizle(s)
    return None if t in ("", "-") else t


def tr_kucuk(s: str) -> str:
    return nfc(s.replace("I", "ı").replace("İ", "i").lower())


def tr_buyuk(s: str) -> str:
    return nfc(s.replace("i", "İ").replace("ı", "I").upper())


_KELIME = re.compile(r"([\s\-/(]+|['’])")


def tr_baslik(s: str) -> str:
    """'TARIK İSMET ALKAN' -> 'Örnek Araştırmacı'. Kesme işaretinden sonra küçük harf: "KIBRIS'IN" -> "Kıbrıs'ın"."""
    parcalar = _KELIME.split(temizle(s))
    out: list[str] = []
    kesme_sonrasi = False
    for p in parcalar:
        if not p:
            continue
        if _KELIME.fullmatch(p):
            out.append(p)
            kesme_sonrasi = p in ("'", "’")
            continue
        if kesme_sonrasi:
            out.append(tr_kucuk(p))
        else:
            out.append(tr_buyuk(p[0]) + tr_kucuk(p[1:]))
        kesme_sonrasi = False
    return "".join(out)


_BAGLACLAR = {
    "İle İlgili": "ile ilgili", "Ile Ilgili": "ile ilgili", "Ya Da": "ya da", "Veya": "veya", "Ve": "ve",
    "İle": "ile", "Ile": "ile", "İçin": "için", "Için": "için", "And": "and", "Of": "of", "In": "in", "For": "for",
}
_BAGLAC = re.compile(r"(\s)(" + "|".join(map(re.escape, _BAGLACLAR)) + r")(?=[\s,;:.)]|$)")


def baslik_duzeni(s: str | None) -> str | None:
    """Birim ve alan adlarında ilk kelime dışındaki bağlaçları küçük yazar; diğer harflere dokunmaz.

    'Ağız, Diş Ve Çene Cerrahisi' -> 'Ağız, Diş ve Çene Cerrahisi'. Türkçe: ve, ile, ya da, veya, için,
    ile ilgili; İngilizce: and, of, in, for. Web (text-case.ts) ve göç 0010 ile aynı kural. Ham metin
    (KurumBilgisi.ham) değişmez.
    """
    if s is None:
        return None
    return _BAGLAC.sub(lambda m: m.group(1) + _BAGLACLAR[m.group(2)], s)


def virgullu_liste(s: str | None) -> list[str]:
    t = temizle(s)
    if not t:
        return []
    return [x for x in (temizle(p) for p in t.split(",")) if x]
