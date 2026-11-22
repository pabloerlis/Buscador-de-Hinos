import json
from pathlib import Path

folder = Path('/tmp/hinos-review')
before = json.loads((folder / 'before.json').read_text())
grades = [line.split('\t') for line in (folder / 'grades.tsv').read_text().splitlines()]
assert len(before) == len(grades) == 4
rows = [dict(item, fits=grade == 'sim', inference_ms=int(wall))
        for item, (grade, wall) in zip(before, grades)]
after = sorted(rows, key=lambda item: not item['fits'])
result = dict(hardware='Linux x86_64, GitHub hosted', before=rows,
              after=[dict(item, new_rank=i + 1) for i, item in enumerate(after)],
              total_inference_ms=sum(row['inference_ms'] for row in rows))
content = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
(folder / 'result.json').write_text(content)
print(content)
