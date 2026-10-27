"""Read-only network coverage report; optional blinded pilot packet. No paid APIs or model changes."""
import argparse,datetime as dt,json,math,os,random
from pathlib import Path
import httpx,psycopg
from psycopg.rows import dict_row

def gini(values):
    values=sorted(values);n=len(values);total=sum(values)
    return sum((2*i-n-1)*x for i,x in enumerate(values,1))/(n*total) if n and total else 0.0

def summarize(nodes,links,units):
    degree={n['id']:0 for n in nodes};valid=[]
    for edge in links:
        a,b=edge['source'],edge['target']
        if a==b or a not in degree or b not in degree:continue
        degree[a]+=1;degree[b]+=1;valid.append((a,b))
    known=[(a,b) for a,b in valid if units.get(a) and units.get(b)]
    same=sum(units[a]==units[b] for a,b in known)
    return {'researchers':len(nodes),'edges':len(valid),'connected':sum(x>0 for x in degree.values()),'isolated':sum(x==0 for x in degree.values()),'coverage':round(sum(x>0 for x in degree.values())/max(1,len(nodes)),4),'degree_gini':round(gini(degree.values()),4),'unit_comparable_edges':len(known),'same_unit_edges':same,'same_unit_ratio':round(same/len(known),4) if known else None,'cross_unit_edges':len(known)-same,'not_a_recommendation_accuracy_measure':True}

def packet(graph,records,client,semantic_url,output):
    rng=random.Random(20261025);byid={n['id']:n for n in graph['nodes']};ranked={n:[] for n in byid}
    for e in graph['links']:
        ranked[e['source']].append((e['target'],e['score']));ranked[e['target']].append((e['source'],e['score']))
    chosen=[]
    for group in [[r for r in records if r['publications']<=3],[r for r in records if r['publications']>=100],[r for r in records if r['fields']>=10],list(records)]:
        group=sorted(group,key=lambda r:r['id']);rng.shuffle(group)
        chosen.extend([r for r in group if r['id'] not in {x['id'] for x in chosen}][:5])
    questions=[];key=[]
    for i,row in enumerate(chosen,1):
        qid=f'Q{i:02}';center=byid[row['id']];pools={}
        for rank,(other,_) in enumerate(sorted(ranked[row['id']],key=lambda x:-x[1])[:5],1):pools.setdefault(other,{})['field_network']=rank
        if semantic_url and row['evidence']:
            try:
                result=client.post(semantic_url+'/search',json={'text':row['evidence'][:5000],'exclude_id':row['id']});result.raise_for_status()
                for rank,hit in enumerate(result.json().get('candidates',[])[:5],1):
                    if hit['id'] in byid:pools.setdefault(hit['id'],{})['publication_semantic']=rank
            except (httpx.HTTPError,ValueError):pass
        others=[n for n in byid if n!=row['id']];rng.shuffle(others)
        for rank,other in enumerate(others[:5],1):pools.setdefault(other,{})['random_baseline']=rank
        candidates=list(pools);rng.shuffle(candidates);entries=[]
        for j,other in enumerate(candidates,1):
            cid=f'{qid}-C{j:02}';n=byid[other]
            shared=sorted(set(center['fields']) & set(n['fields']))
            entries.append({'shared_field_evidence':shared,'candidate':cid,'name':n['name'],'profile':'https://yarenler.org'+n['url'],'fields':n['fields'],'interests':n.get('interests',[]),'rater_a':{'relevance_0_to_3':None,'shared_field_evidence_correct':None},'rater_b':{'relevance_0_to_3':None,'shared_field_evidence_correct':None}})
            key.append({'candidate':cid,'person':other,'methods':pools[other]})
        questions.append({'question':qid,'researcher':center['name'],'profile':'https://yarenler.org'+center['url'],'fields':center['fields'],'interests':center.get('interests',[]),'candidates':entries})
    (output/'pilot-blinded.json').write_text(json.dumps({'instructions':'Two independent domain reviewers; 0 unrelated, 1 weak, 2 plausible, 3 strong. Do not infer accuracy from empty ratings. Publication language and interdisciplinary strata require reviewer confirmation.','questions':questions},ensure_ascii=False,indent=2))
    (output/'pilot-method-key.json').write_text(json.dumps(key,ensure_ascii=False,indent=2))
    return {'questions':len(questions),'candidate_judgments_per_rater':len(key),'human_ratings_completed':0}

