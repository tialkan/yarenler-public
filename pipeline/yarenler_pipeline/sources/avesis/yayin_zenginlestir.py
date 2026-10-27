"""`yarenler avesis-yayinlar` komutu: profiller.jsonl yayınlarını ham depodan yeniden ayrıştırır (ağ yok).

Ayrıştırıcı 0.2.0 ile yayın özetine kaynak adı (dergi, etkinlik, kitap), AVESİS yayın kimliği ve adresi,
profile de kaynak tarihi (ham sayfanın okunduğu an) eklendi. Bu komut eski taramanın ham HTML'ini
(data/raw/avesis/...) yeniden okur, AVESİS'e hiç istek atmaz ve diğer alanlara dokunmaz.

Girdi:  data/avesis/<kurum>/profiller.jsonl
Çıktı:  data/avesis/<kurum>/profiller-yayinli.jsonl (varsayılan), data/reports/<tarih>-avesis-yayinlar.md
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from .client import HamDepo
from .models import AYRISTIRICI_SURUMU
from .parse.yayinlar import ayristir
from .profil import TABAN, yayin_ozetleri

# Kişinin okunmuş olabilecek sayfaları; kaynak tarihi bunların en yenisidir.
SAYFA_EKLERI = ("", "/arastirma", "/egitim", "/deneyim", "/yayinlar")


def kaynak_tarihi(depo: HamDepo, kullanici: str, taban: str = TABAN) -> str | None:
    """Ham depodaki meta kayıtlarından kişinin AVESİS sayfalarının en son okunma anı (ISO 8601)."""
    anlar = []
    for ek in SAYFA_EKLERI:
        meta = depo.oku_meta(f"{taban}/{kullanici}{ek}")
        if meta and meta.get("durum") == 200 and meta.get("cekilme"):
            try:
                anlar.append(dt.datetime.fromisoformat(meta["cekilme"]))
            except ValueError:
                continue
    return max(anlar).isoformat() if anlar else None


def yayinlari_oku(depo: HamDepo, kullanici: str, taban: str = TABAN):
    """Yayınlar sekmesi, yoksa yayınları ana sayfada listeleyen eski şablon. (özetler, kaynak sayfa) ya da None."""
    for url in (f"{taban}/{kullanici}/yayinlar", f"{taban}/{kullanici}"):
        html = depo.oku(url)
        if not html:
            continue
        sayfa = ayristir(html, kaynak_url=url)
        if sayfa.yayinlar:
            return yayin_ozetleri(sayfa, taban), url
    return None


def zenginlestir(satirlar: list[dict], depo: HamDepo, taban: str = TABAN) -> tuple[list[dict], dict]:
    sayac = {"kisi": 0, "yayinli_kisi": 0, "yayin": 0, "kaynak_adi": 0, "doi": 0, "openalex": 0, "avesis_url": 0,
             "tarihli_kisi": 0, "ham_yok_yayinli": 0, "sayi_farki": 0}
    farklar: list[str] = []
    cikti = []
    for r in satirlar:
        sayac["kisi"] += 1
        k = r["avesis_kullanici"]
        eski = (r.get("ikincil") or {}).get("yayinlar") or []
        okunan = yayinlari_oku(depo, k, taban)
        if okunan is not None:
            ozetler, _ = okunan
            yeni = [o.model_dump(mode="json") for o in ozetler]
            if len(yeni) != len(eski):
                sayac["sayi_farki"] += 1
                if len(farklar) < 20:
                    farklar.append(f"{k}: önceki {len(eski)}, ham sayfadan {len(yeni)}")
            r = {**r, "ikincil": {**(r.get("ikincil") or {}), "yayinlar": yeni}}
        elif eski:
            sayac["ham_yok_yayinli"] += 1  # ham sayfa yok: eski özet olduğu gibi kalır
        tarih = kaynak_tarihi(depo, k, taban)
        r = {**r, "kaynak_tarihi": tarih or r.get("kaynak_tarihi")}
        if okunan is not None:
            r["ayristirici_surumu"] = AYRISTIRICI_SURUMU
        if r.get("kaynak_tarihi"):
            sayac["tarihli_kisi"] += 1
        ys = r.get("ikincil", {}).get("yayinlar") or []
        if ys:
            sayac["yayinli_kisi"] += 1
        for y in ys:
            sayac["yayin"] += 1
            sayac["kaynak_adi"] += bool(y.get("kaynak_adi"))
            sayac["doi"] += bool(y.get("doi"))
            sayac["openalex"] += bool(y.get("openalex_id"))
            sayac["avesis_url"] += bool(y.get("avesis_url"))
        cikti.append(r)
    sayac["farklar"] = farklar
    return cikti, sayac


def _depo_kok() -> Path:
    here = Path.cwd()
    return here.parent if (here / "pyproject.toml").exists() else here


def calistir(args) -> int:
    kok = _depo_kok()
    klasor = kok / "data" / "avesis" / args.kurum
    girdi = Path(args.girdi) if args.girdi else klasor / "profiller.jsonl"
    hedef = Path(args.cikti) if args.cikti else klasor / "profiller-yayinli.jsonl"
    if hedef.resolve() == girdi.resolve():
        raise SystemExit("Çıktı girdinin üstüne yazılamaz; farklı bir --cikti verin.")
    depo = HamDepo(Path(args.ham) if args.ham else kok / "data" / "raw" / "avesis")
    satirlar = [json.loads(s) for s in girdi.read_text(encoding="utf-8").splitlines() if s.strip()]
    cikti, sayac = zenginlestir(satirlar, depo)
    if not args.kuru:
        hedef.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in cikti), encoding="utf-8")
    rapor = kok / "data" / "reports" / f"{dt.date.today().isoformat()}-avesis-yayinlar.md"
    rapor.parent.mkdir(parents=True, exist_ok=True)
    farklar = "".join(f"  - {f}\n" for f in sayac.pop("farklar"))
    with rapor.open("a", encoding="utf-8") as f:
        f.write(f"\n## AVESİS yayınları ham depodan ({dt.datetime.now():%Y-%m-%d %H:%M})\n"
                f"- Girdi: {girdi}\n- Çıktı: {'(kuru çalıştırma, yazılmadı)' if args.kuru else hedef}\n"
                + "".join(f"- {a}: {b}\n" for a, b in sayac.items())
                + (f"- Sayı farkı örnekleri:\n{farklar}" if farklar else ""))
    print(json.dumps(sayac, ensure_ascii=False))
    return 0
