#!/usr/bin/env python3
"""Gera índice bíblico offline a partir da Bíblia Livre CC BY 4.0 BR.

Fonte congelada em um commit específico para compilação reproduzível.
Fonte: https://github.com/midvash/bible-data (versão pt/almeida-livre).
Não publica texto de hinos nem utiliza serviços de IA.
"""
import argparse
import hashlib
import json
import pathlib
import urllib.request

SOURCE_COMMIT = '9586bd8228a747962df1ee8692730422fb7eb2ec'
SOURCE_BLOB_SHA = 'dbae1e3397c2007d426762e19d839f1d5fe13d04'
SOURCE_URL = (f'https://raw.githubusercontent.com/midvash/bible-data/{SOURCE_COMMIT}'
              '/versions/pt/almeida-livre/almeida-livre.json')
ATTRIBUTION = ('Bíblia Livre (BLIVRE), Copyright © 2018 Diego Santos, Mario Sérgio e Marco Teles, '
               'http://sites.google.com/site/biblialivre/. Licença Creative Commons Atribuição 4.0 Brasil '
               '(http://creativecommons.org/licenses/by/4.0/br/).')


def build(raw: bytes) -> dict:
    blob = hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest()
    if blob != SOURCE_BLOB_SHA:
        raise ValueError('Fonte bíblica divergente do Git blob SHA fixado: ' + blob)
    src = json.loads(raw)
    if src.get('version') != 'almeida-livre' or src.get('license') != 'cc-by' or src.get('language') != 'pt':
        raise ValueError('Metadados do texto bíblico inesperados')
    books = {}
    verse_count = 0
    for book in src['books']:
        key = book['book']
        chapters = {}
        for chapter in book.get('chapters', []):
            verses = chapter.get('verses', [])
            if not verses:
                continue
            max_verse = max(int(v['number']) for v in verses)
            arr = [''] * (max_verse + 1)
            for verse in verses:
                idx = int(verse['number'])
                if arr[idx]:
                    raise ValueError(f'Versículo duplicado: {key} {chapter["chapter"]}:{idx}')
                arr[idx] = verse['text'].strip()
                verse_count += 1
            chapters[str(chapter['chapter'])] = arr
        books[key] = chapters
    if len(books) != 66 or not 31000 <= verse_count <= 32000:
        raise ValueError(f'Cobertura incompleta: {len(books)} livros; {verse_count} versos')
    return {'schema_version': 1, 'version': 'almeida-livre',
            'revision': SOURCE_COMMIT[:12], 'source': SOURCE_URL,
            'license': 'CC BY 4.0 Brasil', 'attribution': ATTRIBUTION,
            'verse_count': verse_count, 'books': books}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', help='Cópia local do arquivo JSON para testes offline')
    parser.add_argument('--out', default='app/src/main/assets/scripture-pt.json')
    args = parser.parse_args()
    if args.source:
        raw = pathlib.Path(args.source).read_bytes()
    else:
        request = urllib.request.Request(SOURCE_URL, headers={'User-Agent': 'Buscador-de-Hinos/1.7'})
        with urllib.request.urlopen(request, timeout=100) as response:
            raw = response.read(8_500_000)
        if len(raw) > 8_000_000:
            raise ValueError('Arquivo fonte maior que o limite seguro')
    payload = build(raw)
    path = pathlib.Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Bíblia Livre preparada: {len(payload["books"])} livros e {payload["verse_count"]} versículos em {path.stat().st_size} bytes.')


if __name__ == '__main__':
    main()
