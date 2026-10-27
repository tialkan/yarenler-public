import pytest
from yarenler_pipeline.sources.avesis.parse.yayinlar import ayristir,kaynak_adi
from yarenler_pipeline.sources.avesis.profil import yayin_adresi

LEGACY='''<div class="identity-header-info"><h2>Prof. Dr. ÖRNEK ARAŞTIRMACI</h2></div>
<div class="pubs-wrapper"><div class="cv-item"><p class="period">2024</p>
<a href="/yayin/00000000-0000-4000-8000-000000000001/ornek"><h3><strong>Kurgusal yayın</strong></h3></a>
<h4><a class="authorsRichText">ÖRNEK A.</a></h4>
<h5><span><a class="journalDetailModalLink" href="/journal/x">Örnek Dergi</a>, cilt.3, sa.2, ss.1-5, 2024 (Scopus)</span>
<a href="https://openalex.org/works/W999000001"></a><a href="https://plu.mx/plum/a/?doi=10.9999%2Fexample"></a></h5></div></div>'''

def test_synthetic_legacy_publication():
    rows=ayristir(LEGACY).yayinlar
    assert len(rows)==1
    row=rows[0]
    assert row.baslik=='Kurgusal yayın' and row.yil==2024 and row.tur=='makale'
    assert row.dergi=='Örnek Dergi' and row.openalex_id=='W999000001' and row.doi=='10.9999/example'

def test_synthetic_duplicate_legacy_publication_removed():
    item=LEGACY[LEGACY.index('<div class="cv-item">'):LEGACY.rfind('</div></div>')+6]
    duplicated=LEGACY[:LEGACY.rfind('</div></div>')+6]+item+'</div>'
    assert len(ayristir(duplicated).yayinlar)==1

@pytest.mark.parametrize(('tur','journal','source','expected'),[
 ('makale','Örnek Dergi','cilt.3, 2024','Örnek Dergi'),
 ('makale','. Örnek Dergi','', 'Örnek Dergi'),
 ('bildiri',None,'Örnek Bilim Kongresi, Ankara, Türkiye, 01 Mart 2024, ss.1-2','Örnek Bilim Kongresi'),
 ('kitap',None,'Örnek Yayınevi, Ankara, 2024','Örnek Yayınevi'),
 ('diger',None,'Diğer, ss.1-2, 2024',None),
 ('kitap',None,'2024',None),
 ('diger',None,'',None),
])
def test_source_name_extraction(tur,journal,source,expected):assert kaynak_adi(tur,journal,source)==expected

@pytest.mark.parametrize('url',['https://example.invalid/yayin/1','/journal/x','/publication/showdocument/1',None])
def test_external_or_disallowed_publication_urls_rejected(url):assert yayin_adresi(url) is None

def test_synthetic_valid_publication_url():
    assert yayin_adresi('/yayin/00000000-0000-4000-8000-000000000001/ornek').endswith('/yayin/00000000-0000-4000-8000-000000000001/ornek')
