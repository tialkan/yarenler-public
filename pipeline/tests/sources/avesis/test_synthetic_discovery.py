import datetime as dt
import pytest
from yarenler_pipeline.sources.avesis.discover import KesifHatasi, artimli, harita_turu, profil_adresleri, site_haritasi_dizini

NS='http://www.sitemaps.org/schemas/sitemap/0.9'
BASE='https://avesis.example.invalid'
def xml(tag, entries):
    items=''.join(f'<{tag}><loc>{BASE}/{name}</loc>'+ (f'<lastmod>{date}</lastmod>' if date else '')+f'</{tag}>' for name,date in entries)
    root='urlset' if tag=='url' else 'sitemapindex'
    return f'<{root} xmlns="{NS}">{items}</{root}>'

def test_synthetic_index_classification():
    rows=site_haritasi_dizini(xml('sitemap',[('cvpages.xml',None),('publications.xml',None),('other.xml',None)]))
    assert [harita_turu(r.loc) for r in rows]==['profil','yayin','bilinmeyen']

def test_synthetic_incremental_changes():
    rows=profil_adresleri(xml('url',[('ornekbir','2026-01-01'),('ornekiki','2026-02-01'),('ornekyeni',None)]))
    assert [r.kullanici for r in rows]==['ornekbir','ornekiki','ornekyeni']
    assert rows[0].lastmod==dt.date(2026,1,1)
    result=artimli(rows,{rows[0].loc:'2026-01-01',rows[1].loc:'2026-01-01',BASE+'/eski':'2025-01-01'})
    assert result.ayni==[rows[0].loc] and result.degisen==[rows[1].loc] and result.yeni==[rows[2].loc] and result.kalkan==[BASE+'/eski']

@pytest.mark.parametrize('text',['<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x/>','<broken','<urlset/>'])
def test_invalid_or_unsafe_index_is_rejected(text):
    with pytest.raises(KesifHatasi):site_haritasi_dizini(text)

def test_nested_profile_url_is_rejected():
    with pytest.raises(KesifHatasi):profil_adresleri(xml('url',[('ornek/arastirma',None)]))
