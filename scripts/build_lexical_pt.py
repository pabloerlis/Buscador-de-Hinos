#!/usr/bin/env python3
"""Convert the official OpenWordnet-PT 1.0.0 WN-LMF release to direct synonym groups."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET

URL = "https://github.com/own-pt/openWordnet-PT/releases/download/v1.0.0/own-pt.tar.gz"
ARCHIVE_BYTES = 3161610
ARCHIVE_SHA256 = "207c2c9066396ccec0884ac6b2de2aada6b6475fe2b5b21ef71455b84c90506e"
ASSETS = Path(__file__).resolve().parents[1] / "app/src/main/assets"

def normalize(value):
    folded = unicodedata.normalize("NFKD", value)
    folded = "".join(c for c in folded if not "\u0300" <= c <= "\u036f").lower()
    return re.sub(r"[^a-z0-9]+", " ", folded).strip()

def extract_groups(xml):
    root = ET.fromstring(xml)
    by_sense = {}
    for lexicon in root.findall(".//Lexicon"):
        if lexicon.get("language") not in ("pt", "pt-BR", "por"):
            continue
        for entry in lexicon.findall("LexicalEntry"):
            lemma = entry.find("Lemma")
            if lemma is None:
                continue
            word = normalize(lemma.get("writtenForm", ""))
            if not word or len(word) > 80:
                continue
            for sense in entry.findall("Sense"):
                sid = sense.get("synset")
                if sid:
                    by_sense.setdefault(sid, set()).add(word)
    return sorted({tuple(sorted(words)) for words in by_sense.values() if len(words) >= 2})

def build(archive):
    if len(archive) != ARCHIVE_BYTES:
        raise ValueError("Unexpected archive size")
    if hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("OpenWordnet-PT source SHA-256 mismatch")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        members = [m for m in tar.getmembers() if m.isfile() and m.name.endswith("/own-pt-lmf.xml")]
        if len(members) != 1 or not 0 < members[0].size <= 100_000_000:
            raise ValueError("Unexpected Portuguese WN-LMF archive layout")
        xml = tar.extractfile(members[0]).read()
    groups = extract_groups(xml)
    vocabulary = {word for group in groups for word in group}
    if len(groups) != 15372 or len(vocabulary) != 26129:
        raise ValueError("Incomplete lexical coverage")
    return {"schema_version":1, "source":"OpenWordnet-PT 1.0.0",
            "source_url":URL, "archive_sha256":hashlib.sha256(archive).hexdigest(),
            "license":"CC BY 4.0", "license_url":"https://creativecommons.org/licenses/by/4.0/",
            "attribution":"OpenWordnet-PT — Alexandre Rademaker, Valeria de Paiva, Fredson Aguiar and contributors; based on Princeton WordNet 3.0",
            "modifications":"Normalized lemmas; retained only direct shared synsets with two or more distinct lemmas; duplicate groups removed.",
            "stats":{"groups":len(groups),"terms":len(vocabulary)}, "groups":groups}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--output", type=Path, default=ASSETS/"lexical-pt.json")
    args = parser.parse_args()
    if args.archive:
        archive = args.archive.read_bytes()
    else:
        with urllib.request.urlopen(URL, timeout=90) as response:
            archive = response.read(ARCHIVE_BYTES+1)
    data = build(archive)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",",":"))+"\n", encoding="utf-8")
    print("OpenWordnet-PT:", data["stats"], "bytes:", args.output.stat().st_size, "archive sha256:",data["archive_sha256"])

if __name__ == "__main__":
    main()
