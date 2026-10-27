"""Kibar istemci (plan 4 "Tarayıcı kuralları", 14.4 A1 görev 2).

- Her istek önce IzinKatmani'ndan geçer; reddedilen adrese ağ isteği atılmaz, ret günlüğe yazılır.
- 3 saniyede en fazla 1 istek, 01.00-07.00 Europe/Istanbul gece penceresi (testte kapatılabilir).
- ETag / Last-Modified ile koşullu istek; 304 değişmedi demektir.
- Ham HTML iletişim bloğu silinmiş halde gzip ile saklanır, sha256 tutulur.
- YARENLER_TARAMA_DURDUR=1 tüm taramayı durdurur. Hata oranı yüzde 5'i geçerse tarama kendini durdurur.
- 403 ya da 429 görülürse tarama hemen durur (plan 3.1: engel görülürse dur ve rapor yaz).
"""

from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable
from urllib.parse import unquote, urljoin, urlsplit

import httpx

from .policy import IzinKatmani, KULLANICI_AJANI
from .temizlik import iletisim_temizle

try:
    from zoneinfo import ZoneInfo

    ISTANBUL: dt.tzinfo = ZoneInfo("Europe/Istanbul")
except Exception:  # tz veritabanı yoksa: Türkiye 2016'dan beri sabit UTC+3
    ISTANBUL = dt.timezone(dt.timedelta(hours=3), "Europe/Istanbul")

DURDURMA_DEGISKENI = "YARENLER_TARAMA_DURDUR"
GECE_BASLANGIC = dt.time(1, 0)
GECE_BITIS = dt.time(7, 0)


class TaramaDurdu(Exception):
    """Tarama güvenli biçimde durdu; sebep mesajdadır ve rapora yazılır."""


class IzinYok(Exception):
    """İzin katmanı adresi reddetti; ağ isteği atılmadı."""


@dataclass
class CekimSonucu:
    url: str
    durum: int
    degismedi: bool
    icerik: str | None
    sha256: str | None
    etag: str | None
    last_modified: str | None
    ham_dosya: Path | None


def gece_penceresinde(an: dt.datetime) -> bool:
    yerel = an.astimezone(ISTANBUL).time()
    return GECE_BASLANGIC <= yerel < GECE_BITIS


