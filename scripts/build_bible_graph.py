#!/usr/bin/env python3
"""Constrói, antes da compilação Android, relações tópicas e cruzadas verificáveis.

Dados CC BY 4.0 (NEUU/OpenBible) e Bíblia Livre. Nenhuma IA é executada.
Os datasets são fixados em revisões Git para reproduzir a geração.
"""
from collections import Counter, defaultdict
from pathlib import Path
import argparse
import io
import json
import re
import tarfile
import tempfile
import unicodedata
import urllib.request
import time

TOPICS_COMMIT = 'eeb9b7418be4d02c497d142da3b9890fad356252'
CROSS_COMMIT = '8aa012820f5881a787e87d71005a22f52844c4fb'
TOPICS_URL = f'https://codeload.github.com/neuu-org/bible-topics-dataset/tar.gz/{TOPICS_COMMIT}'
CROSS_URL = f'https://raw.githubusercontent.com/neuu-org/bible-crossrefs-dataset/{CROSS_COMMIT}/data/00_raw/openbible/cross_references.txt'
ASSET_DIR = Path('app/src/main/assets')
ENGLISH = '''Genesis:Gen Exodus:Exod Leviticus:Lev Numbers:Num Deuteronomy:Deut Joshua:Josh Judges:Judg Ruth:Ruth
1_Samuel:1Sam 2_Samuel:2Sam 1_Kings:1Kgs 2_Kings:2Kgs 1_Chronicles:1Chr 2_Chronicles:2Chr Ezra:Ezra Nehemiah:Neh Esther:Esth
Job:Job Psalm:Ps Psalms:Ps Proverbs:Prov Ecclesiastes:Eccl Song_of_Solomon:Song Song_of_Songs:Song Isaiah:Isa Jeremiah:Jer Lamentations:Lam Ezekiel:Ezek Daniel:Dan
Hosea:Hos Joel:Joel Amos:Amos Obadiah:Obad Jonah:Jonah Micah:Mic Nahum:Nah Habakkuk:Hab Zephaniah:Zeph Haggai:Hag Zechariah:Zech Malachi:Mal
Matthew:Matt Mark:Mark Luke:Luke John:John Acts:Acts Romans:Rom 1_Corinthians:1Cor 2_Corinthians:2Cor Galatians:Gal Ephesians:Eph Philippians:Phil Colossians:Col
1_Thessalonians:1Thess 2_Thessalonians:2Thess 1_Timothy:1Tim 2_Timothy:2Tim Titus:Titus Philemon:Phlm Hebrews:Heb James:Jas 1_Peter:1Pet 2_Peter:2Pet
1_John:1John 2_John:2John 3_John:3John Jude:Jude Revelation:Rev'''
BOOK_ALIASES = {key.replace('_',' ').lower():v for item in ENGLISH.split() for key,v in [item.split(':')]}
BOOK_ALIASES.update({'jn':'John','jhn':'John','psa':'Ps','psalm':'Ps','ps':'Ps','song of songs':'Song','song of solomon':'Song', 'canticles':'Song', 'revelations':'Rev','gen':'Gen','mrk':'Mark','luk':'Luke','mat':'Matt','1 cor':'1Cor','2 cor':'2Cor','1 sam':'1Sam','2 sam':'2Sam'})
# Vocabulário temático português curado. Padrões aplicados a rótulos EN, não à letra dos hinos.
MAP = {
'fe':r'\b(faith|believ|unbelief)\b', 'confianca':r'\b(trust|confidence|reliance)\b',
'cura':r'\b(healing|healings|cure|miracle|disease|sickness|sick)\b',
'graca':r'\b(grace|mercy|compassion|merciful)\b', 'perdao':r'\b(forgive|forgiveness|pardon|forgiving)\b',
'arrependimento':r'\b(repentance|repent|penitence|remorse|confession of sin)\b',
'salvacao':r'\b(salvation|saviour|redeem|redemption|saved)\b',
'consolo':r'\b(comfort|consolation|grief|mourning|sorrow|suffer)\b',
'esperanca':r'\b(hope|hopes|promises of god|promise)\b',
'protecao':r'\b(protection|deliverance|refuge|safety|preservation)\b',
'paz':r'\b(peace|rest of soul|quietness)\b','perseveranca':r'\b(perseverance|endurance|patience)\b',
'oracao':r'\b(prayer|praying|supplication|intercession)\b',
'amor':r'\b(love|charity|kindness)\b','ressurreicao':r'\b(resurrection|rising from the dead)\b',
'cruz':r'\b(crucifixion|cross of christ|atonement|sacrifice of christ)\b',
'vida_eterna':r'\b(eternal life|everlasting life|immortality)\b',
'volta_jesus':r'\b(second advent|second coming|coming of christ)\b',
'espirito_santo':r'\b(holy spirit|holy ghost|spirit of god)\b',
'gratidao':r'\b(thanksgiving|gratitude|thankfulness)\b',
'louvor':r'\b(praise|psalm|song of praise)\b',
'adoracao':r'\b(worship|adoration)\b','obediencia':r'\b(obedience|obedient)\b',
'humildade':r'\b(humility|humble|meekness)\b', 'vitoria':r'\b(victory|overcoming|triumph)\b',
'direcao':r'\b(guidance|leading of god|wisdom of god)\b',
'evangelizacao':r'\b(evangelis|gospel|preaching)\b',
'batismo':r'\b(baptism|baptizing)\b', 'ceia':r'\b(lord.s supper|communion of the lord|eucharist)\b',
'familia':r'\b(family|fatherhood|motherhood|marriage)\b',
'criancas':r'\b(childhood|children)\b',
'santificacao':r'\b(holiness|sanctification|purity)\b',
'renovacao':r'\b(renewal|new birth|regeneration|restoration)\b',
'igreja':r'\b(church|congregation|body of christ)\b',
'comunhao':r'\b(fellowship|unity|brotherhood)\b',
'alegria':r'\b(joy|rejoicing|happiness)\b',
'vigilancia':r'\b(watching|watchfulness|watching for christ)\b',
'servico':r'\b(service|ministering|servanthood)\b',
'biblia':r'\b(scripture|word of god|bible)\b',
'missao':r'\b(mission|missionaries)\b',
'tribulacao':r'\b(trials|tribulation|adversity|affliction)\b',
}
PATTERNS={id:re.compile(expr,re.I) for id,expr in MAP.items()}


