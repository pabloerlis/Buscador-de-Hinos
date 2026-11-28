# P1 — amostra real estratificada e fila de revisão independente

A questão da [issue #60](https://github.com/pabloerlis/Buscador-de-Hinos/issues/60) agora dispõe de uma fila reproduzível de evidências para revisão humana, sem modificar o Android.

## Como reproduzir no CI

O job existente `full_lyrics_qa` baixa exclusivamente o catálogo público pinado para `.tmp/catalog-2018.json`, verifica as 1.557 letras com `tests/agents/run-validation.js` e, em seguida, executa:

```sh
node scripts/qa_contextual_review.js .tmp/catalog-2018.json reports/validation/resultado-agentes.json qa-report/contextual-review-queue.json
```

O script verifica SHA-256 do catálogo, PASS dos agentes e paridade na importação antes de emitir qualquer amostra. O arquivo de saída é disponibilizado como artifact QA, nunca empacotado no APK. Cada consulta recebe amostras de resultados com apoio lexical fraco/forte e candidatos recuperados lexicalmente fora do top10 (sem classificar automaticamente verdadeiros positivos/negativos).

Para estudo de perfis semânticos, a seleção usa amostragem determinística de estrofes curtas/médias/longas, presença lexical de negação, primeira pessoa e mudança de vocabulário início/fim. Tais marcadores são **proxies estruturais**; não inferem mensagem, perspectiva nem desfecho verdadeiros. IDs, títulos, número, hash da letra e classe estrutural são permitidos; nenhuma letra, snippet ou conclusão semântica automática é armazenada.

As tarefas carregam `relevance_grade: null`, `evidence_line_ids: []`, `review_status: pending_human`. Os perfis têm `semantic_profile: null`. Partition `reserved_evaluation` é separada de `development` por hash de ID; **não é um holdout oculto**, pois o manifesto público revela os IDs. Um holdout realmente cego exigiria controle privado/isolado.

## Bloqueios remanescentes

- Revisores humanos ainda precisam ler as letras integrais na fonte autorizada, registrar nota 0–3 e IDs de evidência, além de revisar especialmente os 19 alertas.
- A estrutura de perfis deve receber análises completas, revisadas e associadas aos fingerprints; a presença de linhas na letra não comprova o significado das interpretações.
- Só calcular ganho de Precision@5/nDCG@5/Recall@50 com gabarito pertinente e cobertura adequada, comparando a recuperação atual e a experimental sem exceções por hino.
- Nenhum `versionCode`/APK muda com esta fase de QA. Se a etapa funcional P2 for autorizada após aprovação dos dados, ela precisará preservar E5 ONNX, RRF, EventFrame, Bíblia, GGUF e testes Android.
