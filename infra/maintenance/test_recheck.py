import unittest
from recheck_orcid import apply_verified,fold_name

class Result:
 def __init__(self,value):self.value=value
 def fetchone(self):return self.value
class Connection:
 def __init__(self,answers):self.answers=iter(answers);self.queries=[]
 def execute(self,sql,params):
  self.queries.append((sql,params))
  return Result(next(self.answers,None))

class IdentityTests(unittest.TestCase):
 person={'id':'person','gorunen_ad':'Örnek Araştırmacı','avesis_url':'https://avesis.example.invalid/researcher'}
 details={'name':{'given-names':{'value':'Örnek'},'family-name':{'value':'Araştırmacı'}}}
 identifier='0000-0000-0000-0001'
 def test_normalization_and_different_official_identity(self):
  self.assertEqual(fold_name('ÖRNEK ARAŞTIRMACI'),fold_name('Örnek Araştırmacı'))
  c=Connection([])
  self.assertFalse(apply_verified(c,self.person,self.identifier,{'name':{'given-names':{'value':'Other'},'family-name':{'value':'Person'}}}))
  self.assertEqual(c.queries,[])
 def test_owner_existing_identifier_resolution_and_collision_are_never_overwritten(self):
  for answers in [[{'orcid':None,'sahiplenildi':True}],[{'orcid':self.identifier,'sahiplenildi':False}],[{'orcid':None,'sahiplenildi':False},{'exists':1}],[{'orcid':None,'sahiplenildi':False},None,{'exists':1}]]:
   c=Connection(answers);self.assertFalse(apply_verified(c,self.person,self.identifier,self.details));self.assertFalse(any(q.startswith(('INSERT','UPDATE')) for q,_ in c.queries))
 def test_valid_unique_exact_name_is_persisted_with_official_evidence(self):
  c=Connection([{'orcid':None,'sahiplenildi':False},None,None])
  self.assertTrue(apply_verified(c,self.person,self.identifier,self.details))
  writes=[(q,p) for q,p in c.queries if q.startswith(('INSERT','UPDATE'))]
  self.assertEqual(len(writes),2);self.assertIn('person_identifier_resolution',writes[0][0]);self.assertEqual(writes[1][1],(self.identifier,'person'))
if __name__=='__main__':unittest.main()
