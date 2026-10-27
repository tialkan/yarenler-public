import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import pytest
import httpx
from openalex_refresh import topic_path,chosen_topics,get_batch
from yarenler_pipeline.sources.openalex.client import OpenAlexClient
from yarenler_pipeline.sources.openalex.models import Work,Topic

def test_taxonomy_keeps_source_hierarchy_and_english_name():
 t=Topic(id='https://openalex.org/T123',display_name='Graph Theory',domain={'id':'https://openalex.org/domains/3','display_name':'Physical Sciences'},field={'id':'https://openalex.org/fields/17','display_name':'Computer Science'},subfield={'id':'https://openalex.org/subfields/1702','display_name':'Artificial Intelligence'})
 assert topic_path(t)==[('domains/3','Physical Sciences',0),('fields/17','Computer Science',1),('subfields/1702','Artificial Intelligence',2),('T123','Graph Theory',3)]
 with pytest.raises(ValueError):topic_path(Topic(id='fake',display_name='X'))

def test_topics_primary_first_no_duplicates_at_most_three():
 t=lambda n:dict(id='https://openalex.org/T'+str(n),display_name=str(n))
 w=Work(id='W1',primary_topic=t(1),topics=[t(1),t(2),t(3),t(4)])
 assert [x.id for x in chosen_topics(w)]==['T1','T2','T3']

def test_success_checkpoint_only_and_cache(tmp_path):
 calls=[]
 def handle(request):
  calls.append(request);assert 'authorships' not in request.url.params['select'];assert 'title' not in request.url.params['select']
  return httpx.Response(200,json={'results':[{'id':'https://openalex.org/W1','topics':[]}]})
 with OpenAlexClient(transport=httpx.MockTransport(handle)) as c:
  first,hit=get_batch(c,'openalex_id',['W1'],tmp_path);assert not hit
  second,hit=get_batch(c,'openalex_id',['W1'],tmp_path);assert hit and first==second
 assert len(calls)==1
 with OpenAlexClient(transport=httpx.MockTransport(lambda _:httpx.Response(200,json={}))) as c:
  with pytest.raises(ValueError):get_batch(c,'openalex_id',['W2'],tmp_path)
 assert len(list(tmp_path.glob('*.gz')))==1

def test_source_refresh_preserves_previous_data_on_suspicious_loss(tmp_path):
 from profile_refresh import validate_record,commit,read_records
 import json
 row={'avesis_kullanici':'test','ad':{'gorunen':'Example'},'ikincil':{'yayinlar':[{'baslik':'Evidence'}]*10},'arastirma_alanlari':{'avesis':['Field']}}
 validate_record(row,row)
 with pytest.raises(ValueError):validate_record({**row,'ikincil':{'yayinlar':[]}},row)
 with pytest.raises(ValueError):validate_record({**row,'arastirma_alanlari':{}},row)
 (tmp_path/'published.jsonl').write_text(json.dumps(row)+'\n')
 new={**row,'ad':{'gorunen':'Changed'}}
 (tmp_path/'batch.jsonl').write_text(json.dumps(new)+'\n');(tmp_path/'batch-report.json').write_text(json.dumps({'at':'2026-10-24T12:00:00Z'}))
 assert read_records(tmp_path/'published.jsonl')['test']['ad']['gorunen']=='Example'
 commit(tmp_path)
 assert read_records(tmp_path/'published.jsonl')['test']['ad']['gorunen']=='Changed'
 assert json.loads((tmp_path/'checked.json').read_text())['test']=='2026-10-24T12:00:00Z'
