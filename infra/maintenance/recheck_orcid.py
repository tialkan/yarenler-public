"""Weekly missing-ORCID maintenance; no name-only identity assignment."""
import argparse,datetime as dt,json,os,re,tempfile,unicodedata
from pathlib import Path
import httpx,psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from yarenler_pipeline.sources.avesis.client import HamDepo,KibarIstemci,TaramaDurdu
from yarenler_pipeline.sources.avesis.policy import aybu_izin_katmani,kayitli_robots_md_den_oku
from yarenler_pipeline.sources.avesis.parse import ana
from yarenler_pipeline.sources.avesis.profil import orcid_bul
from yarenler_pipeline.sources.avesis.orcid_recheck import ana_sayfa_url,pazar_mi

def fold_name(value):
 value=value.translate(str.maketrans({'ı':'i','İ':'i'})).lower()
 return ' '.join(re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',value) if not unicodedata.combining(c))).split())

def apply_verified(c,person,identifier,details):
 name=details.get('name') or {}
 official=' '.join((name.get(key) or {}).get('value','') for key in ('given-names','family-name'))
 credit=(name.get('credit-name') or {}).get('value','')
 if fold_name(person['gorunen_ad']) not in {fold_name(official),fold_name(credit)}:return False
 # Recheck under the same transaction; never overwrite an explicit resolution or an owner.
 row=c.execute('SELECT orcid,sahiplenildi FROM person WHERE id=%s FOR UPDATE',(person['id'],)).fetchone()
 if not row or row['orcid'] or row['sahiplenildi']:return False
 if c.execute('SELECT 1 FROM person_identifier_resolution WHERE person_id=%s OR orcid=%s',(person['id'],identifier)).fetchone():return False
 if c.execute('SELECT 1 FROM person WHERE orcid=%s',(identifier,)).fetchone():return False
 c.execute('INSERT INTO person_identifier_resolution(person_id,orcid,source_url,evidence) VALUES(%s,%s,%s,%s)',(person['id'],identifier,f'https://pub.orcid.org/v3.0/{identifier}/personal-details',Jsonb({'official_name':official,'credit_name':credit,'avesis_url':person['avesis_url'],'method':'weekly-source-and-exact-normalized-official-name'})))
 c.execute('UPDATE person SET orcid=%s,guncelleme=now() WHERE id=%s AND orcid IS NULL AND NOT sahiplenildi',(identifier,person['id']))
 return True

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=0);parser.add_argument('--allow-nonsunday',action='store_true');parser.add_argument('--allow-daytime',action='store_true');args=parser.parse_args()
 if not args.allow_nonsunday and not pazar_mi(dt.datetime.now(dt.timezone(dt.timedelta(hours=3))).date()):raise SystemExit('Sunday-only job')
 summary={'checked':0,'found':0,'missing':0,'conflicts':0,'failed':0,'error_types':{},'at':dt.datetime.now(dt.timezone.utc).isoformat()}
 with psycopg.connect(os.environ['DATABASE_URL'],row_factory=dict_row) as c:
  people=c.execute('SELECT p.id,p.gorunen_ad,p.avesis_kullanici,p.avesis_url FROM person p WHERE p.aktif AND p.orcid IS NULL AND NOT p.sahiplenildi AND p.avesis_kullanici IS NOT NULL AND NOT EXISTS(SELECT 1 FROM person_identifier_resolution r WHERE r.person_id=p.id) ORDER BY p.id').fetchall()
  if args.limit:people=people[:args.limit]
  with tempfile.TemporaryDirectory() as raw:
   robots=kayitli_robots_md_den_oku('/app/avesis-aybu.md')
   client=KibarIstemci(izin=aybu_izin_katmani(robots),depo=HamDepo(raw),en_az_aralik_sn=3,gece_penceresi_zorunlu=not args.allow_daytime)
   try:
    client.robots_oku('avesis.aybu.edu.tr')
    for person in people:
     status='hata';summary['checked']+=1
     try:
      html=client.cek(ana_sayfa_url(person['avesis_kullanici']),kosullu=False).icerik
      if not html:raise ValueError('No source page')
      identifier,_=orcid_bul(ana.ayristir(html).ortak);status='yok'
      if identifier:
       with httpx.Client(timeout=20,follow_redirects=False) as official:
        response=official.get(f'https://pub.orcid.org/v3.0/{identifier}/personal-details',headers={'Accept':'application/json'});response.raise_for_status()
       with c.transaction():status='bulundu' if apply_verified(c,person,identifier,response.json()) else 'cakisma'
     except TaramaDurdu:
      summary['stopped']=True;raise
     except Exception as error:
      status='hata';kind=type(error).__name__;
      summary['error_types'][kind]=summary['error_types'].get(kind,0)+1
     with c.transaction():c.execute("INSERT INTO orcid_check(person_id,sonuc) VALUES(%s,%s) ON CONFLICT(person_id) DO UPDATE SET son_kontrol=now(),sonuc=excluded.sonuc,deneme_sayisi=orcid_check.deneme_sayisi+1",(person['id'],status))
     c.commit();summary[{'bulundu':'found','yok':'missing','cakisma':'conflicts','hata':'failed'}[status]]+=1
   finally:
    client.kapat();Path('/reports/last-orcid-check.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary),flush=True)
 if summary['failed']:raise SystemExit(1)
if __name__=='__main__':main()
