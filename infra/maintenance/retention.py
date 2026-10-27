"""Daily retention via restricted functions: ordinary rejections 30 days, severe violations 180,
closed appeals/institution records per their policies and expired announcement interests. Open appeals are preserved.
"""
import json,os,sys
import psycopg

DAYS=180

def main():
    url=os.environ.get('DATABASE_URL')
    if not url:
        print(json.dumps({'event':'retention_not_configured'}));sys.exit(2)
    with psycopg.connect(url,connect_timeout=15,application_name='yarenler-retention') as c:
        appeals=c.execute('SELECT yarenler_itiraz_temizle()').fetchone()[0]
        interests=c.execute('SELECT yarenler_ilgi_temizle()').fetchone()[0]
        institutions=c.execute('SELECT yarenler_kurum_temizle()').fetchone()[0]
        deleted=c.execute('SELECT yarenler_ihlal_temizle(%s)',(DAYS,)).fetchone()[0]
    print(json.dumps({'event':'retention_done','severe_violation_days':DAYS,'ordinary_rejection_days':30,'deleted':deleted,'closed_appeals_deleted':appeals,'expired_institution_applications_deleted':institutions,'expired_announcement_interests_deleted':interests}))

if __name__=='__main__':main()