def score_packet(review,key):
    byid={x['candidate']:x for x in key};methods={};pairs=[];complete=0
    for question in review.get('questions',[]):
        entries=question['candidates'];grades={};valid=True
        for item in entries:
            values=[item.get(r,{}).get('relevance_0_to_3') for r in ['rater_a','rater_b']]
            if any(type(x) is not int or x<0 or x>3 for x in values):valid=False;break
            grades[item['candidate']]=sum(values)/2
        if not valid:continue
        complete+=1
        pairs.extend((item['rater_a']['relevance_0_to_3'],item['rater_b']['relevance_0_to_3']) for item in entries)
        ideal=sorted(grades.values(),reverse=True)[:5];idcg=sum((2**v-1)/math.log2(i+2) for i,v in enumerate(ideal));relevant=sum(v>=2 for v in grades.values())
        for method in {m for item in entries for m in byid[item['candidate']]['methods']}:
            ranked=sorted([item for item in entries if method in byid[item['candidate']]['methods']],key=lambda x:byid[x['candidate']]['methods'][method])[:5]
            values=[grades[item['candidate']] for item in ranked];hits=sum(v>=2 for v in values);dcg=sum((2**v-1)/math.log2(i+2) for i,v in enumerate(values))
            methods.setdefault(method,[]).append({'precision_at_5':hits/5,'ndcg_at_5':dcg/idcg if idcg else 0,'pooled_recall_at_5':hits/relevant if relevant else 0})
    if not complete:return {'status':'waiting_for_expert_reviews','questions_complete':0,'accuracy_metrics':None}
    n=len(pairs);obs=sum((a-b)**2/9 for a,b in pairs)/n
    ca=[sum(a==v for a,b in pairs)/n for v in range(4)];cb=[sum(b==v for a,b in pairs)/n for v in range(4)];expected=sum(ca[a]*cb[b]*(a-b)**2/9 for a in range(4) for b in range(4))
    return {'status':'reviewed','questions_complete':complete,'quadratic_weighted_kappa':1-obs/expected if expected else None,'accuracy_metrics':{method:{name:sum(x[name] for x in values)/len(values) for name in values[0]} for method,values in methods.items()},'recall_scope':'pooled judged candidates only; not corpus-wide recall'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--output',default='/reports/quality');p.add_argument('--evaluation',action='store_true');p.add_argument('--score',action='store_true');a=p.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    if a.score:
        result=score_packet(json.loads((out/'pilot-blinded.json').read_text()),json.loads((out/'pilot-method-key.json').read_text()));(out/'pilot-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result));return
    with httpx.Client(timeout=40,headers={'User-Agent':'Yarenler-Quality/1.0 (+https://yarenler.org)'}) as client:
        r=client.get(os.environ.get('NETWORK_URL','https://yarenler.org/api/network'));r.raise_for_status();graph=r.json()
        with psycopg.connect(os.environ['DATABASE_URL'],row_factory=dict_row) as db:
            rows=db.execute("""SELECT p.kisa_kimlik id,p.unit_id::text unit,(SELECT count(*) FROM person_publication_effective pp WHERE pp.person_id=p.id) publications,(SELECT count(*) FROM person_matching_area ma WHERE ma.person_id=p.id AND NOT ma.interest) fields,(SELECT string_agg(t.baslik,'; ') FROM (SELECT pub.baslik FROM person_publication_effective pp JOIN publication pub ON pub.id=pp.publication_id WHERE pp.person_id=p.id ORDER BY pub.yil DESC NULLS LAST,pp.sira,pub.id LIMIT 8)t) evidence FROM person p WHERE p.aktif""").fetchall()
            labels=db.execute("SELECT id::text,ad_tr FROM research_area WHERE kanonik_id IS NULL AND ad_tr IS NOT NULL ORDER BY ad_tr").fetchall()
        result=summarize(graph['nodes'],graph['links'],{r['id']:r['unit'] for r in rows});result['at']=dt.datetime.now(dt.timezone.utc).isoformat();result['human_accuracy_evaluated']=False
        semantic=os.environ.get('SEMANTIC_URL','')
        if semantic:
            try:result['semantic_health']=client.get(semantic+'/health').json()
            except (httpx.HTTPError,ValueError):result['semantic_health']={'available':False}
        pairs=[]
        for i,l in enumerate(labels):
            for r in labels[i+1:]:
                left,right=l['ad_tr'].casefold(),r['ad_tr'].casefold()
                if len(left)>7 and len(right)>7 and (left in right or right in left):pairs.append({'left':dict(l),'right':dict(r),'action':'review scope, not automatic merge'})
        result['catalog_scope_review_candidates']=len(pairs)
        (out/'catalog-scope-review.json').write_text(json.dumps(pairs,ensure_ascii=False,indent=2))
        if a.evaluation:result['pilot']=packet(graph,rows,client,semantic,out)
    (out/'latest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({'event':'network_quality','coverage':result['coverage'],'same_unit_ratio':result['same_unit_ratio'],'human_accuracy_evaluated':False}))
if __name__=='__main__':main()
