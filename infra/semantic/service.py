"""CPU-only multilingual indexing on yarenler-01. No external inference requests."""
import hashlib,json,os,threading,time
from contextlib import asynccontextmanager
import numpy as np
import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI,HTTPException
from pydantic import BaseModel,Field
MODEL='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
# Below this cosine a field is not offered as "close" to a typed field name (the AI decides sameness).
AREA_MIN_SIMILARITY=.5
state={'ready':False,'indexing':False,'profiles':0,'areas':0,'queued':0,'error':None}
lock=threading.Lock(); encoder=None; people=[]; matrix=np.empty((0,384),dtype=np.float32); areas=[]; area_matrix=np.empty((0,384),dtype=np.float32)
def db():return psycopg.connect(os.environ['DATABASE_URL'],row_factory=dict_row)
def unit(v):
 v=np.asarray(v,dtype=np.float32);return v/max(float(np.linalg.norm(v)),1e-9)
def get_encoder():
 global encoder
 if encoder is None:
  from fastembed import TextEmbedding
  encoder=TextEmbedding(model_name=MODEL,cache_dir='/models',threads=2)
 return encoder
def encode(texts):return np.asarray(list(get_encoder().embed(texts,batch_size=32)),dtype=np.float32)
def vector(v):return '['+','.join(str(float(x)) for x in v)+']'
def digest_of(texts):return hashlib.sha256(json.dumps(texts,ensure_ascii=False).encode()).hexdigest()
def load():
 global people,matrix,areas,area_matrix
 with db() as c:
  people=c.execute("SELECT p.kisa_kimlik id,p.gorunen_ad name,p.avesis_url source_url,u.ad_tr unit,s.embedding::text vec,s.evidence FROM person_semantic s JOIN person p ON p.id=s.person_id LEFT JOIN unit u ON u.id=p.unit_id WHERE p.aktif AND s.model=%s ORDER BY p.kisa_kimlik",(MODEL,)).fetchall()
  areas=c.execute("SELECT a.id::text id,s.embedding::text vec FROM research_area_semantic s JOIN research_area a ON a.id=s.area_id WHERE a.kanonik_id IS NULL AND s.model=%s ORDER BY a.id",(MODEL,)).fetchall()
  queued=c.execute('SELECT count(*) n FROM semantic_refresh_queue').fetchone()['n']
 matrix=np.asarray([json.loads(p.pop('vec')) for p in people],dtype=np.float32).reshape((-1,384))
 area_matrix=np.asarray([json.loads(a.pop('vec')) for a in areas],dtype=np.float32).reshape((-1,384))
 state.update(ready=True,profiles=len(people),areas=len(areas),queued=queued)

def index_person(c,person_id):
 """Profile vector from up to eight attributable titles and declared/owner-edited fields (never 'oneri')."""
 p=c.execute("SELECT p.id,COALESCE(array_agg(DISTINCT COALESCE(a.ad_tr,a.ad_en)) FILTER(WHERE a.id IS NOT NULL),'{}') fields FROM person p LEFT JOIN person_research_area pa ON pa.person_id=p.id AND pa.kaynak<>'oneri' LEFT JOIN research_area a ON a.id=pa.area_id WHERE p.id=%s AND p.aktif GROUP BY p.id",(person_id,)).fetchone()
 if not p:return False
 pubs=c.execute("SELECT pub.baslik AS title,pub.yil AS year,coalesce('https://doi.org/'||pub.doi,pub.avesis_url,'https://openalex.org/'||pub.openalex_id,'https://yarenler.org/tr') AS source_url FROM person_publication_effective pp JOIN publication pub ON pub.id=pp.publication_id WHERE pp.person_id=%s ORDER BY pub.yil DESC NULLS LAST,pp.sira,pub.id LIMIT 8",(p['id'],)).fetchall()
 # Only attributable publication titles and explicitly sourced/approved fields. No name/unit inference.
 # Same text and order as before 0012 (array_agg DISTINCT order), so unchanged profiles keep their digest.
 texts=[r['title'] for r in pubs]+(['; '.join(p['fields'])] if p['fields'] else [])
 if not texts:
  c.execute('DELETE FROM person_semantic WHERE person_id=%s',(p['id'],));return True
 digest=digest_of(texts)
 existing=c.execute('SELECT input_digest,model FROM person_semantic WHERE person_id=%s',(p['id'],)).fetchone()
 if existing and existing['input_digest']==digest and existing['model']==MODEL:return False
 vectors=encode(texts);embedding=unit(vectors.mean(axis=0));evidence={'titles':pubs,'fields':p['fields'],'vectors':[unit(v).tolist() for v in vectors]}
 c.execute('INSERT INTO person_semantic(person_id,embedding,model,input_digest,evidence) VALUES(%s,%s::vector,%s,%s,%s::jsonb) ON CONFLICT(person_id) DO UPDATE SET embedding=excluded.embedding,model=excluded.model,input_digest=excluded.input_digest,evidence=excluded.evidence,updated_at=now()',(p['id'],vector(embedding),MODEL,digest,json.dumps(evidence,default=str)))
 return True

