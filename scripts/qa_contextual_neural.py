#!/usr/bin/env python3
"""Experimental semantic retrieval over the actual 2018 hymns. No hymn text is published.
No per-hymn ranking rules, no previous-version comparator, no target labels used for scoring.
"""
import base64, hashlib, json, subprocess, sys
from pathlib import Path
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from huggingface_hub import hf_hub_download
from build_e5_assets import encode,opt,REPO,REVISION,MODEL_SHA256,fetch_hymns,normalize

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'app/src/main/assets'
REPORT=ROOT/'qa-report/contextual-full-lyrics-neural.json'
MIN_SIM=.82
MIN_MARGIN=.025
CANDIDATES=80
MAX_TOKENS=384
GLOBAL_WEIGHT=.65

def unit(x):
    return x/np.maximum(np.linalg.norm(x,axis=-1,keepdims=True),1e-9)

def node(script):
    return json.loads(subprocess.check_output(['node','-e',script],cwd=ROOT,text=True))

def scenes_from_bible():
    # Parse references using the application's own parser, then take all verses.
    return node("""
const fs=require('fs'),vm=require('vm');
const a='app/src/main/assets/';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(a+'scripture-index.js','utf8'),ctx);
const parse=vm.runInContext('ScriptureIndex.parse',ctx);
const books=JSON.parse(fs.readFileSync(a+'scripture-pt.json','utf8')).books;
const scenes=JSON.parse(fs.readFileSync(a+'bible-narratives.json','utf8')).narratives;
console.log(JSON.stringify(scenes.map(n=>{
 const p=parse(n.reference);
 if(!p)throw Error('Invalid reference '+n.reference);
 const chapter=books[p.id][String(p.chapter)];
 const verses=chapter.slice(p.from||1,(p.to||chapter.length-1)+1).filter(Boolean);
 if(!verses.length)throw Error('Missing verses '+n.reference);
 return {...n,verses};
})));
""")

