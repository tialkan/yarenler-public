import httpx
import pytest
from yarenler_pipeline.sources.openalex import Author, Institution, Topic, Work, OpenAlexClient, PlanUpgradeRequired
from yarenler_pipeline.sources.openalex.models import bare_doi,short_id

WORK={'id':'https://openalex.org/W999000001','doi':'https://doi.org/10.0000/EXAMPLE','language':'tr','open_access':{'is_oa':True},'title':'Kurgusal çalışma','abstract_inverted_index':{'Örnek':[0],'çalışma':[1]},'primary_topic':{'id':'https://openalex.org/T999000001','field':{'display_name':'Örnek Alan'}},'authorships':[{'author':{'id':'https://openalex.org/A999000001','display_name':'Örnek Yazar'},'institutions':[{'id':'https://openalex.org/I999000001'}]}]}

def test_synthetic_work_and_affiliation():
    w=Work.from_api(WORK)
    assert w.id=='W999000001' and w.doi=='10.0000/example' and w.is_oa is True
    assert w.abstract=='Örnek çalışma' and w.primary_topic.field.display_name=='Örnek Alan'
    assert w.institution_author_ids('I999000001')==['A999000001']
    assert w.institution_author_ids('I999000002')==[]

def test_synthetic_author_institution_topic():
    a=Author.model_validate({'id':'https://openalex.org/A999000001','display_name':'Örnek Yazar','last_known_institutions':[{'id':'https://openalex.org/I999000001'}],'topics':[{'id':'https://openalex.org/T999000001','count':7}]})
    assert a.orcid_id is None and a.last_known_institutions[0].id=='I999000001' and a.topics[0].count==7
    i=Institution.model_validate({'id':'I999000001','display_name':'Örnek Üniversitesi','lineage':['https://openalex.org/I999000001']})
    assert i.lineage==['I999000001'] and i.ror is None
    assert Topic.model_validate({'id':'T999000001','domain':{'display_name':'Örnek Bilim'}}).domain.display_name=='Örnek Bilim'

@pytest.mark.parametrize(('value','expected'),[('https://doi.org/10.0000/ABC','10.0000/abc'),('doi:10.0000/X','10.0000/x'),('',None)])
def test_synthetic_doi_normalization(value,expected):assert bare_doi(value)==expected

def test_plan_failure_does_not_retry():
    attempts=[]
    def handler(req):
        attempts.append(req)
        return httpx.Response(429,json={'error':'Plan upgrade required','message':'Upgrade your plan to use this feature'})
    waits=[]
    client=OpenAlexClient(api_key='FAKEKEY0testonly9x8y7z6w5v4u',transport=httpx.MockTransport(handler),sleep=waits.append)
    with pytest.raises(PlanUpgradeRequired):list(client.iter_institution_works(from_updated_date='2026-01-01'))
    assert len(attempts)==1 and waits==[]

def test_keyfile_and_rtf_synthetic(tmp_path):
    from yarenler_pipeline.sources.openalex import extract_key,load_api_key,strip_rtf
    key='FAKEKEY0testonly9x8y7z6w5v4u'
    rtf=r'{\rtf1\ansi{\fonttbl{\f0 Helvetica;}}\f0 '+key+'}'
    assert 'Helvetica' not in strip_rtf(rtf) and extract_key(rtf)==key
    f=tmp_path/'key.rtf';f.write_text(rtf)
    assert load_api_key({'OPENALEX_API_KEY_FILE':str(f)})==key

def test_cursor_pagination_deduplicates_synthetic_works():
    calls=[]
    def handler(req):
        calls.append(req)
        cursor=req.url.params['cursor']
        if cursor=='*':return httpx.Response(200,json={'meta':{'count':2,'next_cursor':'c2'},'results':[WORK]})
        return httpx.Response(200,json={'meta':{'count':2,'next_cursor':None},'results':[WORK,{'id':'W999000002'}]})
    client=OpenAlexClient(api_key='FAKEKEY0testonly9x8y7z6w5v4u',transport=httpx.MockTransport(handler),sleep=lambda _:None)
    works=list(client.iter_institution_works('I999000001'))
    assert [w.id for w in works]==['W999000001','W999000002'] and len(calls)==2
    assert all('FAKEKEY0testonly9x8y7z6w5v4u' not in str(r.url) for r in calls)

def test_synthetic_single_and_institution_search():
    def handler(req):
        if req.url.path.startswith('/works/'):return httpx.Response(200,json=WORK)
        return httpx.Response(200,json={'meta':{'count':1},'results':[{'id':'I999000001','display_name':'Örnek Üniversitesi','ror':'https://ror.org/000000000'}]})
    client=OpenAlexClient(transport=httpx.MockTransport(handler),sleep=lambda _:None)
    assert client.get_work('W999000001').id=='W999000001'
    assert client.institution_by_ror('https://ror.org/000000000')[0].id=='I999000001'