class HamDepo:
    """data/raw/avesis/<alan>/<yol>.html.gz + yanında .meta.json"""

    def __init__(self, kok: str | Path = "data/raw/avesis") -> None:
        self.kok = Path(kok)

    def yol(self, url: str) -> Path:
        p = urlsplit(url)
        parcalar = [unquote(x) for x in p.path.split("/") if x]
        for x in parcalar:
            if x in (".", ".."):
                raise ValueError(f"geçersiz yol parçası: {url}")
        ad = "/".join(parcalar) if parcalar else "_kok"
        if p.query:
            ad += "__" + hashlib.sha256(p.query.encode()).hexdigest()[:12]
        return self.kok / (p.hostname or "bilinmeyen") / f"{ad}.html.gz"

    def yaz(self, url: str, temiz_html: str, meta: dict) -> tuple[Path, str]:
        veri = temiz_html.encode("utf-8")
        ozet = hashlib.sha256(veri).hexdigest()
        hedef = self.yol(url)
        hedef.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(hedef, "wb") as f:
            f.write(veri)
        meta = {**meta, "url": url, "sha256": ozet}
        hedef.with_suffix("").with_suffix(".meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return hedef, ozet

    def oku_meta(self, url: str) -> dict | None:
        m = self.yol(url).with_suffix("").with_suffix(".meta.json")
        return json.loads(m.read_text(encoding="utf-8")) if m.exists() else None

    def oku(self, url: str) -> str | None:
        h = self.yol(url)
        if not h.exists():
            return None
        with gzip.open(h, "rb") as f:
            return f.read().decode("utf-8")


@dataclass
class KibarIstemci:
    izin: IzinKatmani
    depo: HamDepo
    transport: httpx.BaseTransport | None = None
    en_az_aralik_sn: float = 3.0
    gece_penceresi_zorunlu: bool = True
    hata_esigi: float = 0.05
    hata_orani_en_az_istek: int = 20
    zaman_asimi_sn: float = 30.0
    saat: Callable[[], dt.datetime] = field(default=lambda: dt.datetime.now(dt.timezone.utc))
    monoton: Callable[[], float] = field(default=time.monotonic)
    uyu: Callable[[float], None] = field(default=time.sleep)
    gunluk: list[dict] = field(default_factory=list)
    _son_istek: float | None = None
    _istek: int = 0
    _hata: int = 0
    _durdu: str | None = None

    def __post_init__(self) -> None:
        self._http = httpx.Client(
            transport=self.transport,
            headers={"User-Agent": KULLANICI_AJANI, "Accept-Encoding": "gzip"},
            follow_redirects=False,
            timeout=self.zaman_asimi_sn,
        )

    def kapat(self) -> None:
        self._http.close()

    # --- denetimler -------------------------------------------------------
    def _on_denetim(self) -> None:
        if self._durdu:
            raise TaramaDurdu(self._durdu)
        if os.environ.get(DURDURMA_DEGISKENI) == "1":
            self._durdur(f"{DURDURMA_DEGISKENI}=1 ile durduruldu")
        if self.gece_penceresi_zorunlu and not gece_penceresinde(self.saat()):
            raise TaramaDurdu("gece penceresi dışında (01.00-07.00 Europe/Istanbul)")

    def _durdur(self, sebep: str) -> None:
        self._durdu = sebep
        raise TaramaDurdu(sebep)

    def _hiz_bekle(self) -> None:
        if self._son_istek is not None:
            gecen = self.monoton() - self._son_istek
            if gecen < self.en_az_aralik_sn:
                self.uyu(self.en_az_aralik_sn - gecen)
        self._son_istek = self.monoton()

    def hata_orani(self) -> float:
        return self._hata / self._istek if self._istek else 0.0

    def _sonuc_kaydet(self, hata: bool) -> None:
        self._istek += 1
        self._hata += int(hata)
        if self._istek >= self.hata_orani_en_az_istek and self.hata_orani() > self.hata_esigi:
            self._durdur(f"hata oranı %{self.hata_orani() * 100:.1f}, eşik %{self.hata_esigi * 100:.0f}")

    # --- istek ------------------------------------------------------------
    def robots_oku(self, alan: str) -> str:
        """Canlı robots.txt'yi okur ve izin katmanına verir (kayıtlı kopyayla karşılaştırma orada)."""
        self._on_denetim()
        url = f"https://{alan}/robots.txt"
        self._hiz_bekle()
        try:
            r = self._http.get(url)
        except httpx.HTTPError as e:
            self._sonuc_kaydet(True)
            self._durdur(f"robots.txt okunamadı: {e.__class__.__name__}")
        self.gunluk.append({"url": url, "durum": r.status_code, "zaman": self.saat().isoformat()})
        if r.status_code != 200:
            self._sonuc_kaydet(True)
            self._durdur(f"robots.txt yanıtı {r.status_code}")
        self._sonuc_kaydet(False)
        self.izin.robots_yukle(alan, r.text)
        return r.text

    def cek(self, url: str, kapali_yol_bayragi: bool = False, kosullu: bool = True) -> CekimSonucu:
        for _ in range(4):  # en fazla 3 yönlendirme, her biri izin katmanından geçer
            self._on_denetim()
            karar = self.izin.denetle(url, kapali_yol_bayragi)
            if not karar.izin:
                self.gunluk.append({"url": url, "durum": None, "ret": karar.sebep, "zaman": self.saat().isoformat()})
                raise IzinYok(f"{url}: {karar.sebep}")
            basliklar = {}
            meta = self.depo.oku_meta(url) if kosullu else None
            if meta:
                if meta.get("etag"):
                    basliklar["If-None-Match"] = meta["etag"]
                if meta.get("last_modified"):
                    basliklar["If-Modified-Since"] = meta["last_modified"]
            self._hiz_bekle()
            try:
                r = self._http.get(url, headers=basliklar)
            except httpx.HTTPError as e:
                self.gunluk.append({"url": url, "durum": None, "hata": e.__class__.__name__,
                                    "zaman": self.saat().isoformat()})
                self._sonuc_kaydet(True)
                raise AgHatasi(url, e) from e
            self.gunluk.append({"url": url, "durum": r.status_code, "zaman": self.saat().isoformat()})
            if r.status_code in (301, 302, 303, 307, 308) and "location" in r.headers:
                self._sonuc_kaydet(False)
                url = urljoin(url, r.headers["location"])
                continue
            if r.status_code in (403, 429):
                self._sonuc_kaydet(True)
                self._durdur(f"{url}: sunucu {r.status_code} döndü, tarama durdu")
            if r.status_code == 304:
                self._sonuc_kaydet(False)
                return CekimSonucu(url, 304, True, None, meta.get("sha256") if meta else None,
                                   meta.get("etag") if meta else None,
                                   meta.get("last_modified") if meta else None,
                                   self.depo.yol(url))
            if r.status_code != 200:
                self._sonuc_kaydet(True)
                return CekimSonucu(url, r.status_code, False, None, None, None, None, None)
            self._sonuc_kaydet(False)
            temiz = iletisim_temizle(r.text)
            etag = r.headers.get("etag")
            lm = r.headers.get("last-modified")
            yol, ozet = self.depo.yaz(url, temiz, {
                "durum": 200, "etag": etag, "last_modified": lm,
                "cekilme": self.saat().isoformat(), "ajan": KULLANICI_AJANI,
            })
            return CekimSonucu(url, 200, False, temiz, ozet, etag, lm, yol)
        raise TaramaDurdu(f"{url}: çok fazla yönlendirme")


class AgHatasi(Exception):
    """Tek bir istekte ağ hatası; hata oranı sigortasına sayılır."""

    def __init__(self, url: str, e: Exception) -> None:
        super().__init__(f"{url}: {e.__class__.__name__}")
        self.url = url
