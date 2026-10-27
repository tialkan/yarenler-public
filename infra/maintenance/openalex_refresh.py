"""Exact-ID publication enrichment. No author-name joins and no embeddings.

Run under the host flock. Budget + successful-response cache survive restarts.
Only identifiers are sent; names, abstracts and authorships are not requested.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import time
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from yarenler_pipeline.sources.openalex.client import OpenAlexClient
from yarenler_pipeline.sources.openalex.budget import DailyBudget
from yarenler_pipeline.sources.openalex.models import Work, bare_doi, short_id

SELECT = 'id,doi,primary_topic,topics,updated_date'


def topic_path(topic):
    """Source taxonomy hierarchy, not an invented Turkish translation."""
    out = []
    for level, ref in enumerate((topic.domain, topic.field, topic.subfield)):
        if not ref or not ref.id or not ref.display_name:
            continue
        key = ref.id.removeprefix('https://openalex.org/')
        if not re.fullmatch(r'(domains|fields|subfields)/\d+', key):
            raise ValueError('Invalid OpenAlex taxonomy reference')
        out.append((key, ref.display_name, level))
    if not re.fullmatch(r'T\d+', topic.id) or not topic.display_name:
        raise ValueError('Invalid OpenAlex topic')
    out.append((topic.id, topic.display_name, 3))
    return out


def chosen_topics(work):
    topics = ([work.primary_topic] if work.primary_topic else []) + work.topics
    seen = set()
    return [t for t in topics if not (t.id in seen or seen.add(t.id))][:3]


def get_batch(client, kind, values, directory, ttl=7*86400):
    fingerprint = hashlib.sha256((kind+'|'+ '|'.join(values)).encode()).hexdigest()
    path = directory / (fingerprint+'.json.gz')
    if path.exists() and time.time()-path.stat().st_mtime < ttl:
        with gzip.open(path,'rt') as f:
            return json.load(f), True
    data = client.get('/works', {'filter':kind+':'+ '|'.join(values), 'select':SELECT, 'per_page':100})
    if not isinstance(data.get('results'),list):
        raise ValueError('OpenAlex results missing')
    # Validate before marking the batch cached; a malformed response is never a success checkpoint.
    records = [Work.from_api(item).model_dump(mode='json') for item in data['results']]
    temporary = path.with_suffix('.tmp')
    with gzip.open(temporary,'wt') as f:json.dump(records,f)
    temporary.replace(path)
    return records, False


def apply(c, records):
    areas, changed, matched, unknown = {}, 0, 0, 0
    for raw in records:
        work = Work.model_validate(raw)
        if not re.fullmatch(r'W\d+',work.id):raise ValueError('Invalid work identifier')
        # An OpenAlex redirect/merge can resolve a DOI, but never attach metadata by title or name.
        row = c.execute('SELECT id,openalex_id FROM publication WHERE openalex_id=%s OR (openalex_id IS NULL AND doi=%s) ORDER BY (openalex_id=%s) DESC LIMIT 1 FOR UPDATE', (work.id,work.doi,work.id)).fetchone()
        if not row:unknown+=1;continue
        matched+=1;topic_ids=[]
        for topic in chosen_topics(work):
            parent=None
            for key,name,level in topic_path(topic):
                if key not in areas:
                    found=c.execute("SELECT id FROM research_area WHERE sema='openalex' AND dis_kimlik=%s ORDER BY olusturma LIMIT 1",(key,)).fetchone()
                    if not found:
                        found=c.execute("INSERT INTO research_area(ad_en,ad_en_kaynak,normalize_ad,ust_id,sema,dis_kimlik,duzey,onayli) VALUES(%s,'kaynak',yarenler_katla(%s),%s,'openalex',%s,%s,true) ON CONFLICT(sema,dis_kimlik,normalize_ad) DO UPDATE SET dis_kimlik=excluded.dis_kimlik RETURNING id",(name,name,parent,key,level)).fetchone()
                    areas[key]=found['id']
                parent=areas[key]
            topic_ids.append(parent)
        topic_ids=sorted(set(topic_ids))
        # A response with no topics must not erase a previous usable classification.
        if topic_ids:
            changed+=c.execute('UPDATE publication SET konu_alanlari=%s::uuid[],guncelleme=now() WHERE id=%s AND konu_alanlari IS DISTINCT FROM %s::uuid[]',(topic_ids,row['id'],topic_ids)).rowcount
        if row['openalex_id'] is None:
            c.execute('UPDATE publication SET openalex_id=%s,guncelleme=now() WHERE id=%s',(work.id,row['id']))
    c.execute('SELECT yarenler_alan_slug_ata()')
    return {'matched':matched,'updated':changed,'unmatched':unknown,'taxonomy_nodes_seen':len(areas)}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--state',default='/state/openalex');parser.add_argument('--limit',type=int,default=0);args=parser.parse_args()
    directory=Path(args.state);directory.mkdir(parents=True,exist_ok=True)
    budget=DailyBudget.for_mode(has_key=bool(os.environ.get('OPENALEX_API_KEY')),run_limit=600,state_path=directory/'budget.json')
    # Stay within the anonymous free allowance even if a key is provided accidentally.
    budget.usd_limit=min(budget.usd_limit,0.08)
    with psycopg.connect(os.environ['DATABASE_URL'],row_factory=dict_row) as c:
        rows=c.execute('SELECT openalex_id,doi FROM publication WHERE openalex_id IS NOT NULL OR doi IS NOT NULL ORDER BY id').fetchall();c.commit()
        ids=sorted({short_id(r['openalex_id']) for r in rows if r['openalex_id'] and re.fullmatch(r'W\d+',short_id(r['openalex_id']))})
        dois=sorted({bare_doi(r['doi']) for r in rows if not r['openalex_id'] and r['doi']})
        groups=[('openalex_id',ids),('doi',dois)]
        records={};cached=0;batches=0
        with OpenAlexClient(os.environ.get('OPENALEX_API_KEY'),budget=budget) as client:
            for kind,values in groups:
                if args.limit:values=values[:args.limit]
                for offset in range(0,len(values),100):
                    response,hit=get_batch(client,kind,values[offset:offset+100],directory)
                    cached+=int(hit);batches+=1
                    for work in response:records[work['id']]=work
                    if not hit:time.sleep(.25)
                    if batches%25==0:print(json.dumps({'batches':batches,'records':len(records),'cached':cached}),flush=True)
        with c.transaction():
            c.execute("SELECT pg_advisory_xact_lock(hashtext('yarenler_import'))")
            result=apply(c,records.values());result.update({'requested_ids':len(ids),'requested_dois':len(dois),'records':len(records),'batches':batches,'cached_batches':cached,'budget':budget.summary(),'at':dt.datetime.now(dt.timezone.utc).isoformat()})
            c.execute("INSERT INTO veri_aktarimi(kaynak,bitis,kaynak_tarihi,ozet) VALUES('openalex',now(),now(),%s)",(Jsonb(result),))
        (directory/'last-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if __name__=='__main__':main()
