"""Nightly rolling AVESİS refresh. Stage first; checkpoint only after SQL import.

A bounded batch refreshes the full known population across seven nights. The
legacy initial-crawl checkpoint is never reused as a freshness checkpoint.
"""
import argparse,datetime as dt,json
from pathlib import Path
from yarenler_pipeline.sources.avesis.client import HamDepo,KibarIstemci,TaramaDurdu,gece_penceresinde
from yarenler_pipeline.sources.avesis.policy import aybu_izin_katmani,kayitli_robots_md_den_oku
from yarenler_pipeline.sources.avesis.discover import kesfet
from yarenler_pipeline.sources.avesis.calistir import ana_sayfa_yedekli,TABAN
from yarenler_pipeline.sources.avesis.parse import AYRISTIRICILAR
from yarenler_pipeline.sources.avesis.profil import birlestir
from yarenler_pipeline.sources.avesis.yayin_zenginlestir import kaynak_tarihi


def validate_record(record,old):
 if not record.get('ad',{}).get('gorunen'):raise ValueError('Missing source name')
 if not old:return
 previous=len((old.get('ikincil') or {}).get('yayinlar') or [])
 current=len((record.get('ikincil') or {}).get('yayinlar') or [])
 if previous and (current==0 or (previous>=10 and current<previous*.8)):
  raise ValueError('Publication loss requires review')
 count=lambda p:sum(len(v) for v in (p.get('arastirma_alanlari') or {}).values() if isinstance(v,list))
 if count(old)>0 and count(record)==0:raise ValueError('Field loss requires review')


def read_records(path):
 return {r['avesis_kullanici']:r for line in path.read_text().splitlines() if line.strip() for r in [json.loads(line)]} if path.exists() else {}


def commit(root):
 baseline=read_records(root/'published.jsonl');batch=read_records(root/'batch.jsonl')
 report=json.loads((root/'batch-report.json').read_text());checked=json.loads((root/'checked.json').read_text()) if (root/'checked.json').exists() else {}
 baseline.update(batch)
 for key in batch:checked[key]=report['at']
 for name,value in [('published.jsonl',''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in baseline.values())),('checked.json',json.dumps(checked))]:
  target=root/name;temp=target.with_suffix('.tmp');temp.write_text(value);temp.replace(target)


def main():
 p=argparse.ArgumentParser();p.add_argument('--state',default='/state/profiles');p.add_argument('--limit',type=int,default=250);p.add_argument('--commit',action='store_true');p.add_argument('--offline-check',action='store_true');p.add_argument('--allow-daytime',action='store_true');args=p.parse_args()
 root=Path(args.state);root.mkdir(parents=True,exist_ok=True)
 if args.commit:commit(root);return
 baseline=read_records(root/'published.jsonl')
 if not baseline:raise SystemExit('Seed publication-enriched baseline before refresh')
 if args.offline_check:
  for row in baseline.values():validate_record(row,row)
  print(json.dumps({'offline_baseline_valid':len(baseline)}));return
 if not args.allow_daytime and not gece_penceresinde(dt.datetime.now(dt.timezone.utc)):raise SystemExit('Night window only; no HTTP requests sent')
 checked=json.loads((root/'checked.json').read_text()) if (root/'checked.json').exists() else {}
 report={'at':dt.datetime.now(dt.timezone.utc).isoformat(),'checked':0,'staged':0,'failed':0,'errors':{},'stopped':False}
 client=KibarIstemci(izin=aybu_izin_katmani(kayitli_robots_md_den_oku('/app/avesis-aybu.md')),depo=HamDepo(root/'raw'),en_az_aralik_sn=3,gece_penceresi_zorunlu=not args.allow_daytime)
 temporary=root/'batch.tmp';output=root/'batch.jsonl';output.unlink(missing_ok=True)
 try:
  client.robots_oku('avesis.aybu.edu.tr')
  discovered=kesfet(client,TABAN+'/sitemap_index.xml')
  keys=set(baseline)|{r.loc.rstrip('/').rsplit('/',1)[-1] for r in discovered['profil']}
  keys=sorted(keys,key=lambda key:(checked.get(key,''),key))[:args.limit]
  with temporary.open('w') as f:
   for key in keys:
    report['checked']+=1
    try:
     pages={'ana':ana_sayfa_yedekli(client,key)}
     menu=json.dumps(pages['ana'].ortak.model_dump(mode='json').get('menu',[]))
     for section in ['arastirma','yayinlar']:
      if f'/{key}/{section}' not in menu:continue
      url=f'{TABAN}/{key}/{section}';response=client.cek(url);html=response.icerik if response.icerik is not None else client.depo.oku(url)
      if not html:raise ValueError('Missing source page')
      pages[section]=AYRISTIRICILAR[section](html,kaynak_url=url)
     if 'yayinlar' not in pages:
      legacy=client.depo.oku(f'{TABAN}/{key}')
      if legacy:
       parsed=AYRISTIRICILAR['yayinlar'](legacy,kaynak_url=f'{TABAN}/{key}')
       if parsed.yayinlar:pages['yayinlar']=parsed
     row=birlestir(key,pages).model_copy(update={'kaynak_tarihi':kaynak_tarihi(client.depo,key)}).model_dump(mode='json')
     validate_record(row,baseline.get(key));f.write(json.dumps(row,ensure_ascii=False)+'\n');f.flush();report['staged']+=1
    except TaramaDurdu:raise
    except Exception as error:
     report['failed']+=1;name=type(error).__name__+':'+str(error)[:100];report['errors'][name]=report['errors'].get(name,0)+1
     if report['failed']>=5:raise TaramaDurdu('Five profile failures; batch held for review')
  if report['failed']/max(1,report['checked'])>.05:raise TaramaDurdu('Profile error threshold exceeded')
  if report['staged']==0:raise TaramaDurdu('No valid source records')
  temporary.replace(output)
 except TaramaDurdu:
  report['stopped']=True;raise
 finally:
  client.kapat();(root/'batch-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
if __name__=='__main__':main()