def book_id(raw):
    k=re.sub(r'\s+',' ',str(raw).replace('_',' ').strip().lower())
    return BOOK_ALIASES.get(k)

def valid_key(k,verses):
    try:
        book,chapter,verse=k.split('.')
        return book in verses and chapter in verses[book] and 0<int(verse)<len(verses[book][chapter]) and bool(verses[book][chapter][int(verse)])
    except (ValueError,KeyError,TypeError):return False


def download(url,target,max_bytes):
    error=None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Buscador-de-Hinos-offline-2.0'}),timeout=130) as response, open(target,'wb') as dst:
                total=0
                while True:
                    chunk=response.read(1024*1024)
                    if not chunk:break
                    total+=len(chunk)
                    if total>max_bytes:raise ValueError('Fonte excedeu limite de tamanho: '+url)
                    dst.write(chunk)
            return
        except Exception as ex:
            error=ex
            if attempt<2:time.sleep(3*(attempt+1))
    raise RuntimeError('Falha ao obter fonte pública: '+url+' — '+str(error))


def build(scripture, topics_archive, crossref_path, narratives):
    verses=scripture['books']
    topical=defaultdict(Counter); processed=0; mapped=0; matched_refs=0
    with tarfile.open(topics_archive,'r:gz') as tar:
        for member in tar:
            if not member.isfile() or not re.search(r'/data/01_parsed/[A-Z]/[^/]+\.json$',member.name):continue
            processed+=1
            obj=json.load(tar.extractfile(member))
            topic=str(obj.get('topic','')).lower().replace(',',' ')
            labels=[key for key,pattern in PATTERNS.items() if pattern.search(topic)]
            if not labels:continue
            mapped+=1
            for ref in obj.get('biblical_references') or []:
                book=book_id(ref.get('book'))
                chapter=ref.get('chapter')
                vs=ref.get('verses',[])
                if not book or not isinstance(chapter,int) or not isinstance(vs,list):continue
                for v in vs[:160]:
                    key=f'{book}.{chapter}.{v}'
                    if valid_key(key,verses):
                        matched_refs+=1
                        for label in labels[:3]:topical[key][label]+=1
    if processed<5000 or mapped<80 or matched_refs<1500:raise ValueError(f'Índice de tópicos insuficiente: {processed=}, {mapped=}, {matched_refs=}')
    # Referências cruzadas: manter os 6 links de maior voto em cada versículo.
    crossrefs=defaultdict(list);raw_links=0
    with open(crossref_path,'r',encoding='utf-8-sig') as f:
        for line in f:
            cells=line.strip().split('\t')
            if len(cells)<3 or cells[0].lower()=='from':continue
            src,dst=cells[:2]
            try:votes=int(cells[2])
            except ValueError:continue
            def parse_ref(text):
                terms=text.strip().split('.')
                if len(terms)!=3:return None
                book=book_id(terms[0]);return f'{book}.{terms[1]}.{terms[2]}' if book else None
            a,b=parse_ref(src),parse_ref(dst)
            if a and b and a!=b and valid_key(a,verses) and valid_key(b,verses):
                raw_links+=1
                crossrefs[a].append((b,votes))
    if raw_links<200000:raise ValueError(f'Índice de referências cruzadas insuficiente: {raw_links}')
    crossout={}
    for ref,items in crossrefs.items():
        candidates={}
        for b,v in items:candidates[b]=max(v,candidates.get(b,0))
        crossout[ref]=[[b,min(500,v)] for b,v in sorted(candidates.items(),key=lambda a:(-a[1],a[0]))[:6]]
    topicout={k:[name for name,_ in ctr.most_common(12)] for k,ctr in topical.items()}
    return {'schema_version':1,'revision':'2.0-bible-graph-v1',
            'sources':{'topics':'neuu-org/bible-topics-dataset@'+TOPICS_COMMIT, 'crossrefs':'neuu-org/bible-crossrefs-dataset@'+CROSS_COMMIT, 'scripture':scripture['revision']},
            'license':'CC BY 4.0 · Attribution NEUU / OpenBible / Bíblia Livre',
            'stats':{'topics_read':processed,'topics_mapped':mapped,'topic_links':matched_refs,'crossref_links':raw_links,'crossref_verses':len(crossout),'verse_topics':len(topicout)},
            't':topicout,'x':crossout,'narratives':narratives['narratives']}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--scripture',default=str(ASSET_DIR/'scripture-pt.json'))
    parser.add_argument('--narratives',default=str(ASSET_DIR/'bible-narratives.json'))
    parser.add_argument('--out',default=str(ASSET_DIR/'bible-graph.json'))
    parser.add_argument('--topics-archive')
    parser.add_argument('--crossrefs')
    args=parser.parse_args()
    bible=json.loads(Path(args.scripture).read_text(encoding='utf8'))
    narratives=json.loads(Path(args.narratives).read_text(encoding='utf8'))
    if bible['verse_count']!=31102:raise ValueError('Bíblia Livre incompleta')
    with tempfile.TemporaryDirectory() as folder:
        topicspath=Path(args.topics_archive) if args.topics_archive else Path(folder)/'topics.tar.gz'
        crosspath=Path(args.crossrefs) if args.crossrefs else Path(folder)/'crossrefs.tsv'
        if not args.topics_archive:download(TOPICS_URL,topicspath,250_000_000)
        if not args.crossrefs:download(CROSS_URL,crosspath,20_000_000)
        data=build(bible,topicspath,crosspath,narratives)
    dest=Path(args.out);dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    if dest.stat().st_size>18_000_000:raise ValueError('Índice excedeu 18MB')
    print('Índice bíblico offline:',data['stats'],'bytes:',dest.stat().st_size)

if __name__=='__main__':main()
