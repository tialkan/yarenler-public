import json
import pytest
from yarenler_pipeline.sources.avesis.parse import ana,arastirma,yayinlar
from yarenler_pipeline.sources.avesis.profil import birlestir,orcid_dogrula
from yarenler_pipeline.sources.avesis.metin import baslik_duzeni,virgullu_liste

BASE='<main><h1 class="title">Prof. Dr. ÖRNEK ARAŞTIRMACI</h1>{body}</main>'

def test_profile_excludes_contact_details():
    html=BASE.format(body='<dl id="contactList"><dd>private@example.invalid</dd></dl><p><strong>AVESIS Araştırma Alanları:</strong> Matematik, Bilişim</p>')
    result=birlestir('ornek',{'ana':ana.ayristir(html)})
    assert result.avesis_kullanici=='ornek'
    assert 'private@example.invalid' not in result.model_dump_json()
    assert result.arastirma_alanlari.avesis==['Matematik','Bilişim']

def test_research_tab_separates_schemas():
    result=arastirma.ayristir(BASE.format(body='<p><strong>WoS Araştırma Alanları:</strong> İstatistik, Matematik</p><p><strong>Scopus Araştırma Alanları:</strong> Bilişim</p>'))
    assert result.arastirma_alanlari.wos==['İstatistik','Matematik']
    assert result.arastirma_alanlari.scopus==['Bilişim']

def test_publications_empty_is_reported():
    assert not yayinlar.ayristir(BASE.format(body='')).yayinlar

@pytest.mark.parametrize(('text','expected'),[('Matematik Ve İstatistik','Matematik ve İstatistik'),('Veri İle İlgili Yöntemler','Veri ile ilgili Yöntemler'),('Ve Başlangıç','Ve Başlangıç')])
def test_turkish_field_case(text,expected):
    assert baslik_duzeni(text)==expected

def test_field_list_discards_empty_items():
    assert virgullu_liste('  Bir, , İki , Üç ') == ['Bir','İki','Üç']

@pytest.mark.parametrize('value',['','1234','0000-0000-0000-0000','9999-9999-9999-9999',None])
def test_invalid_orcid_is_rejected(value):
    assert not orcid_dogrula(value)
