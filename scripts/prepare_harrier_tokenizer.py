#!/usr/bin/env python3
"""Vendor only the pinned tokenizer runtime, never tokenizer vocabulary or weights."""
import urllib.request,hashlib,base64,tarfile,io,json,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/"app/src/main/assets"
URL="https://registry.npmjs.org/@huggingface/tokenizers/-/tokenizers-0.2.0.tgz"
SHA512="LidMHe1FpcSYH4vcSjXooda34pC0M8m1gmDOv7SQi6Iv+ib1zX7J3sHBCC9/3FPCkn2k1b55FneVqMRxrr99pg=="
def get(url,limit):
    with urllib.request.urlopen(url,timeout=90) as r:
        b=r.read(limit+1)
    if len(b)>limit:raise ValueError("Unexpected file size")
    return b
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--test-dir",type=Path)
    args=parser.parse_args()
    archive=get(URL,4_000_000)
    if base64.b64encode(hashlib.sha512(archive).digest()).decode()!=SHA512:raise ValueError("Tokenizer package checksum mismatch")
    with tarfile.open(fileobj=io.BytesIO(archive),mode="r:gz") as t:
        def read(name):
            f=t.extractfile("package/"+name)
            if f is None:raise ValueError("Missing "+name)
            return f.read()
        p=json.loads(read("package.json"))
        if p["version"]!="0.2.0" or p["license"]!="Apache-2.0" or p.get("dependencies"):raise ValueError("Unexpected tokenizer package")
        cjs=read("dist/tokenizers.cjs").decode("utf8")
        # No eval, network script, or CDN at runtime. Wrap the local CommonJS build.
        code="/* Hugging Face Tokenizers.js 0.2.0, Apache-2.0; see harrier-tokenizers-LICENSE.txt */\n(function(){var module={exports:{}},exports=module.exports;\n"+cjs+"\n;globalThis.HarrierTokenizerLib=module.exports;})();\n"
        (ASSETS/"harrier-tokenizers.js").write_text(code,encoding="utf8")
        (ASSETS/"harrier-tokenizers-LICENSE.txt").write_bytes(read("LICENSE"))
    if args.test_dir:
        args.test_dir.mkdir(parents=True,exist_ok=True)
        base="https://huggingface.co/onnx-community/harrier-oss-v1-0.6b-ONNX/resolve/dbaf6767003608562dd5b744bc443656a29c45bd/"
        for name,size,digest in [
            ("tokenizer.json",9117473,"2320ebaed2032c36f5c539cb8531d0642a10024e164f1d81ebbe163b259e3ba5"),
            ("tokenizer_config.json",4650,"e1c8a5341a350885510d652a3a303beabf3a76ef745af6c6b4c3f0d815ccfb5c")]:
            data=get(base+name,size)
            if len(data)!=size or hashlib.sha256(data).hexdigest()!=digest:raise ValueError("Tokenizer configuration integrity")
            (args.test_dir/name).write_bytes(data)
    print("Pinned tokenizer runtime prepared (no model weights or vocab in APK)")
if __name__=="__main__":main()
