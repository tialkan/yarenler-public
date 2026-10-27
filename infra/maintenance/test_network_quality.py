import importlib.util,sys,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('quality',Path(__file__).with_name('network_quality.py'));q=importlib.util.module_from_spec(spec)
with patch.dict(sys.modules,{'httpx':SimpleNamespace(),'psycopg':SimpleNamespace(),'psycopg.rows':SimpleNamespace(dict_row=None)}):spec.loader.exec_module(q)
class Quality(unittest.TestCase):
 def test_coverage_and_unit_comparison_do_not_treat_unknown_units_as_identical(self):
  nodes=[{'id':x} for x in 'abcd'];links=[{'source':'a','target':'b'},{'source':'b','target':'c'}]
  r=q.summarize(nodes,links,{'a':'u1','b':'u1','c':None,'d':None})
  self.assertEqual(r['coverage'],.75);self.assertEqual(r['isolated'],1);self.assertEqual(r['unit_comparable_edges'],1);self.assertEqual(r['same_unit_ratio'],1)
  self.assertTrue(r['not_a_recommendation_accuracy_measure'])
 def test_gini_is_bounded_and_equal_degrees_have_no_inequality(self):
  self.assertEqual(q.gini([1,1,1]),0);self.assertEqual(q.gini([0,0,0]),0);self.assertAlmostEqual(q.gini([0,0,4]),2/3)
 def test_no_accuracy_is_invented_before_both_experts_finish(self):
  packet={'questions':[{'candidates':[{'candidate':'Q1-C1','rater_a':{'relevance_0_to_3':None},'rater_b':{'relevance_0_to_3':None}}]}]};key=[{'candidate':'Q1-C1','methods':{'field_network':1}}]
  self.assertIsNone(q.score_packet(packet,key)['accuracy_metrics'])
  packet['questions'][0]['candidates'][0]['rater_a']['relevance_0_to_3']=3;packet['questions'][0]['candidates'][0]['rater_b']['relevance_0_to_3']=3
  r=q.score_packet(packet,key);self.assertEqual(r['questions_complete'],1);self.assertEqual(r['accuracy_metrics']['field_network']['precision_at_5'],.2);self.assertEqual(r['accuracy_metrics']['field_network']['ndcg_at_5'],1)
if __name__=='__main__':unittest.main()
