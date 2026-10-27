from yarenler_pipeline.sources.avesis.parse.ana import ayristir
from yarenler_pipeline.sources.avesis.profil import birlestir

def test_fictitious_researcher():
    html = '<h1 class="title">Prof. Dr. ÖRNEK ARAŞTIRMACI</h1>'
    parsed = birlestir("example", {"ana": ayristir(html)})
    assert parsed.avesis_kullanici == "example"
    assert "@" not in parsed.model_dump_json()
