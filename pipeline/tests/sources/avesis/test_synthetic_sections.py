import pytest
from yarenler_pipeline.sources.avesis.parse import ana,egitim,deneyim
from yarenler_pipeline.sources.avesis.profil import birlestir

HEADER='<main><h1 class="title">Prof. Dr. ÖRNEK ARAŞTIRMACI</h1>'
def section(title,body,badge='1'):
    return f'<div class="ac-item"><div class="item-head"><span>{title}</span><span class="badge">{badge}</span></div><div class="item-body">{body}</div></div>'
def entry(title,description):
    return f'<ul class="with-shaded-label"><li><h3 class="title"><span class="shaded-label">2020 - 2024</span>{title}</h3><div class="description"><p>{description}</p></div></li></ul>'

def test_synthetic_education_is_parsed():
    page=egitim.ayristir(HEADER+section('Eğitim Bilgileri',entry('Doktora','Örnek Üniversitesi, Bilim Fakültesi, Matematik, Türkiye'))+'</main>')
    assert len(page.egitim)==1 and page.egitim[0].derece=='Doktora'
    assert page.egitim[0].universite=='Örnek Üniversitesi' and page.egitim[0].tarih.baslangic_yil==2020
    assert page.rozet_uyumlu

def test_synthetic_education_badge_mismatch():
    page=egitim.ayristir(HEADER+section('Eğitim Bilgileri',entry('Doktora','Örnek Üniversitesi, Türkiye'),'2')+'</main>')
    assert not page.rozet_uyumlu and any(u.kod=='rozet_uyumsuz' for u in page.uyarilar)

@pytest.mark.parametrize('name',['Yabancı Diller','Sertifika, Kurs ve Eğitimler','Burslar'])
def test_private_education_sections_are_discarded(name):
    page=egitim.ayristir(HEADER+section(name,entry('GİZLİ','GİZLİ İÇERİK'))+'</main>')
    assert name in page.atilan_bolumler and 'GİZLİ İÇERİK' not in page.model_dump_json()

def test_synthetic_job_is_parsed():
    page=deneyim.ayristir(HEADER+section('Akademik Ünvanlar',entry('Araştırmacı','Örnek Üniversitesi, Bilim Fakültesi, Matematik'))+'</main>')
    assert len(page.akademik_unvanlar)==1 and page.akademik_unvanlar[0].universite=='Örnek Üniversitesi'

def test_unknown_section_is_not_silently_dropped():
    page=deneyim.ayristir(HEADER+section('Bilinmeyen Bölüm',entry('Örnek','Örnek'))+'</main>')
    assert any(u.kod=='bilinmeyen_bolum' for u in page.uyarilar) and len(page.diger)==1

def test_synthetic_sections_can_be_merged():
    edu=egitim.ayristir(HEADER+section('Eğitim Bilgileri',entry('Doktora','Örnek Üniversitesi, Türkiye'))+'</main>')
    exp=deneyim.ayristir(HEADER+section('Akademik Ünvanlar',entry('Araştırmacı','Örnek Üniversitesi, Bilim Fakültesi'))+'</main>')
    profile=birlestir('synthetic',{'ana':ana.ayristir(HEADER+'</main>'),'egitim':edu,'deneyim':exp})
    assert profile.avesis_kullanici=='synthetic' and profile.ad.gorunen=='Örnek Araştırmacı'