def index_areas(c,ids=None):
 """Field vectors from the canonical name (and the English name when there is one). Unchanged names are skipped."""
 rows=c.execute("SELECT a.id,COALESCE(a.ad_tr,a.ad_en) ad,a.ad_en,s.input_digest,s.model FROM research_area a LEFT JOIN research_area_semantic s ON s.area_id=a.id WHERE a.kanonik_id IS NULL"+(" AND a.id=ANY(%s::uuid[])" if ids is not None else ''),((ids,) if ids is not None else ())).fetchall()
 todo=[]
 for r in rows:
  texts=[r['ad']]+([r['ad_en']] if r['ad_en'] and r['ad_en']!=r['ad'] else [])
  digest=digest_of(texts)
  if r['input_digest']!=digest or r['model']!=MODEL:todo.append((r['id'],texts,digest))
 for start in range(0,len(todo),64):
  batch=todo[start:start+64];flat=[t for _,texts,_ in batch for t in texts];vectors=encode(flat);i=0
  for area_id,texts,digest in batch:
   embedding=unit(vectors[i:i+len(texts)].mean(axis=0));i+=len(texts)
   c.execute('INSERT INTO research_area_semantic(area_id,embedding,model,input_digest) VALUES(%s,%s::vector,%s,%s) ON CONFLICT(area_id) DO UPDATE SET embedding=excluded.embedding,model=excluded.model,input_digest=excluded.input_digest,updated_at=now()',(area_id,vector(embedding),MODEL,digest))
  c.commit()
 return len(todo)

def drain_queue(c):
 """People and fields marked by the web app (migration 0012) are embedded now; done marks are removed."""
 rows=c.execute('SELECT sahip_turu,sahip_id FROM semantic_refresh_queue ORDER BY olusturma LIMIT 500 FOR UPDATE SKIP LOCKED').fetchall()
 area_ids=[r['sahip_id'] for r in rows if r['sahip_turu']=='area']
 if area_ids:index_areas(c,area_ids)
 for r in rows:
  if r['sahip_turu']=='person':index_person(c,r['sahip_id'])
  c.execute('DELETE FROM semantic_refresh_queue WHERE sahip_turu=%s AND sahip_id=%s',(r['sahip_turu'],r['sahip_id']))
 c.commit()
 return len(rows)

def rebuild():
 if not lock.acquire(blocking=False):return
 state.update(indexing=True,error=None)
 try:
  get_encoder()
  with db() as c:
   ids=[r['id'] for r in c.execute('SELECT id FROM person WHERE aktif ORDER BY id').fetchall()]
   for index,person_id in enumerate(ids):
    index_person(c,person_id)
    if index%50==0:c.commit();print('Indexed',index,'/',len(ids),flush=True)
   c.commit()
   print('Field vectors',index_areas(c),flush=True)
   print('Queue',drain_queue(c),flush=True)
  load();print('Index ready',state['profiles'],'profiles',state['areas'],'fields',flush=True)
 except Exception as e:state.update(error=type(e).__name__);print('Index failed',type(e).__name__,flush=True)
 finally:state['indexing']=False;lock.release()

def refresh():
 if not lock.acquire(blocking=False):return
 try:
  get_encoder()
  with db() as c:done=drain_queue(c)
  if done:load()
  print('Refresh',done,flush=True)
 except Exception as e:state.update(error=type(e).__name__);print('Refresh failed',type(e).__name__,flush=True)
 finally:lock.release()

@asynccontextmanager
async def lifespan(app):
 threading.Thread(target=rebuild,daemon=True).start();yield
app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
class Search(BaseModel):
 text:str=Field(min_length=3,max_length=5000)
 exclude_id:str|None=None
class AreaSearch(BaseModel):
 text:str=Field(min_length=2,max_length=120)
 limit:int=Field(default=10,ge=1,le=10)
@app.get('/health')
def health():return {**state,'model':MODEL,'dimensions':384,'runtime':'ONNX CPU on yarenler-01'}
def query_vector(text):
 chunks=[];current=''
 for word in text.split():
  if len(current)+len(word)>350 and current:chunks.append(current);current=''
  current+=((' ' if current else '')+word)
 if current:chunks.append(current)
 return unit(encode(chunks).mean(axis=0))
@app.post('/search')
def search(body:Search):
 if not state['ready']:raise HTTPException(503,'Index preparing')
 if not lock.acquire(timeout=15):raise HTTPException(503,'Index busy')
 try:q=query_vector(body.text)
 finally:lock.release()
 scores=matrix@q;result=[]
 for i in np.argsort(scores)[::-1]:
  p=people[int(i)]
  if p['id']==body.exclude_id or scores[i]<.3:continue
  e=p['evidence'];vectors=np.asarray(e['vectors']);best=int(np.argmax(vectors@q));titles=e['titles'];title=titles[best] if best<len(titles) else None
  result.append({'id':p['id'],'name':p['name'],'unit':p['unit'],'source_url':p['source_url'],'similarity':round(float(scores[i]),4),'evidence':title or {'title':'; '.join(e['fields']),'source_url':p['source_url']},'basis':'publication' if title else 'declared_fields'})
  if len(result)==8:break
 return {'candidates':result,'model':MODEL}
@app.post('/areas/similar')
def similar_areas(body:AreaSearch):
 """Canonical fields closest to a typed field name. Only ids and scores; names come from the database."""
 if not state['ready'] or not len(areas):raise HTTPException(503,'Index preparing')
 if not lock.acquire(timeout=5):raise HTTPException(503,'Index busy')
 try:q=query_vector(body.text)
 finally:lock.release()
 scores=area_matrix@q;result=[]
 for i in np.argsort(scores)[::-1][:body.limit]:
  if scores[i]<AREA_MIN_SIMILARITY:break
  result.append({'id':areas[int(i)]['id'],'similarity':round(float(scores[i]),4)})
 return {'candidates':result,'model':MODEL}
@app.post('/refresh',status_code=202)
def refresh_now():
 """Embeds queued fields and people in the background; the daily rebuild does the same."""
 threading.Thread(target=refresh,daemon=True).start();return {'accepted':True}
