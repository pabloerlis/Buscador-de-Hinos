#!/usr/bin/env python3
"""Converte uma transcrição CCB autorizada (CSV UTF-8) em JSON local.

Entrada: CSV com colunas tipo,numero,titulo,letra. Tipos: hino ou coro.
Hinos 1..480, coros 1..6. Letras com quebras de linha em campos CSV entre aspas.
Uso: python scripts/convert_ccb_catalog.py entrada.csv saida.json
Não baixa letras nem concede direitos de redistribuição. Mantenha a saída fora
do Git público se não houver autorização expressa do titular.

Referência de conferência (não oficial): https://hinarioccb.net/
Consultada em 2026-11-25. A data de revisão das letras não foi confirmada.
"""
import argparse
import csv
import json
from pathlib import Path


def convert(rows):
    groups = {"hino": {}, "coro": {}}
    limits = {"hino": 480, "coro": 6}
    for line, row in enumerate(rows, 2):
        kind = (row.get("tipo") or "").strip().lower()
        if kind not in limits:
            raise ValueError(f"Linha {line}: tipo inválido")
        try:
            number = int(row.get("numero") or "")
        except ValueError:
            raise ValueError(f"Linha {line}: número inválido") from None
        if not 1 <= number <= limits[kind] or number in groups[kind]:
            raise ValueError(f"Linha {line}: número fora da faixa ou duplicado")
        title = (row.get("titulo") or "").strip()
        lyrics = (row.get("letra") or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not title or not lyrics:
            raise ValueError(f"Linha {line}: título ou letra ausente")
        groups[kind][number] = {
            "number": str(number).zfill(3),
            "title": title,
            "content": lyrics,
        }
    for kind, limit in limits.items():
        missing = sorted(set(range(1, limit + 1)) - groups[kind].keys())
        if missing:
            raise ValueError(f"Catálogo incompleto ({kind}): {missing}")
    return [
        {"name": "CCB - Hinário 5", "songs": [groups["hino"][n] for n in range(1, 481)]},
        {"name": "CCB - Coros", "songs": [groups["coro"][n] for n in range(1, 7)]},
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entrada", type=Path)
    parser.add_argument("saida", type=Path)
    args = parser.parse_args()
    with args.entrada.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {"tipo", "numero", "titulo", "letra"}
        if not required.issubset(reader.fieldnames or []):
            parser.error("CSV deve conter tipo,numero,titulo,letra")
        try:
            data = convert(reader)
        except ValueError as exc:
            parser.error(str(exc))
    # Não sobrescreve arquivos existentes.
    with args.saida.open("x", encoding="utf-8", newline="\n") as target:
        json.dump(data, target, ensure_ascii=False, indent=2)
        target.write("\n")
    print("JSON gerado: 480 hinos e 6 coros.")


if __name__ == "__main__":
    main()
