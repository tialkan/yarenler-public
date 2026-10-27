#!/usr/bin/env python3
"""AVESİS iki dilli alan sözlüğünü ham araştırma sayfalarından çıkarır.

AVESİS'in herkese açık /{kullanici}/arastirma sayfası, kurumun kendi sınıflama ağacını
`var researchAreaNames = {...}` olarak gömülü verir: her düğümde "Primary" (Türkçe) ve
"Secondary" (İngilizce) ad bulunur (avesistopic, wostopic, scopustopic). Bu betik bu
sözlüğü birleştirir ve göç 0011'deki `alan_ad_sozlugu` tablosu için SQL VALUES satırları
yazar. Çeviri yapılmaz; yalnız kaynağın kendi İngilizce adı kullanılır.

Kullanım:
    python3 scripts/avesis_alan_sozlugu.py data/raw/avesis/avesis.aybu.edu.tr > /tmp/sozluk.sql
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

SEMA = {"avesistopic": "avesis", "wostopic": "wos", "scopustopic": "scopus"}
ISARET = "var researchAreaNames = "


def sozluk(kok: Path) -> dict[tuple[str, str], tuple[str, str]]:
    birlesik: dict[tuple[str, str], tuple[str, str]] = {}
    for dosya in sorted(kok.glob("*/arastirma.html.gz")):
        html = gzip.open(dosya, "rt", encoding="utf-8", errors="replace").read()
        konum = html.find(ISARET)
        if konum < 0:
            continue
        veri, _ = json.JSONDecoder().raw_decode(html[konum + len(ISARET):])
        for sema, dugumler in veri.items():
            if sema not in SEMA:
                continue
            for kimlik, ad in dugumler.items():
                tr, en = (ad.get("Primary") or "").strip(), (ad.get("Secondary") or "").strip()
                if tr and en:
                    birlesik.setdefault((SEMA[sema], kimlik), (tr, en))
    return birlesik


def sql_metin(deger: str) -> str:
    return "'" + deger.replace("'", "''") + "'"


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    kayitlar = sozluk(Path(sys.argv[1]))
    sirali = sorted(kayitlar.items(), key=lambda x: (x[0][0], int(x[0][1]) if x[0][1].isdigit() else 0, x[0][1]))
    satirlar = [f"({sql_metin(sema)},{sql_metin(kimlik)},{sql_metin(tr)},{sql_metin(en)})" for (sema, kimlik), (tr, en) in sirali]
    print(",\n".join(satirlar) + ";")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
