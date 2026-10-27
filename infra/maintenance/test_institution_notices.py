"""Notification privacy boundary: no document/contact payload, stable retries and fixed destination."""
import importlib.util,json,os,unittest,urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('institution_notices_under_test',Path(__file__).with_name('institution_notices.py'))
worker=importlib.util.module_from_spec(spec)
with patch.dict('sys.modules',{'psycopg':SimpleNamespace()}):spec.loader.exec_module(worker)

class DB:
    def __init__(self):self.results=[]
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def execute(self,sql,args=None):
        if 'bekleyen' in sql:return SimpleNamespace(fetchall=lambda:[('test-application-id',)])
        if 'bildirim_al(' in sql:
            # Even an older server returning private fields must not put them in the email.
            return SimpleNamespace(fetchone=lambda:[{'id':'test-application-id','kurum':'PRIVATE-INSTITUTION','eposta':'PRIVATE-CONTACT','url':'PRIVATE-URL','pdf':'PRIVATE-PDF'}])
        if 'bildirim_sonuc' in sql:self.results.append(args);return None
        return SimpleNamespace(fetchone=lambda:[0])

class Response:
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self):return b'{"id":"provider-test-id"}'

class Notifications(unittest.TestCase):
    def run_worker(self,request):
        db=DB()
        with patch.dict(os.environ,{'DATABASE_URL':'test-only','RESEND_API_KEY':'test-only','RESEND_API_KEY_FILE':'','EMAIL_FROM':'Yarenler <bildirim@yarenler.org>'}),patch.object(worker,'psycopg',SimpleNamespace(connect=lambda *a,**kw:db)),patch.object(worker.urllib.request,'urlopen',request):worker.main()
        return db
    def test_only_fixed_panel_link_and_reference_leave_the_worker(self):
        def send(req,**kw):
            body=json.loads(req.data)
            self.assertEqual(set(body),{'from','to','subject','text'})
            self.assertEqual(body['to'],['contact@example.invalid'])
            self.assertIn('https://yarenler.org/yonetici/kurumlar',body['text'])
            self.assertIn('test-application-id',body['text'])
            self.assertNotIn('PRIVATE-',req.data.decode())
            self.assertEqual(req.get_header('Idempotency-key'),'kurum-test-application-id')
            return Response()
        self.assertEqual(self.run_worker(send).results,[('test-application-id','provider-test-id')])
    def test_rejected_delivery_remains_pending_and_retry_has_identical_payload(self):
        requests=[]
        def fail(req,**kw):
            requests.append((req.data,req.get_header('Idempotency-key')))
            raise urllib.error.HTTPError(req.full_url,503,'temporary',{},None)
        for _ in range(2):self.assertEqual(self.run_worker(fail).results,[('test-application-id',None)])
        self.assertEqual(requests[0],requests[1])

if __name__=='__main__':unittest.main()
