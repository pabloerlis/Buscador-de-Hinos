# P2 shadow — recuperação ampla sem alterar a aplicação

Protótipo incremental sobre a PR #59, vinculado às issues #58 e #60. **Não é a implementação P2 aprovada**: mede apenas cobertura de candidatos. A ausência de julgamento humano da P1 continua bloqueando qualquer reranking funcional.

## Objetivo

O chat atual só pode comparar candidatos da página mostrada (até cinco). `scripts/contextual_wide_pool.js` cria, em ambiente de QA, um conjunto de até 60 IDs oriundos de quatro ordenações do motor real: padrão (balanced + RRF), contextual, literal e balanced + fusão legada. A geração consulta a lista integral de posições do próprio OfflineAPI, e não o array da interface. A distribuição usa round-robin após proteger, na mesma ordem, os dez primeiros candidatos do ranking padrão.

Cada candidato tem ID, origem, posição em cada ranking e flags de estar fora da página visível, fora dos dez primeiros e fora **de qualquer posição** do ranking baseline. Os últimos são candidatos novos de fato, não simplesmente elementos ocultos pela paginação. A separação protege o ranking atual; nenhuma sugestão é automaticamente promovida por estar em um pool.

## QA com a mesma fonte fixada

Executar no workflow após a auditoria das 1.557 letras e 22 consultas:

```sh
node scripts/qa_contextual_wide_pool.js .tmp/catalog-2018.json reports/validation/resultado-agentes.json qa-report/contextual-wide-pool.json
```

O relatório inclui somente consultas, IDs e posições. O job bloqueia caso os hashes das fontes e o número importado divirjam. O arquivo não é incluído no aplicativo. Nenhuma letra, snippet ou conclusão de relevância é exportada. A prova usa `vectorMode: off`: não executa ONNX no Node; não afirmar que a união E5 esteja sendo testada.

## Limitações

- Aumento de cobertura aparente não é aumento de Recall@50. Sem gabarito completo para os candidatos que entraram, a relevância continua desconhecida.
- Consultas podem gerar um pool maior de coincidências lexicais; a vantagem hipotética é permitir reclassificação futura por significado integral, não melhorar automaticamente as recomendações.
- Testes adversariais garantem imutabilidade do top10 padrão, não aprendidos excluídos, fallback sem outras fontes, limite de 60, fontes e posições reproduzíveis e nenhuma anotação humana fabricada.
- Antes de integrar ao Android, obter o gabarito humano da P1, aferir Recall@50 pareado e custos reais de execução em ARM64. Depois medir E5-global e reranking do desfecho contra o mesmo baseline. Nenhum APK novo é associado a este experimento isolado.
