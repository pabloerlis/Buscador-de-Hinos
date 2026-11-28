# P2.1 — Recuperação multicritério independente da página

Implementação inicial do contrato de recuperação do RFC docs/contextual-semantic-architecture.md.

- ContextualRetrieval.buildPool é usado pelo MESMO código no Android e testes Node, sem duplicação de algoritmo.
- OfflineAPI.request('/api/contextual/candidates', {query, settings, exclude, require, deprioritize, semantic_hints, vector_query, limit}) executa buscas em todo o catálogo, independente da página da interface. Retorna IDs, metadados e posições por recuperador; NÃO transcreve letras nem afirma relevância verificada.
- Os dez primeiros IDs do ranking basal permanecem protegidos na ordem original dentro do pool. Pesquisa padrão e paginação não mudam; filtros de coletânea, termos excluídos/obrigatórios, hinos não aprendidos, títulos e números exatos preservados.
- Quatro variantes: configurações correntes; busca contextual RRF; literal RRF; balanced legado. Para número/título exato apenas baseline. E5 atual participa quando vetor válido é fornecido, mas sem perfis ou novos vetores.
- O retorno é material NÃO VERIFICADO para uso controlado da IA; não é perfil global aprovado nem reranker P3.
- A verificação da letra integral será realizada pelos endpoints de detalhes e evidências em P3; o endpoint P2 não inclui texto da fonte, evitando vazamento em relatórios.
- Testes sintéticos cobrem paginação, top10, filtros, IDs exatos, ausência de letras, fallback, não alteração do ranking principal.

**Gates futuros antes de ativar reranking:** perfis globais com evidência e SHA de origem, revisão humana P1, Recall@50/P@5/nDCG@5 pareados, letra inteira dos finalistas e latência ARM64.