def main():
    groups=json.loads(subprocess.check_output(['node','tests/qa-contextual-absolute.js','--manifest'],cwd=ROOT,text=True))
    controls=[
      'Estou angustiado e quero confiar em Deus sem saber o que acontecerá amanhã',
      'Um louvor de gratidão pela recuperação da minha saúde',
      'Um hino para consolar uma família que perdeu um ente querido',
      'Quero cantar sobre a certeza da volta de Jesus',
      'Precisamos de comunhão e unidade entre os irmãos',
      'Uma mensagem sobre servir com humildade sem esperar reconhecimento',
      'Gostaria de um hino de oração antes de começar o dia',
      'Esperança e paz para quem está passando por dificuldades financeiras'
    ]
    # Scoring inputs are separated from the target labels, which are read only for grading.
    queries=[q for g in groups for q in g['queries']]+controls
    model_path=ASSETS/'e5-model.onnx'
    assert hashlib.sha256(model_path.read_bytes()).hexdigest()==MODEL_SHA256
    model=ort.InferenceSession(str(model_path),sess_options=opt(),providers=['CPUExecutionProvider'])
    tok=Tokenizer.from_file(hf_hub_download(repo_id=REPO,filename='tokenizer.json',revision=REVISION))
    def embed(texts,max_tokens=MAX_TOKENS):
        # Length sorting minimizes padding while preserving input ordering.
        order=sorted(range(len(texts)),key=lambda i:len(tok.encode(texts[i]).ids))
        result=np.empty((len(texts),384),np.float32)
        for start in range(0,len(order),8):
            ids=order[start:start+8]
            result[ids]=encode(model,tok,[texts[i] for i in ids],max_tokens=max_tokens)
        assert np.isfinite(result).all()
        return unit(result)
    scenes=scenes_from_bible()
    assert len(scenes)>=40
    scene_docs=[]
    scene_query_docs=[]
    scene_slices=[]
    for s in scenes:
        start=len(scene_docs)
        title=s['label']+'. '+'. '.join(s['aliases'])
        verses=s['verses']
        windows=[' '.join(verses[i:i+5]) for i in range(0,len(verses),3)]
        docs=[title]+[s['label']+'. '+x for x in windows]
        scene_docs.extend('passage: '+x for x in docs)
        scene_query_docs.extend('query: '+x for x in docs)
        scene_slices.append((start,len(scene_docs)))
    scene_vectors=embed(scene_docs)
    scene_queries=embed(scene_query_docs)
    # Every biblical scene is represented by its title and distributed windows.
    # The centroid is distinct from the max-window score used for routing.
    centroids=np.stack([unit(.45*scene_queries[a]+.55*np.mean(scene_queries[a+1:b],axis=0))
                        for a,b in scene_slices])
    query_vectors=embed(['query: '+q for q in queries],max_tokens=96)
    index=json.loads((ASSETS/'e5-index.json').read_text())
    assert index['model_sha256']==MODEL_SHA256
    hymns,_,digest=fetch_hymns()
    assert digest==index['source_sha256']=='57d42fb0bcc881a62b210dd1a3972822d2c39856f7a01278e104d407bf1b747a'
    by_fp={h['fingerprint']:h for h in hymns}
    rows=[r for r in index['records'] if r['f'] in by_fp]
    assert len(rows)>=1450
    passage_matrix=[];owners=[]
    for i,r in enumerate(rows):
        for v in r['v']:
            passage_matrix.append(np.frombuffer(base64.b64decode(v),dtype=np.int8).astype(np.float32))
            owners.append(i)
    matrix=unit(np.stack(passage_matrix))
    owners=np.array(owners)
    def local_scores(q):
        score=np.full(len(rows),-1.,dtype=np.float32)
        np.maximum.at(score,owners,matrix@q)
        return score
    def pick(scores):
        return np.argsort(-scores,kind='stable')[:CANDIDATES]
    def exact(q):
        q=normalize(q)
        return next((i for i,s in enumerate(scenes)
                    if q in {normalize(x) for x in [s['reference'],s['label'],*s['aliases']]}),None)

    jobs=[];pool=set()
    for q,qv in zip(queries,query_vectors):
        scores=scene_vectors@qv
        scene_score=np.array([.65*np.max(scores[a:b])+.35*scores[a] for a,b in scene_slices])
        order=np.argsort(-scene_score,kind='stable')
        top,second=int(order[0]),int(order[1])
        margin=float(scene_score[top]-scene_score[second])
        explicit=exact(q)
        chosen=explicit if explicit is not None else (top if scene_score[top]>=MIN_SIM and margin>=MIN_MARGIN else None)
        raw=local_scores(qv)
        canonical=local_scores(centroids[chosen]) if chosen is not None else raw
        # Raw references do not carry meaningful natural-language embeddings.
        is_reference=chosen is not None and normalize(q)==normalize(scenes[chosen]['reference'])
        mix=1.0 if is_reference else (.60 if chosen is not None else 0.)
        local=(1-mix)*raw+mix*canonical
        # Independent retrieval across all indexed hymns, not UI page or tuner pool.
        candidates=np.unique(np.r_[pick(raw),pick(canonical),pick(local)])
        pool.update(int(i) for i in candidates)
        jobs.append({'query':q,'query_vector':qv,'scene':chosen,'mix':mix,
                     'nearest':top,'similarity':float(scene_score[top]),'margin':margin,
                     'local':local,'candidates':candidates})
    print('Full-lyric reranking pool:',len(pool),'of',len(rows),'hymns',flush=True)
    # For each finalist, encode the entire lyric, splitting only when the tokenizer
    # exceeds the model context. Every word is retained and weighted by token length.
    chunks=[];chunk_meta=[]
    def split_all(text):
        size=len(tok.encode('passage: '+text).ids)
        if size<=MAX_TOKENS:return [(text,size)]
        words=text.split()
        if len(words)<2:raise ValueError('Single oversized token sequence')
        m=len(words)//2
        return split_all(' '.join(words[:m]))+split_all(' '.join(words[m:]))
    for i in sorted(pool):
        h=by_fp[rows[i]['f']]
        for chunk,length in split_all(h['title']+'\n'+h['lyrics']):
            chunks.append('passage: '+chunk);chunk_meta.append((i,length))
    vectors=embed(chunks)
    full=np.zeros((len(rows),384),np.float32)
    for (i,length),v in zip(chunk_meta,vectors):
        full[i]+=v*length
    full=unit(full)
    labels={q:g for g in groups for q in g['queries']}
    def identity(i):
        h=by_fp[rows[int(i)]['f']]
        return (h['collection'],h['number'] or h['title'].upper())
    outcomes=[]
    for j in jobs:
        q=j['query']; candidates=j['candidates']; scene=j['scene']; mix=j['mix']
        qv=j['query_vector']
        global_score=(1-mix)*(full[candidates]@qv)
        if scene is not None:global_score+=mix*(full[candidates]@centroids[scene])
        score=GLOBAL_WEIGHT*global_score+(1-GLOBAL_WEIGHT)*j['local'][candidates]
        ranked=candidates[np.argsort(-score,kind='stable')]
        label=labels.get(q)
        out={'query':q,'route':scenes[scene]['reference'] if scene is not None else None,
             'nearest_scene':scenes[j['nearest']]['reference'],'route_similarity':j['similarity'],
             'route_margin':j['margin'],'pool_size':len(candidates),
             'top10':[{'collection':identity(i)[0],'number_or_title':identity(i)[1],
                       'title':by_fp[rows[int(i)]['f']]['title']} for i in ranked[:10]]}
        if label:
            targets={tuple(x) for x in label['targets']}; weak={tuple(x) for x in label.get('weak',[])}
            first=next((n+1 for n,i in enumerate(ranked) if identity(i) in targets),None)
            weak_rank=next((n+1 for n,i in enumerate(ranked) if identity(i) in weak),None)
            out.update(episode=label['id'],expected_reference=label['queries'][0],
                       first_known_positive=first,user_contested_rank=weak_rank,
                       passed=bool(first and first<=3 and (weak_rank is None or weak_rank>3)))
        else:
            out.update(control=True,passed=scene is None)
        outcomes.append(out)
        print(json.dumps(out,ensure_ascii=False),flush=True)
    episodes=[x for x in outcomes if 'episode' in x]
    controls_out=[x for x in outcomes if x.get('control')]
    report={'schema_version':1,'status':'experimental','catalog_sha256':digest,'catalog_indexed':len(rows),
            'model_sha256':MODEL_SHA256,'scenes':len(scenes),'full_lyrics_encoded':len(pool),
            'full_lyric_chunks':len(chunks),'thresholds':{'route_similarity':MIN_SIM,'route_margin':MIN_MARGIN,
             'candidate_count_per_retriever':CANDIDATES,'global_weight':GLOBAL_WEIGHT},
            'human_review_status':'pending','nli_inference':False,'rows':outcomes,
            'known_positive_top1':sum(x['first_known_positive']==1 for x in episodes)/len(episodes),
            'known_positive_top3':sum(bool(x['first_known_positive'] and x['first_known_positive']<=3) for x in episodes)/len(episodes),
            'episode_failures':sum(not x['passed'] for x in episodes),
            'control_false_routes':sum(not x['passed'] for x in controls_out)}
    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('NEURAL CONTEXT GATE '+json.dumps({k:v for k,v in report.items() if k not in ('rows',)},ensure_ascii=False))
    if report['episode_failures'] or report['control_false_routes']:sys.exit(1)

if __name__=='__main__':main()
