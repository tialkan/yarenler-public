#!/usr/bin/env python3
"""Kullanıcıya görünen metin denetimi (plan 14.1 kural 7, webtasarim.md bölüm 3).

apps/ ve packages/ altındaki kullanıcıya görünen dosyalarda şunları arar:
- em dash karakteri (U+2014)
- yasaklı ifadeler (büyük-küçük harf ve Türkçe I/İ duyarsız)

Kullanım:
    python3 scripts/check_copy.py            # varsayılan: apps ve packages
    python3 scripts/check_copy.py yol1 yol2  # belirli dosya ya da klasörler

Bulgu varsa 1 ile çıkar ve her bulguyu dosya:satır:sütun biçiminde yazar.
"""

from __future__ import annotations

import sys
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
VARSAYILAN_KLASORLER = ("apps", "packages")
UZANTILAR = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".swift", ".json", ".strings", ".stringsdict", ".xcstrings", ".md", ".mdx", ".html"}
ATLANAN_KLASORLER = {"node_modules", ".next", ".next-dev", "out", "dist", "build", "coverage", "DerivedData", ".build", "Pods", ".venv", ".git"}
ATLANAN_DOSYALAR = {"AGENTS.md", "package-lock.json", "package.json", "tsconfig.json", "Package.resolved"}

EM_DASH = "\u2014"
YASAKLI_IFADELER = (
    "yenilikçi çözümler",
    "dijital dönüşüm yolculuğu",
    "sınırları zorluyoruz",
    "geleceği şekillendiriyoruz",
    "sinerji",
    "vizyoner",
    "kusursuz",
    "benzersiz deneyim",
    "bir sonraki seviye",
)


def tr_kucuk(metin: str) -> str:
    """Türkçe kurallarla küçük harfe çevirir (I -> ı, İ -> i)."""
    return metin.replace("I", "ı").replace("İ", "i").lower()


YASAKLI_KUCUK = tuple(tr_kucuk(i) for i in YASAKLI_IFADELER)


def dosyalar(yollar: list[Path]):
    for yol in yollar:
        if yol.is_file():
            yield yol
            continue
        if not yol.is_dir():
            continue
        for dosya in sorted(yol.rglob("*")):
            if not dosya.is_file():
                continue
            parcalar = set(dosya.relative_to(yol).parts[:-1])
            if parcalar & ATLANAN_KLASORLER:
                continue
            if dosya.suffix not in UZANTILAR or dosya.name in ATLANAN_DOSYALAR:
                continue
            # docs/ altındaki md dosyaları kullanıcıya görünmez, atlanır
            if dosya.suffix in {".md", ".mdx"} and "docs" in dosya.relative_to(yol).parts:
                continue
            yield dosya


def denetle(dosya: Path) -> list[str]:
    bulgular = []
    try:
        metin = dosya.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as hata:
        return [f"{dosya}: okunamadı ({hata})"]
    for satir_no, satir in enumerate(metin.splitlines(), start=1):
        sutun = satir.find(EM_DASH)
        if sutun != -1:
            bulgular.append(f"{dosya}:{satir_no}:{sutun + 1}: em dash (U+2014)")
        kucuk = tr_kucuk(satir)
        for ifade, ifade_kucuk in zip(YASAKLI_IFADELER, YASAKLI_KUCUK):
            sutun = kucuk.find(ifade_kucuk)
            if sutun != -1:
                bulgular.append(f"{dosya}:{satir_no}:{sutun + 1}: yasaklı ifade \"{ifade}\"")
    return bulgular


def main(argv: list[str]) -> int:
    yollar = [Path(a) for a in argv] if argv else [KOK / k for k in VARSAYILAN_KLASORLER]
    sayi = 0
    bulgular: list[str] = []
    for dosya in dosyalar(yollar):
        sayi += 1
        bulgular.extend(denetle(dosya))
    for b in bulgular:
        print(b)
    print(f"{sayi} dosya denetlendi, {len(bulgular)} bulgu.")
    return 1 if bulgular else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
