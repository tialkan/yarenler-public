import datetime as dt
import pytest
from yarenler_pipeline.sources.avesis.orcid_recheck import ana_sayfa_url,haftalik_orcid_kontrolu,pazar_mi
from yarenler_pipeline.sources.avesis.profil import orcid_dogrula

def synthetic_id():
    digits='999999999999999'
    total=0
    for c in digits:total=(total+int(c))*2
    check=(12-total%11)%11
    raw=digits+('X' if check==10 else str(check))
    return '-'.join(raw[i:i+4] for i in range(0,16,4))

def test_weekly_synthetic_orcid_and_errors():
    identifier=synthetic_id()
    html=f'<h1 class="title">ÖRNEK ARAŞTIRMACI</h1><a class="social-icon" title="Orcid" href="https://orcid.org/{identifier}">iD</a>'
    called=[]
    def fetch(url):
        called.append(url)
        if url.endswith('/broken'):raise ConnectionError('offline')
        if url.endswith('/missing'):return None
        return html if url.endswith('/example') else '<h1 class="title">ÖRNEK ARAŞTIRMACI</h1>'
    report=haftalik_orcid_kontrolu(['example','noid','broken','missing','example'],fetch,bugun=dt.date(2026,10,25),taban='https://avesis.example.invalid')
    assert orcid_dogrula(identifier) and report.bulunan=={'example':identifier}
    assert report.hala_eksik==['noid'] and set(report.hatali)=={'broken','missing'}
    assert report.kontrol_edilen==4 and len(called)==4 and all('/arastirma' not in u for u in called)

def test_weekly_schedule_is_enforced():
    assert pazar_mi(dt.date(2026,10,25)) and not pazar_mi(dt.date(2026,10,22))
    with pytest.raises(RuntimeError):haftalik_orcid_kontrolu(['example'],lambda _:None,bugun=dt.date(2026,10,22))

@pytest.mark.parametrize('value',['example/iletisim','../example','https://example.invalid','ornek?x=1',''])
def test_username_injection_is_rejected(value):
    with pytest.raises(ValueError):ana_sayfa_url(value)
