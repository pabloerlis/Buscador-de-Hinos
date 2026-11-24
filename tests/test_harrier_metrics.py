import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from validate_harrier import metrics,FILES,CASES,DISTRACTORS
class MetricsTest(unittest.TestCase):
    def test_perfect(self):
        r=metrics([[1,0],[0,1]],[0,1])
        self.assertEqual(r["mrr"],1)
        self.assertEqual(r["ndcg_at_10"],1)
    def test_reverse(self):
        r=metrics([[0,1],[1,0]],[0,1])
        self.assertEqual(r["mrr"],.5)
        self.assertEqual(r["recall_at_1"],0)
        self.assertEqual(r["recall_at_5"],1)
    def test_ties(self):
        self.assertEqual(metrics([[1,1]],[1])["ranks"],[2])
    def test_source(self):
        self.assertEqual(len(CASES),16)
        self.assertEqual(len(DISTRACTORS),8)
        self.assertEqual(sum(v[0] for k,v in FILES.items() if "q4f16" in k),353435746)
        self.assertTrue(all(len(v[1])==64 for v in FILES.values()))
