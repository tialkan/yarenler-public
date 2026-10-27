"""`yarenler` komut satırı giriş noktası.

Komut biçimi (plan 10.1): ``uv run yarenler <aşama> --kurum aybu``

Bu dosya yalnız iskelettir. Aşamanın sahibi ajan (plan 9.3) işlevini kendi
modülünde yazar ve IMPLEMENTATIONS sözlüğüne aşamanın asıl adıyla bağlar.
Uygulanmamış bir aşama çağrılırsa komut sessizce geçmez, hata koduyla döner.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Sequence

from yarenler_pipeline import __version__

# Aşama adı -> (ASCII takma ad, açıklama, sahibi). Sıra plan 10.1 tablosuyla aynıdır.
# Asıl ad Türkçe yazılır; ASCII takma ad yalnız klavye kolaylığı içindir.
STAGES: dict[str, tuple[str, str, str]] = {
    "keşif": ("kesif", "Kaynak başına kişi listesi", "A1, A2"),
    "çekme": ("cekme", "Ham dosya ve source_record", "A1, A2"),
    "ayrıştırma": ("ayristirma", "Kaynak kayıtları (JSON Schema)", "A1, A2"),
    "normalleştirme": ("normallestirme", "Normalize kayıtlar", "A3"),
    "kimlik": ("kimlik-cozumleme", "Kimlik çözümleme: person, alias, identifier", "A3"),
    "zenginleştirme": ("zenginlestirme", "Yayın, özet, konu", "A2"),
    "özet": ("ozet", "LLM ile özet, yöntem ve alan çıkarımı", "A4"),
    "gömme": ("gomme", "Profil vektörleri", "A4"),
    "sıcaklık": ("sicaklik", "affinity tablosu", "A4"),
    "yerleşim": ("yerlesim", "map_point ve küme adları", "A4"),
    "çağrılar": ("cagrilar", "Fon çağrıları", "A9"),
    "yayın": ("yayin", "Veritabanına yayın ve fark raporu", "A3"),
}

# Kaynak ve bakım komutları (plan 0.4). Aşamalardan bağımsız, doğrudan çalıştırılır.
COMMANDS: dict[str, tuple[str, str]] = {
    "avesis": ("AVESİS keşif ve çekme (robots.txt uyumlu)", "A1"),
    "avesis-yayinlar": ("Yayınları ham depodan yeniden ayrıştır: kaynak adı, AVESİS adresi, kaynak tarihi (ağ yok)", "A1"),
    "openalex": ("OpenAlex yazar, yayın ve konu çekme", "A2"),
    "orcid-sync": ("ORCID'i eksik profiller için AVESİS'i yeniden kontrol (haftalık, pazar)", "A1, A3"),
    "areas": ("Çalışma alanı havuzunu kurma ve eş anlamlı birleştirme (yapay zekâ en son çare)", "A2, A4"),
}

# Sahibi ajanlar gerçek işlevleri buraya bağlar: asıl ad -> işlev(args) -> çıkış kodu
IMPLEMENTATIONS: dict[str, Callable[[argparse.Namespace], int]] = {}


def _avesis(args: argparse.Namespace) -> int:
    from yarenler_pipeline.sources.avesis.calistir import calistir
    return calistir(args)


IMPLEMENTATIONS["avesis"] = _avesis


def _avesis_yayinlar(args: argparse.Namespace) -> int:
    from yarenler_pipeline.sources.avesis.yayin_zenginlestir import calistir
    return calistir(args)


IMPLEMENTATIONS["avesis-yayinlar"] = _avesis_yayinlar


def parser_olustur() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="yarenler",
        description="Yarenler veri hattı. Her aşama tekrar çalıştırılabilir ve rapor yazar.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="stage", metavar="<aşama>")
    for name, (alias, description, owner) in STAGES.items():
        p = sub.add_parser(name, aliases=[alias], help=f"{description} (sahibi: {owner})")
        p.set_defaults(stage_name=name)
        p.add_argument("--kurum", required=True, help="Kurum kısa adı, ör. aybu")
    for name, (description, owner) in COMMANDS.items():
        p = sub.add_parser(name, help=f"{description} (sahibi: {owner})")
        p.set_defaults(stage_name=name)
        p.add_argument("--kurum", default="aybu", help="Kurum kısa adı (varsayılan: aybu)")
        p.add_argument("--kuru", action="store_true", help="Veritabanına yazmadan çalıştır, yalnız rapor üret")
        if name == "avesis":
            p.add_argument("--sekmeler", default="ana,arastirma,yayinlar", help="Virgüllü sekme listesi")
            p.add_argument("--aralik", type=float, default=1.0, help="İstekler arası en az saniye (varsayılan 1)")
            p.add_argument("--sinir", type=int, default=0, help="Deneme için en fazla şu kadar profil (0: hepsi)")
        if name == "avesis-yayinlar":
            p.add_argument("--girdi", help="Profil JSONL (varsayılan: data/avesis/<kurum>/profiller.jsonl)")
            p.add_argument("--cikti", help="Yazılacak JSONL (varsayılan: data/avesis/<kurum>/profiller-yayinli.jsonl)")
            p.add_argument("--ham", help="Ham depo kökü (varsayılan: data/raw/avesis)")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = parser_olustur()
    args = parser.parse_args(argv)
    if args.stage is None:
        parser.print_help()
        return 0
    func = IMPLEMENTATIONS.get(args.stage_name)
    if func is None:
        print(f"'{args.stage_name}' henüz uygulanmadı.", file=sys.stderr)
        return 2
    return func(args)


if __name__ == "__main__":
    raise SystemExit(main())
