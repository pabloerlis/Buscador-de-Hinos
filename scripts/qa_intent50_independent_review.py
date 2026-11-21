#!/usr/bin/env python3
"""Second implementation of independent QA for 50 blind queries.
Executes in Agent 8, independently from Node Agent 12.
Neither script can substitute human relevance ratings.
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"qa-report"
errors=[]
def require(condition, reason):
    if not condition:
        errors.append(reason)
def load(path):
    return json.loads(path.read_text(encoding="utf-8"))

manifest_path=ROOT/"qa/semantic-intents-50.json"
manifest=load(manifest_path)
packet=load(OUT/"intent50-blind-packet.json")
sealed=load(OUT/"intent50-sealed-ranking.json")
vectors=load(OUT/"intent50-vectors.json")
agent=load(OUT/"intent50-independent-agent.json")
digest=hashlib.sha256(manifest_path.read_bytes()).hexdigest()
require(manifest["schema_version"]==1 and len(manifest["intents"])==50,"Source manifest invalid")
require(agent.get("decision")=="approved" and agent.get("agent")=="12-independent-intent50-review-packet"
        and agent.get("reviewed_intents")==0 and not agent.get("errors"),"Agent 12 did not approve")
require(all(p.get("manifest_sha256")==digest for p in (packet,sealed,vectors,agent)),
        "Manifest provenance does not match all independent reports")
require(packet.get("human_review_status")=="pending" and sealed.get("human_review_status")=="pending"
        and agent.get("human_review_status")=="pending","Human relevance falsely stated")
require(len(packet.get("rows",[]))==len(sealed.get("rows",[]))==len(vectors.get("vectors",[]))==50,
        "Missing intent")
require(packet.get("catalog_sha256")==sealed.get("catalog_sha256")==agent.get("catalog_sha256"),
        "Catalog hash differs between reports")
seen=set()
for i, (intent,p,s,v) in enumerate(zip(manifest["intents"],packet["rows"],sealed["rows"],vectors["vectors"])):
    require(intent["id"]==p.get("id")==s.get("id")==v.get("id") and
            intent["query"]==p.get("query"),"Query changed at "+str(i))
    seen.add(intent["query"].casefold().strip())
    require(len(v.get("vector",[]))==384,"E5 vector not 384D "+str(i))
    off=s.get("without_e5",[])
    on=s.get("with_e5",[])
    pool={*off,*on}
    published=p.get("candidates",[])
    require(len(off)==20 and len(on)==20 and len(set(off))==20 and len(set(on))==20,
            "Top20 missing or duplicated "+str(i))
    require(len(pool)==len(published) and {c.get("blind_id") for c in published}==pool,
            "Blind union is not exact at "+str(i))
    require(not any(any(k in c for k in ("rank","score","lyrics","lyric","stanza","excerpt",
                                         "relevance","label","judgment","vector")) for c in published),
            "Labels or ranking leaked "+str(i))
    require(not any(k in p for k in ("rank","score","without_e5","with_e5","relevance","labels",
                                    "judgments","lyrics")),"Variant or label leak "+str(i))
require(len(seen)==50,"Not 50 distinct intents")
report={"schema_version":1,"agent":"8-second-implementation-intent50-review",
        "decision":"approved" if not errors else "rejected",
        "human_review_status":"pending","reviewed_intents":0,"prepared_intents":len(seen),
        "errors":errors}
(OUT/"intent50-review-audit.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
print("AGENT 8 intent50 independent verification: "+report["decision"].upper()+
      "; 50 draft intents, no fabricated relevance labels")
if errors:
    for message in errors:
        print("ERROR: "+message,file=sys.stderr)
    sys.exit(1)
