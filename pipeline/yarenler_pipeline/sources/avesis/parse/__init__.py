"""Sekme ayrıştırıcıları (selectolax). Her biri `ayristir(html, kaynak_url=None)` sunar."""

from . import ana, arastirma, deneyim, egitim, yayinlar

AYRISTIRICILAR = {
    "ana": ana.ayristir,
    "arastirma": arastirma.ayristir,
    "deneyim": deneyim.ayristir,
    "egitim": egitim.ayristir,
    "yayinlar": yayinlar.ayristir,
}

__all__ = ["AYRISTIRICILAR"]
