"""`yarenler avesis` komutu: AYBÜ AVESİS taraması (robots.txt uyumlu, kesintiden devam eder).

Çıktı: data/avesis/<kurum>/profiller.jsonl (kişi başına bir satır, sade Profil),
       data/avesis/<kurum>/hatalar.jsonl, data/reports/<tarih>-avesis.md
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

from .client import HamDepo, IzinYok, KibarIstemci, TaramaDurdu
from .discover import kesfet
from .parse import AYRISTIRICILAR
from .policy import aybu_izin_katmani, kayitli_robots_md_den_oku
from .profil import birlestir
from .yayin_zenginlestir import kaynak_tarihi

TABAN = "https://avesis.aybu.edu.tr"


def _depo_kok() -> Path:
    # pipeline/ içinden çalıştırılır; depo kökü bir üst klasör
    here = Path.cwd()
    return here.parent if (here / "pyproject.toml").exists() else here


def ana_sayfa_yedekli(ist, kullanici: str):
    """Try public profile tabs; every URL still passes the same permission layer."""
    last_error = None
    for suffix in ("", "/arastirma", "/egitim", "/deneyim"):
        url = f"{TABAN}/{kullanici}{suffix}"
        try:
            result = ist.cek(url)
            html = result.icerik if result.icerik is not None else ist.depo.oku(url)
            if html:
                parsed = AYRISTIRICILAR["ana"](html, kaynak_url=url)
                if parsed.ortak.baslik is not None:
                    return parsed
        except IzinYok as error:
            last_error = error
    if last_error:
        raise last_error
    raise ValueError(f"{kullanici}: izin verilen sayfalarda profil başlığı bulunamadı")


def calistir(args) -> int:
    kok = _depo_kok()
    sekmeler = [s.strip() for s in (args.sekmeler or "ana,arastirma,yayinlar").split(",") if s.strip()]
    if "ana" not in sekmeler:
        sekmeler.insert(0, "ana")
    cikti = kok / "data" / "avesis" / args.kurum
    cikti.mkdir(parents=True, exist_ok=True)
    prof_dosya, hata_dosya = cikti / "profiller.jsonl", cikti / "hatalar.jsonl"
    bitenler = set()
    if prof_dosya.exists():
        for satir in prof_dosya.read_text(encoding="utf-8").splitlines():
            try:
                bitenler.add(json.loads(satir)["avesis_kullanici"])
            except Exception:
                pass

    robots = kayitli_robots_md_den_oku(kok / "docs" / "sources" / "avesis-aybu.md")
    ist = KibarIstemci(izin=aybu_izin_katmani(robots), depo=HamDepo(kok / "data" / "raw" / "avesis"),
                       en_az_aralik_sn=args.aralik, gece_penceresi_zorunlu=False)
    ist.robots_oku("avesis.aybu.edu.tr")

    harita = kesfet(ist, TABAN + "/sitemap_index.xml")
    kullanicilar = []
    for g in harita["profil"]:
        k = g.loc.rstrip("/").rsplit("/", 1)[-1]
        if k not in bitenler:
            kullanicilar.append(k)
    if args.sinir:
        kullanicilar = kullanicilar[: args.sinir]
    toplam = len(harita["profil"])
    print(f"Site haritasında {toplam} profil; {len(bitenler)} tamam, {len(kullanicilar)} çekilecek.", flush=True)

    ok = hata = 0
    baslangic = dt.datetime.now()
    try:
        with prof_dosya.open("a", encoding="utf-8") as pf, hata_dosya.open("a", encoding="utf-8") as hf:
            for i, k in enumerate(kullanicilar, 1):
                try:
                    sayfalar = {}
                    for sekme in sekmeler:
                        if sekme == "ana":
                            sayfalar["ana"] = ana_sayfa_yedekli(ist, k)
                            continue
                        url = f"{TABAN}/{k}/{sekme}"
                        if sekme != "ana":
                            menu = json.dumps(sayfalar["ana"].ortak.model_dump(mode="json").get("menu", []), ensure_ascii=False)
                            if f"/{k}/{sekme}" not in menu:
                                continue  # boş sekme menüde yok, istek atılmaz
                        s = ist.cek(url)
                        html = s.icerik if s.icerik is not None else ist.depo.oku(url)
                        if html is None:
                            raise RuntimeError(f"{url}: durum {s.durum}")
                        sayfalar[sekme] = AYRISTIRICILAR[sekme](html, kaynak_url=url)
                    p = birlestir(k, sayfalar).model_copy(update={"kaynak_tarihi": kaynak_tarihi(ist.depo, k)})
                    pf.write(json.dumps(p.model_dump(mode="json"), ensure_ascii=False) + "\n")
                    pf.flush()
                    ok += 1
                except (TaramaDurdu, KeyboardInterrupt):
                    raise
                except IzinYok as e:
                    hf.write(json.dumps({"kullanici": k, "hata": str(e)}, ensure_ascii=False) + "\n")
                    hata += 1
                except Exception as e:  # sessiz atlama yok: her hata kaydedilir
                    hf.write(json.dumps({"kullanici": k, "hata": f"{e.__class__.__name__}: {e}"}, ensure_ascii=False) + "\n")
                    hf.flush()
                    hata += 1
                if i % 25 == 0 or i == len(kullanicilar):
                    gecen = (dt.datetime.now() - baslangic).total_seconds()
                    kalan = gecen / i * (len(kullanicilar) - i)
                    print(f"[{i}/{len(kullanicilar)}] tamam {ok}, hata {hata}, kalan ~{int(kalan/60)} dk", flush=True)
    except TaramaDurdu as e:
        print(f"DURDU: {e}", file=sys.stderr)
    except KeyboardInterrupt:
        print("Kullanıcı durdurdu. Tekrar çalıştırınca kaldığı yerden devam eder.", file=sys.stderr)
    finally:
        ist.kapat()
        rapor = kok / "data" / "reports" / f"{dt.date.today().isoformat()}-avesis.md"
        rapor.parent.mkdir(parents=True, exist_ok=True)
        with rapor.open("a", encoding="utf-8") as r:
            r.write(f"\n## AVESİS taraması {baslangic:%Y-%m-%d %H:%M}\n- Site haritası: {toplam} profil\n"
                    f"- Bu çalıştırma: {ok} başarılı, {hata} hata\n- İstek sayısı: {len(ist.gunluk)}\n"
                    f"- Sekmeler: {', '.join(sekmeler)}\n- Çıktı: {prof_dosya}\n")
    print(f"Bitti: {ok} başarılı, {hata} hata. Çıktı: {prof_dosya}", flush=True)
    return 0 if hata == 0 else 1
