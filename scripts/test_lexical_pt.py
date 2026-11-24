import unittest
from build_lexical_pt import extract_groups, normalize

class LexicalConversionTest(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(normalize("  AÇÃO, de Graças "), "acao de gracas")
    def test_groups_without_transitive_expansion(self):
        xml = """<LexicalResource><Lexicon language="pt">
        <LexicalEntry><Lemma writtenForm="paz"/><Sense synset="a"/></LexicalEntry>
        <LexicalEntry><Lemma writtenForm="serenidade"/><Sense synset="a"/><Sense synset="b"/></LexicalEntry>
        <LexicalEntry><Lemma writtenForm="calma"/><Sense synset="b"/></LexicalEntry>
        <LexicalEntry><Lemma writtenForm="isolado"/><Sense synset="c"/></LexicalEntry>
        </Lexicon><Lexicon language="en"><LexicalEntry><Lemma writtenForm="peace"/><Sense synset="a"/></LexicalEntry></Lexicon></LexicalResource>"""
        self.assertEqual(extract_groups(xml),[("calma","serenidade"),("paz","serenidade")])

if __name__ == "__main__":
    unittest.main()
