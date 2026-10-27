import datetime as dt
import gzip

import httpx
import pytest

from pathlib import Path

FIX = Path(__file__).parent / "fixtures"


def oku(profil, sekme):
    return (FIX / profil / f"{sekme}.html").read_text(encoding="utf-8")


from yarenler_pipeline.sources.avesis.client import (
    DURDURMA_DEGISKENI, HamDepo, IzinYok, KibarIstemci, TaramaDurdu, gece_penceresinde,
)
from yarenler_pipeline.sources.avesis.policy import KULLANICI_AJANI, aybu_izin_katmani

ROBOTS = "User-agent: *\nAllow: /\n"
T = "https://avesis.aybu.edu.tr"
GECE = dt.datetime(2026, 10, 22, 0, 30, tzinfo=dt.timezone.utc)  # 03.30 İstanbul


class Saat:
    def __init__(self):
        self.t = 0.0
        self.uyunan = []

    def monoton(self):
        return self.t

    def uyu(self, s):
        self.uyunan.append(s)
        self.t += s


def istemci(tmp_path, handler, **kw):
    saat = Saat()
    k = KibarIstemci(izin=aybu_izin_katmani(ROBOTS), depo=HamDepo(tmp_path), transport=httpx.MockTransport(handler),
                     saat=lambda: GECE, monoton=saat.monoton, uyu=saat.uyu, **kw)
    return k, saat


def site(istekler, durum=200, etag='"v1"'):
    html = '<main><h1>ÖRNEK ARAŞTIRMACI</h1><dl id="contactList"><dd>gizli@example.invalid</dd></dl></main>'

    def h(req: httpx.Request):
        istekler.append(req)
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text=ROBOTS)
        if req.headers.get("if-none-match") == etag:
            return httpx.Response(304)
        return httpx.Response(durum, text=html, headers={"etag": etag})
    return h


def test_ua_hiz_etag_gzip_iletisim(tmp_path):
    ist = []
    k, saat = istemci(tmp_path, site(ist))
    k.robots_oku("avesis.aybu.edu.tr")
    r1 = k.cek(T + "/ornek")
    assert r1.durum == 200 and "contactList" not in r1.icerik and "gizli@" not in r1.icerik
    assert all(i.headers["user-agent"] == KULLANICI_AJANI for i in ist)
    with gzip.open(r1.ham_dosya, "rb") as f:
        assert "ÖRNEK ARAŞTIRMACI" in f.read().decode("utf-8")
    r2 = k.cek(T + "/ornek")
    assert r2.degismedi and r2.durum == 304
    assert ist[-1].headers["if-none-match"] == '"v1"'
    assert saat.uyunan and all(abs(s - 3.0) < 1e-9 for s in saat.uyunan)


def test_izinsiz_adrese_istek_atilmaz(tmp_path):
    ist = []
    k, _ = istemci(tmp_path, site(ist))
    k.robots_oku("avesis.aybu.edu.tr")
    with pytest.raises(IzinYok):
        k.cek(T + "/ornek/iletisim")
    assert [i.url.path for i in ist] == ["/robots.txt"]


def test_gece_penceresi(tmp_path):
    assert gece_penceresinde(GECE)
    assert not gece_penceresinde(dt.datetime(2026, 10, 22, 9, 0, tzinfo=dt.timezone.utc))
    k = KibarIstemci(izin=aybu_izin_katmani(ROBOTS), depo=HamDepo(tmp_path),
                     transport=httpx.MockTransport(site([])),
                     saat=lambda: dt.datetime(2026, 10, 22, 9, 0, tzinfo=dt.timezone.utc))
    with pytest.raises(TaramaDurdu):
        k.robots_oku("avesis.aybu.edu.tr")
    k.gece_penceresi_zorunlu = False
    k.uyu = lambda s: None
    k.robots_oku("avesis.aybu.edu.tr")


def test_durdurma_degiskeni(tmp_path, monkeypatch):
    k, _ = istemci(tmp_path, site([]))
    monkeypatch.setenv(DURDURMA_DEGISKENI, "1")
    with pytest.raises(TaramaDurdu):
        k.robots_oku("avesis.aybu.edu.tr")


def test_hata_sigortasi(tmp_path):
    k, _ = istemci(tmp_path, site([], durum=500), hata_orani_en_az_istek=5)
    k.robots_oku("avesis.aybu.edu.tr")
    with pytest.raises(TaramaDurdu, match="hata oranı"):
        for _ in range(10):
            k.cek(T + "/ornek", kosullu=False)
    assert k.hata_orani() > 0.05


@pytest.mark.parametrize("durum", [403, 429])
def test_engel_gorulurse_durur(tmp_path, durum):
    k, _ = istemci(tmp_path, site([], durum=durum))
    k.robots_oku("avesis.aybu.edu.tr")
    with pytest.raises(TaramaDurdu):
        k.cek(T + "/ornek")
    with pytest.raises(TaramaDurdu):
        k.cek(T + "/ornek/egitim")


def test_ham_depo_yol_guvenligi(tmp_path):
    d = HamDepo(tmp_path)
    assert d.yol(T + "/ornek/egitim").name == "egitim.html.gz"
    with pytest.raises(ValueError):
        d.yol(T + "/a/%2e%2e/b")
