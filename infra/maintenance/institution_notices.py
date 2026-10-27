"""Retry private institutional notifications; fixed recipient, sending-only Resend key, no document logging."""
import json,os,urllib.request,urllib.error
from pathlib import Path
import psycopg

def main():
    key_file=os.environ.get('RESEND_API_KEY_FILE')
    key=Path(key_file).read_text().strip() if key_file else os.environ.get('RESEND_API_KEY','').strip()
    sender=os.environ.get('EMAIL_FROM','')
    if not key or not sender:
        print(json.dumps({'event':'institution_notices_not_configured'}));return
    sent=failed=0
    with psycopg.connect(os.environ['DATABASE_URL'],autocommit=True,connect_timeout=15) as c:
        for (identity,) in c.execute('SELECT * FROM yarenler_kurum_bildirim_bekleyen()').fetchall():
            item=c.execute('SELECT yarenler_kurum_bildirim_al(%s)',(identity,)).fetchone()[0]
            if not item:continue
            body={'from':sender,'to':['tialkan@aybu.edu.tr'],'subject':'Yarenler: yeni kurumsal katılım başvurusu','text':f"Yeni bir kurumsal katılım başvurusu alındı.\nBaşvuru: {identity}\n\nBelgeleri yalnız yönetici oturumunuzla özel panelden inceleyebilirsiniz:\nhttps://yarenler.org/yonetici/kurumlar\n\nBu e-posta belge eki veya başvuranın iletişim bilgilerini içermez."}
            mail=None
            try:
                req=urllib.request.Request('https://api.resend.com/emails',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','User-Agent':'Yarenler-Notifications/1.0 (+https://yarenler.org)','Idempotency-Key':'kurum-'+str(identity)},method='POST')
                with urllib.request.urlopen(req,timeout=15) as response:mail=json.load(response).get('id')
            except urllib.error.HTTPError as error:
                failed+=1;print(json.dumps({'event':'institution_notice_http_error','status':error.code}))
            except Exception:
                failed+=1;print(json.dumps({'event':'institution_notice_transport_error'}))
            c.execute('SELECT yarenler_kurum_bildirim_sonuc(%s,%s)',(identity,mail))
            if mail:sent+=1
        deleted=c.execute('SELECT yarenler_kurum_temizle()').fetchone()[0]
    print(json.dumps({'event':'institution_notices_done','sent':sent,'failed':failed,'expired_deleted':deleted}))
if __name__=='__main__':main()
