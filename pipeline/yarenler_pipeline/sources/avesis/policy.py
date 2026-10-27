"""İzin katmanı (plan 4 "Tarayıcı kuralları", 14.4 A1 görev 1).

Bir adrese istek atılabilmesi için hepsi gerekir:
1. Alan adının izin kaydı vardır (AYBÜ dışı ya da kayıtsız alan adı reddedilir).
2. Adres sabit "hiç istenmez" listesinde değildir (iletişim, dokümanlar, fotoğraf, özgeçmiş görselleştirmeleri).
3. Adres sabit robots kapalı listesinde değildir; değilse yalnız yazılı izin kaydı o kalıbı kapsıyorsa ve
   ayrıca açık bayrak verildiyse geçer.
4. Canlı robots.txt kayıtlı kopyayla aynıdır (farklıysa tarama durur) ve canlı robots.txt YarenlerBot'a izin verir.
5. Kullanıcı ajanı sabittir ve robots.txt'de tamamen kapalı ajanlardan (libwww dahil) hiçbirini içermez.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from protego import Protego

KULLANICI_AJANI = "YarenlerBot/0.1 (+https://yarenler.org/bot; iletisim@yarenler.org)"
AJAN_KISA_ADI = "YarenlerBot"

# docs/sources/avesis-aybu.md, "Tamamen kapalı tarayıcılar" (22 Ekim 2026)
YASAKLI_AJANLAR: tuple[str, ...] = (
    "SemrushBot", "AhrefsBot", "MJ12bot", "Baiduspider", "Sogou", "HTTrack", "Teleport", "TeleportPro",
    "WebCopier", "WebZIP", "WebReaper", "WebStripper", "Offline Explorer", "SiteSnagger", "Zealbot",
    "MSIECrawler", "Microsoft.URL.Control", "Xenu", "larbin", "libwww", "UbiCrawler", "DOC", "Zao",
    "grub-client", "k2spider", "NPBot", "ZyBORG", "Download Ninja", "fast", "linko",
    # Python istemcilerinin varsayılan ajanları da kullanılmaz
    "python-httpx", "python-requests", "python-urllib",
)

# docs/sources/avesis-aybu.md, "Kapalı yollar (User-agent: *)". Yalnız yazılı izin + açık bayrakla açılabilir.
ROBOTS_KAPALI_YOLLAR: tuple[str, ...] = (
    "/*/indir*",
    "/*/download*",
    "/journal/*",
    "/resume/publicationhierarchicaledgebundlingmodal/*",
    "/resume/publicationhierarchicaledgebundling",
    "/resume/publicationcollapsibletree",
    "/resume/publicationworldmap",
    "/resume/publicationcoauthor",
    "/resume/publicationresearcharea",
    "/resume/publicationgalaxy",
    "/activitycitation/index/*",
    "/nr/*",
    "/usermetrics/",
)

# Veri en az ilkesi ve avesis-yapi.md "Kapalı ya da kullanılmayan": hiçbir izinle istenmez.
HIC_ISTENMEZ: tuple[str, ...] = (
    "/*/iletisim",
    "/iletisim",
    "/*/dokumanlar",
    "/dokumanlar",
    "/user/image/",
    "/resume/",
    "/journal/",
    "/usermetrics/",
    "/publication/showdocument/",
)


class PolitikaHatasi(Exception):
    """İzin katmanı genel hatası."""


class RobotsDegisti(PolitikaHatasi):
    """Canlı robots.txt kayıtlı kopyadan farklı: tarama durur, rapor yazılır."""


@dataclass(frozen=True)
class YaziliIzin:
    """Kurumdan alınmış yazılı izin kaydı. Belge yolu docs/sources/izinler/ altındadır."""

    belge: str
    tarih: str
    kapsam: tuple[str, ...] = ()  # açılan robots kalıpları, ör. ("/*/indir*",)


@dataclass
class AlanIzni:
    alan: str
    kurum: str
    sozlu_izin: bool = False
    yazili_izin: YaziliIzin | None = None
    kayitli_robots: str | None = None


@dataclass(frozen=True)
class Karar:
    izin: bool
    sebep: str
    url: str


def _kalip_regex(kalip: str) -> re.Pattern[str]:
    """robots.txt kalıbı: '*' herhangi dizi, sonda '$' tam eşleşme, aksi halde önek eşleşmesi."""
    son = kalip.endswith("$")
    govde = kalip[:-1] if son else kalip
    rx = "^" + ".*".join(re.escape(p) for p in govde.split("*"))
    return re.compile(rx + ("$" if son else ""))


def kalip_eslesir(kalip: str, yol: str) -> bool:
    return bool(_kalip_regex(kalip).match(yol))


def robots_normalize(metin: str) -> list[str]:
    """Karşılaştırma için: yorumlar ve boş satırlar atılır, yönerge adı küçük harfe çevrilir."""
    out = []
    for satir in metin.splitlines():
        satir = satir.split("#", 1)[0].strip()
        if not satir or ":" not in satir:
            continue
        ad, deger = satir.split(":", 1)
        out.append(f"{ad.strip().lower()}:{deger.strip()}")
    return out


def kayitli_robots_md_den_oku(md_yolu: str | Path) -> str:
    """docs/sources/avesis-aybu.md içindeki "Tam metin" kod bloğunu döndürür."""
    metin = Path(md_yolu).read_text(encoding="utf-8")
    m = re.search(r"## Tam metin[^\n]*\n+```\n(.*?)\n```", metin, re.S)
    if not m:
        raise PolitikaHatasi(f"robots.txt tam metni bulunamadı: {md_yolu}")
    return m.group(1) + "\n"


def ajan_uygun_mu(ajan: str) -> bool:
    k = ajan.lower()
    if not k.startswith(AJAN_KISA_ADI.lower() + "/"):
        return False
    govde = k.split("(", 1)[0]
    return not any(y.lower() in govde for y in YASAKLI_AJANLAR)


@dataclass
class IzinKatmani:
    alanlar: dict[str, AlanIzni] = field(default_factory=dict)
    ajan: str = KULLANICI_AJANI
    _canli: dict[str, Protego] = field(default_factory=dict, repr=False)
    gunluk: list[Karar] = field(default_factory=list, repr=False)

    def __post_init__(self) -> None:
        if not ajan_uygun_mu(self.ajan):
            raise PolitikaHatasi(f"kullanıcı ajanı uygun değil: {self.ajan!r}")

    def alan_ekle(self, izin: AlanIzni) -> None:
        self.alanlar[izin.alan.lower()] = izin

    def robots_yukle(self, alan: str, canli_metin: str) -> None:
        """Her çalıştırmada canlı robots.txt ile çağrılır. Kayıtlı kopyadan farklıysa RobotsDegisti."""
        izin = self.alanlar.get(alan.lower())
        if izin is None:
            raise PolitikaHatasi(f"izin kaydı olmayan alan adı: {alan}")
        if izin.kayitli_robots is None:
            raise PolitikaHatasi(f"{alan} için kayıtlı robots.txt kopyası yok")
        if robots_normalize(canli_metin) != robots_normalize(izin.kayitli_robots):
            raise RobotsDegisti(f"{alan}: canlı robots.txt kayıtlı kopyadan farklı, tarama durdu")
        self._canli[alan.lower()] = Protego.parse(canli_metin)

    def denetle(self, url: str, kapali_yol_bayragi: bool = False) -> Karar:
        k = self._denetle(url, kapali_yol_bayragi)
        self.gunluk.append(k)
        return k

    def _denetle(self, url: str, kapali_yol_bayragi: bool) -> Karar:
        p = urlsplit(url)
        if p.scheme != "https":
            return Karar(False, "yalnız https", url)
        alan = (p.hostname or "").lower()
        izin = self.alanlar.get(alan)
        if izin is None:
            return Karar(False, f"izin kaydı olmayan alan adı: {alan}", url)
        if not (izin.sozlu_izin or izin.yazili_izin):
            return Karar(False, f"{alan} için kurum izni kaydı yok", url)
        yol = p.path or "/"
        yol_sorgu = yol + (f"?{p.query}" if p.query else "")
        for kalip in HIC_ISTENMEZ:
            if kalip_eslesir(kalip, yol):
                return Karar(False, f"sabit yasak listesi: {kalip}", url)
        for kalip in ROBOTS_KAPALI_YOLLAR:
            if kalip_eslesir(kalip, yol_sorgu):
                yi = izin.yazili_izin
                if not (kapali_yol_bayragi and yi and kalip in yi.kapsam):
                    return Karar(False, f"robots.txt kapalı yol: {kalip}", url)
                return Karar(True, f"yazılı izinle açılan kapalı yol: {kalip} ({yi.belge})", url)
        rp = self._canli.get(alan)
        if rp is None:
            return Karar(False, f"{alan} için bu çalıştırmada canlı robots.txt okunmadı", url)
        if not rp.can_fetch(url, self.ajan):
            return Karar(False, "canlı robots.txt izin vermiyor", url)
        return Karar(True, "robots.txt ve kurum izni uygun", url)


def aybu_izin_katmani(kayitli_robots: str, yazili_izin: YaziliIzin | None = None) -> IzinKatmani:
    """AYBÜ AVESİS için hazır yapılandırma: Rektörün sözlü izni (22 Ekim 2026), yazılı teyit bekleniyor."""
    k = IzinKatmani()
    k.alan_ekle(AlanIzni(
        alan="avesis.aybu.edu.tr",
        kurum="Ankara Yıldırım Beyazıt Üniversitesi",
        sozlu_izin=True,
        yazili_izin=yazili_izin,
        kayitli_robots=kayitli_robots,
    ))
    return k
