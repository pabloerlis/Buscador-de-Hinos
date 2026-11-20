#!/usr/bin/env python3
"""Agente de fontes: valida proveniência, integridade e abrangência dos índices.

Bloqueia o APK se os dados forem incompatíveis, incompletos ou não atribuídos.
O download e o hash pinado são verificados pelos próprios scripts de geração.
"""
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app/src/main/assets"
bible = json.loads((ASSETS / "scripture-pt.json").read_text(encoding="utf-8"))
graph = json.loads((ASSETS / "bible-graph.json").read_text(encoding="utf-8"))
catalog = json.loads((ASSETS / "bible-narratives.json").read_text(encoding="utf-8"))
errors = []


def check(test, reason):
    if not test:
        errors.append(reason)


check(bible.get("schema_version") == 1, "Versão da Bíblia desconhecida")
check(bible.get("verse_count") == 31102, "Bíblia incompleta")
check(bible.get("version") == "almeida-livre", "Versão bíblica inesperada")
check(len(bible.get("books", {})) == 66, "Quantidade de livros diferente de 66")
check("CC BY 4.0" in bible.get("license", ""), "Licença bíblica não registrada")
check("Bíblia Livre" in bible.get("attribution", ""), "Atribuição da fonte bíblica ausente")
check(graph.get("schema_version") == 1, "Versão do grafo desconhecida")
check(graph.get("sources", {}).get("scripture") == bible.get("revision"), "Grafo não corresponde à Bíblia")
stats = graph.get("stats", {})
check(stats.get("verse_topics", 0) >= 7000, "Cobertura dos assuntos bíblicos insuficiente")
check(stats.get("crossref_links", 0) >= 200000, "Cobertura de referências cruzadas insuficiente")
check(graph.get("license") and "CC BY" in graph["license"], "Licença do grafo não registrada")
check(graph.get("narratives") == catalog.get("narratives"), "Narrativas não correspondem ao arquivo de origem")

narratives = graph.get("narratives") or []
check(len(narratives) >= 48, "Cobertura de narrativas inferior à referência")
book_aliases = {
    "Gênesis": "Gen", "Êxodo": "Exod", "Salmo": "Ps", "Mateus": "Matt",
    "Marcos": "Mark", "Lucas": "Luke", "João": "John", "Atos": "Acts",
    "1 Samuel": "1Sam", "2 Samuel": "2Sam", "Ezequiel": "Ezek",
    "Daniel": "Dan", "Isaías": "Isa", "Apocalipse": "Rev",
}
ids = set()
for row in narratives:
    rid = row.get("id")
    check(bool(rid) and rid not in ids, "Narrativa sem ID único: " + str(rid))
    ids.add(rid)
    check(bool(row.get("label")) and bool(row.get("aliases")), "Narrativa incompleta: " + str(rid))
    ref = row.get("reference", "")
    match = re.fullmatch(r"(.+?)\s+(\d{1,3})(?::(\d{1,3})(?:-(\d{1,3}))?)?", ref)
    check(match is not None, "Referência bíblica inválida: " + str(ref))
    if match:
        book, chapter = match[1], match[2]
        key = book_aliases.get(book)
        if key:
            check(chapter in bible.get("books", {}).get(key, {}),
                  "Passagem narrativa fora da Bíblia: " + ref)
if errors:
    print("AGENTE DE FONTES — REPROVADO")
    for error in errors:
        print("  -", error)
    sys.exit(1)
print(f"AGENTE DE FONTES — APROVADO: 66 livros, {bible['verse_count']} versículos, "
      f"{len(narratives)} narrativas, {stats['crossref_links']} referências cruzadas.")
