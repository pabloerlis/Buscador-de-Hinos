import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from build_harrier_index import fingerprint,records_from_catalog,passages,MODEL_FILES,plain,title_of,quantize
class IndexTest(unittest.TestCase):
    def test_fingerprint(self):
        self.assertEqual(fingerprint("PÁZ","Alegría\n do Senhor"),fingerprint("paz","alegria do senhor"))
        self.assertNotEqual(fingerprint("Paz","a"),fingerprint("Paz","b"))
    def test_catalog(self):
        data=[{"name":name,"songs":[{"title":"001 - Paz","content":"A paz<br>do Senhor"}]} for name in ("Coletânea 2018","Avulsos 2018","CIA 2018")]
        records,counts=records_from_catalog(data)
        self.assertEqual(len(records),1)
        self.assertEqual(sum(counts.values()),3)
        self.assertEqual(next(iter(records.values())),("Paz","A paz\ndo Senhor"))
    def test_wrong_catalog(self):
        with self.assertRaises(ValueError):records_from_catalog([])
    def test_segments(self):
        self.assertEqual(passages("Paz","Uma linha"),["Paz. Uma linha"])
        self.assertEqual(len(passages("Paz","\n".join(str(x) for x in range(25)))),2)
    def test_model_size(self):
        self.assertEqual(sum(x[0] for x in MODEL_FILES.values()),362559399)
    def test_quantize(self):
        import numpy as np,base64
        v=np.full(1024,1/32,dtype=np.float32)
        encoded,cosine=quantize(v)
        self.assertEqual(len(base64.b64decode(encoded)),1024)
        self.assertGreater(cosine,.999)
        with self.assertRaises(ValueError):quantize(np.zeros(1024))
