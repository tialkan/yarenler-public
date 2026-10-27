import pytest

from pathlib import Path

FIX = Path(__file__).parent / "fixtures"
from yarenler_pipeline.sources.avesis.policy import (
    KULLANICI_AJANI, IzinKatmani, PolitikaHatasi, RobotsDegisti, YaziliIzin, ajan_uygun_mu, aybu_izin_katmani,
)

ROBOTS = "User-agent: *\nAllow: /\n"
T = "https://avesis.aybu.edu.tr"


@pytest.fixture
def izin():
    k = aybu_izin_katmani(ROBOTS)
    k.robots_yukle("avesis.aybu.edu.tr", ROBOTS)
    return k


def test_kullanici_ajani():
    assert KULLANICI_AJANI == "YarenlerBot/0.1 (+https://yarenler.org/bot; iletisim@yarenler.org)"
    assert ajan_uygun_mu(KULLANICI_AJANI)
    assert not ajan_uygun_mu("python-httpx/0.28")
    with pytest.raises(PolitikaHatasi):
        IzinKatmani(ajan="libwww-perl/6")


@pytest.mark.parametrize("yol", ["/ornek", "/ornek/arastirma", "/ornek/yayinlar", "/ornek/deneyim",
                                 "/ornek/egitim", "/sitemap_index.xml", "/cvpages.xml"])
def test_profil_sekmeleri_acik(izin, yol):
    assert izin.denetle(T + yol).izin


@pytest.mark.parametrize("yol", ["/ornek/indir?languageCode=tr", "/journal/getjournaldetailbyarticleid?x=1",
                                 "/resume/lessoncontent?id=a", "/usermetrics/searchlistmodal?x=1",
                                 "/ornek/iletisim", "/ornek/dokumanlar", "/publication/showdocument/abc"])
def test_kapali_yollar(izin, yol):
    k = izin.denetle(T + yol)
    assert not k.izin, k


def test_izin_bayragi_tek_basina_yetmez(izin):
    assert not izin.denetle(T + "/ornek/indir?languageCode=tr", kapali_yol_bayragi=True).izin


def test_yazili_izin_ve_bayrak_indir_acar():
    k = aybu_izin_katmani(ROBOTS, YaziliIzin("docs/sources/izinler/x.pdf", "2026-11-01", ("/*/indir*",)))
    k.robots_yukle("avesis.aybu.edu.tr", ROBOTS)
    assert not k.denetle(T + "/ornek/indir?languageCode=tr").izin
    assert k.denetle(T + "/ornek/indir?languageCode=tr", kapali_yol_bayragi=True).izin
    assert not k.denetle(T + "/ornek/iletisim", kapali_yol_bayragi=True).izin  # sabit yasak hiç açılmaz


def test_baska_alan_ve_http(izin):
    assert not izin.denetle("https://avesis.hacettepe.edu.tr/x").izin
    assert not izin.denetle("http://avesis.aybu.edu.tr/ornek").izin


def test_robots_okunmadan_istek_yok():
    k = aybu_izin_katmani(ROBOTS)
    assert not k.denetle(T + "/ornek").izin


def test_robots_degisirse_durur():
    k = aybu_izin_katmani(ROBOTS)
    with pytest.raises(RobotsDegisti):
        k.robots_yukle("avesis.aybu.edu.tr", ROBOTS + "\nDisallow: /\n")
