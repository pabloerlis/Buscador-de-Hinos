# AGENTS.md — verificação obrigatória antes de cada APK

Este projeto utiliza **agentes automatizados do GitHub Actions** (jobs independentes de validação), não agentes de IA que substituem testes.

## Regra obrigatória de conclusão, testes e entrega ao usuário

**Não declarar uma tarefa concluída nem solicitar que o usuário teste uma build não auditada.** Ao terminar **cada subtarefa de implementação**:

1. Criar **um APK distinto e identificável** para aquela funcionalidade, com `versionCode` maior que o da versão anterior e `versionName` coerente; não reutilizar APK anterior como se contivesse a nova alteração. Mudanças somente em documentação/processos podem referenciar o último APK aprovado, identificando-o explicitamente como anterior.
2. Executar **testes funcionais reais e automatizados antes de qualquer declaração de conclusão**, incluindo casos positivos, negativos, regressões, métricas de relevância, E5 (quando presente) e instrumentação na WebView do próprio APK em emulador Android **offline**. O fato de compilar não é teste suficiente.
3. Exigir **sucesso de todos os agentes e do novo agente 8** antes de publicar. O agente 8 deve *testar e analisar independentemente*: reexecutar casos narrativos e RRF, recalcular por caso Recall/nDCG, inspecionar scripts efetivamente embalados, conferir hash/assinatura/versão, rastrear regressões e exigir prova de aprovação da instrumentação Android. Emissão de relatório JSON sem letras. Qualquer falha bloqueia o job `publish_apk`. Nenhum `continue-on-error`, `|| true` nem aprovação inferida apenas do exit code de `adb`.
4. **Entregar no chat ao usuário o novo APK gerado e aprovado**, por link de download real e acessível (não apenas link para PR ou artefato do CI), com versão, `versionCode`, SHA-256, resultado dos testes e limitações. Conferir o hash dos bytes baixados antes de entregar. Se o download falhar ou testes não passarem, declarar **pendente/reprovado**, corrigir e testar novamente: não alegar conclusão nem inventar link.
5. **Registrar a próxima tarefa no GitHub**, antes de encerrar a resposta: issue de continuidade com contexto, base e dependências, PR/branch, SHA, pipeline, métricas antes/depois, casos que pioraram, checklist e próximo primeiro passo. Vincular no PR anterior e fornecer link ao usuário, para a retomada em outro chat.
6. Testes no emulador x86_64 **não equivalem** a testes físicos ARM64; registrar a limitação. Não fazer merge automático.

**Definição de concluído:** código + testes automatizados + instrumentação Android + agente 8 aprovado + auditoria/assinatura + **APK novo entregue ao usuário** + próxima etapa documentada. Um resultado parcial deve ser descrito como parcial, não como finalizado.

### Agente 8 — análise independente (bloqueante)

Job `independent_review`, que depende de `audit_apk`, `device_smoke`, `relevance` e `embeddings`. O script `scripts/qa_independent_review.py` avalia o APK real e os relatórios originais (não apenas seus sinais de sucesso), recalcula métricas e registra pioras por consulta; `publish_apk` só libera a versão se o agente 8 aprovar. Guardar os relatórios `apk-audit.json`, `independent-review.json` e a evidência Android juntamente com o APK aprovado.

## Papéis obrigatórios

1. **Fontes e licenças** — gerar índices bíblicos a partir de fontes pinadas, verificar hashes, atribuição, integridade, 66 livros, 31.102 versículos, narrativas e referências cruzadas.
2. **Código e segurança estática** — checar sintaxe de todos os scripts, HTML sem IDs repetidos, dependências locais, versão Android, tela Sobre e integridade das regras de bloqueio.
3. **Regressões** — executar **todos** os arquivos `tests/test-*.js` com Bíblia/grafo gerados e validados. Nenhum teste pode ser ignorado para permitir o build.
4. **Relevância** — importar a coletânea pública pinada **somente no CI**, executar consultas de histórias e referências, medir Recall@10, Recall@20 e nDCG@5 contra `qa/metrics-baseline.json`. Não treinar sobre os exemplos de avaliação nem codificar exceções para eles.
5. **Auditoria do APK** — **após** o Gradle, confirmar assinatura, AndroidManifest, versionName/versionCode, commit real, desenvolvedor, licença e ausência de modelos e letras da coletânea.

## Ordem e bloqueio

A compilação `build_apk` depende de `sources`, `static`, `regressions`, `relevance` e `embeddings` concluídos com sucesso. `audit_apk` depende de `build_apk` e `device_smoke`. O novo agente `independent_review` depende de `audit_apk`, `device_smoke`, `relevance` e `embeddings`. **Somente `publish_apk`, dependente de `audit_apk` e `independent_review`, publica a versão final.** Nunca adicionar `continue-on-error`, `|| true` para testes, nem remover `needs`.

## Regras para cada funcionalidade futura

- Uma funcionalidade por etapa, com novo `versionCode` crescente, `versionName` identificável e um APK distinto.
- Incluir testes funcionais e casos negativos de contextos análogos; preservar resultados já bons.
- Melhorar **a causa geral**; não criar exceções por hino, história, nome, código ou referência bíblica para fazer um benchmark passar.
- Não colocar letras de hinos no APK. O APK **padrão** permanece sem modelos; a variante E5 desta etapa, compilada com `-PenableLocalEmbeddings=true`, inclui apenas o encoder ONNX int8, vocabulário, vetores e licenças auditados, nunca o GGUF.
- Atualizar métricas e explicar eventuais regressões; aumentar baselines somente após comprovar melhoria em avaliação mais ampla.
- Manter branches/PRs em rascunho até aprovação dos gates, sem merge automático em `main`.

**Diagnóstico manual:** os logs e relatórios JSON dos jobs são a evidência.

### Etapa 6B3 — Estabilidade E5 (v2.6.9/build 28)
- Regerar vetores completos em CADA CI, sem cache entre builds. ONNX CPU com execução sequencial determinística e uma thread, inclusive na aplicação Android.
- O agente 5 verifica novamente 12 consultas em sessões ONNX diferentes e 64 trechos de índice recomputados a partir da fonte pinada, sem registrar letras.
- O manifesto `qa/e5-stability-reference.json` só é travado após medir uma execução diagnóstica e confirmar a mesma assinatura em outra execução com índice reconstruído. `pending` é falha bloqueante.
- Agente 9 recalcula hashes dos arquivos E5 de entrega e da avaliação e exige identidade com a referência travada; agente 8 verifica os laudos. Alteração entre builds REPROVA antes do Gradle.
- Não ajustar ranking para casos de teste; divergência de hashes se investiga, não se mascara. Um APK somente após 9 agentes e Android offline aprovar; ainda falta teste físico ARM64.
 Aprovação do pipeline não equivale a validação semântica exaustiva.

## Etapa 2 — embeddings semânticos E5 por trechos

- Variante **v2.6.2 (build 21)**; E5 multilíngue int8, 384 dimensões, pesos pinados por SHA256.
- Indexar até oito janelas por hino, distribuídas entre início, meio e fim, com linhas de evidência reconstruídas **apenas no telefone** a partir das letras importadas.
- A consulta gera o próprio vetor offline via ONNX Runtime Android. Uma consulta sem modelo continua com resultado lexical imediato; falhas do E5 não bloqueiam a busca.
- O quinto agente de **pré-build** passa a validar SHA do modelo, procedência do índice, presença dos trechos e recuperação sobre várias histórias; o agente de **pós-build** verifica modelo, vocabulário e bibliotecas no APK específico.
- O benchmark de recuperação vetorial isolada não substitui o teste híbrido nem prova desempenho global; manter relatórios de relevância e casos negativos.

## Teste de execução obrigatória (v2.6.2+)

Além de testes unitários, **o próprio APK candidato** é instalado no emulador Android x86_64 com as conexões sem fio desabilitadas. Um teste instrumentado abre a WebView real, verifica a tela Sobre e exige que `NativeVector.embed` execute o ONNX Runtime e devolva um vetor 384D finito e normalizado. A auditoria/públicação do APK depende da aprovação desse teste.

O tokenizer Java de produção deve produzir os **mesmos IDs** de ao menos 20 consultas do tokenizer original do modelo Python, incluindo acentos, referências e pontuação, antes do build. A integração JS também deve testar importação, indexação, trecho recuperado, desligamento E5, número exato e repertório não aprendido.

Nota: o emulador testa o APK x86_64; dispositivos reais arm64-v8a podem apresentar desempenho diferente. Um teste automatizado não substitui ensaio manual em aparelhos-alvo.

## Etapa 3 — fusão híbrida RRF v2.6.3

- Novo motor independente `rrf-fusion.js`, com `k=60` e listas de ranking lexical, semântico, bíblico, narrativo e E5.
- Não codificar exceções para referências, nomes de histórias ou números de hinos.
- O RRF opera **somente quando há consulta E5 válida**; modo literal/número/título exato continuam prioritários. `fusionMode=legacy` deve permitir auditoria comparativa sem modificar a funcionalidade anterior.
- Testes obrigatórios: `tests/test-rrf-fusion.js`, `tests/test-e5-api-integration.js`, `tests/qa_e5_hybrid.js` com avaliações separadas `baseline` (sem E5), `additive` (E5 anterior) e `rrf`.
- Reprovar se o RRF perder mais de um resultado no top20 ou reduzir nDCG@5 mais do que 0,025 no conjunto comparativo; avaliar em mais consultas antes de interpretar variações como melhorias comprovadas.
- Executar a versão 2.6.3 **no emulador Android sem rede**, confirmar que o script RRF e a opção de configurações carregam e que `NativeVector.embed` retorna vetor normalizado. Auditar o APK assinado.

## Etapa 4 — acontecimentos, atores e sequência (v2.6.4)

- O motor `event-frame-engine.js` deve usar um dicionário de ações genérico para **todas** as histórias. Proibido pontuar hinos pelo número ou criar exceções para personagens, histórias ou referências individuais.
- Não confundir mera semelhança temática com narrativa: exigir múltiplas ações, ordem de ocorrência e evidência de personagem/cenário **dentro de um trecho da letra**, com citações textuais autênticas da letra importada.
- Separar analogia em primeira pessoa de descrição direta do episódio e não promover frases negadas como acontecimento ocorrido.
- Preservar `eventEvidence:false` para auditoria pareada com o motor desligado; defaults ativados só em busca contextual e narrativa. Até obter avaliação humana maior, preservar o conjunto dos dez hinos conhecidos no topo de cada pesquisa narrativa, permitindo apenas reordenação interna e melhorias além dessa faixa.
- O CI deve executar `tests/test-event-frames.js` e `tests/qa_event_ranking.js`, comparando Recall@10/20 e nDCG@5 em consultas reais, incluindo narrativas e referências. Os resultados devem ser registrados sem letras.
- Dispositivo: inspecionar `EventFrameEngine` e controle `event-toggle` dentro da WebView Android offline e executar classificação de texto sintético antes da auditoria e publicação do APK.

## Etapa 5 — consolidação por benchmark de variantes (v2.6.5)

- Somente a implementação A `EventFrameEngine` é mantida. A variante B `EventAlignment` demonstrou nDCG@5 menor e falso positivo sintético com ações negadas; **não** juntar sinais de ambas e não aumentar bônus narrativo sem evidência.
- Executar `tests/qa_event_variant_matrix.js` no job `embeddings`, após gerar o mesmo E5 de consulta e índices bíblicos, com o catálogo público pinado e três árvores fixadas por commit. Quatro condições: RRF original, A desligado, A ligado, B ligado.
- Exigir A desligado idêntico ao RRF; A ligado não piorar Recall@10, não reduzir nDCG@5 em mais de 0,04 e não ser inferior à B nessa amostra; reportar Recall@20, falsos positivos e posições por consulta.
- Manter a cobertura de negação e sequência dos testes de `EventFrameEngine`; a avaliação atual não prova extração correta de papéis sintáticos, sujeito/objeto nem generalização a narrativas não rotuladas. Estender rótulos antes de alterar pesos.
- Não considerar nDCG/latência de runner x86_64 suficientes para decisão de desempenho em dispositivos ARM64. Usar o teste instrumentado no emulador como gate e documentar limitação física.
- APK versionado 2.6.5/code24 somente após pré-build, build, Android offline e auditoria final. Próxima etapa sempre registrada em issue do GitHub.

## Etapa 6A — 50 consultas e auditoria independente (v2.6.6)

- Preservar os oito agentes da PR #11 e a publicação condicionada ao agente 8.
- Rodar `tests/qa_relevance_50.js` no agente E5 com os mesmos vetores e índices das condições RRF e eventos A; salvar `qa-report/relevance-50.json`.
- Recalcular no agente 8 todas as métricas, por consulta e categoria, e garantir correspondência integral dos 14 casos anteriores.
- **Diferenciar 26 casos semânticos/bíblicos de 24 controles de número/título.** Os 12 novos rótulos de paráfrases são provisórios e exigem revisão humana antes de treino ou ajuste de pesos. Os casos do mesmo relato não são independentes.
- Os relatórios não podem incluir letras, e nenhum caso de teste pode determinar regra especial para uma história ou hino.
- Sem reranker em produção até avaliação fora do APK, orçamento de memória, licença e teste ARM64.
- Uma versão nova só pode ser declarada concluída quando CI, instrumentação e auditoria do APK v2.6.6/code25 aprovarem, o arquivo entregue tiver SHA verificado e a próxima issue estiver documentada.

## Etapa 6B1 — paridade E5 real nas 12 paráfrases (v2.6.7/code26)

- Vetorizar as 12 novas consultas no CI com o mesmo ONNX int8 e tokenizer pinados do APK; validar hash, forma 384D, norma e correspondência exata de consulta.
- Rodar RRF e EventFrameEngine com vetores E5 idênticos, preservando a matriz legada de 14 consultas e reportando métricas separadas.
- O agente 8 deve bloquear a entrega quando faltar qualquer um dos 12 vetores ou se relatórios declararem cobertura inexistente.
- Não alterar pesos, regras de ranking ou rótulos provisórios por conta desses resultados: revisão humana das letras e ampliação para 50 julgamentos semânticos independentes são uma próxima etapa.
- Novo APK apenas para cumprir ciclo de QA/versão; motor de pesquisa permanece o da v2.6.6. PR draft, sem merge em main, sem teste ARM64 físico.

## Agente 9 — testes independentes da busca semântica (2.6.8/build 27)

- Job obrigatório `semantic_search_qa` antes do build Android, adicional ao agente 8.
- Executa de verdade o `OfflineAPI` no catálogo temporário licenciado com 12 consultas vetorizadas pelo E5 ONNX pinado, em condições E5 ligado/desligado. Recalcula Recall@10/20, nDCG@5 e MRR@20 por alvo, confere os resultados com benchmark separado.
- Bloqueia APK diante de vetores inválidos, perda de recuperação versus E5 desligado, ausência de ganhos individuais, divergências por consulta, falsos positivos top10 e perda de número exato.
- Verifica com testes sintéticos a recuperação por evidência, fallback, repertório, negação narrativa e RRF. Armazena apenas consultas e posições no laudo `qa-report/semantic-search-agent.json`; nenhuma letra.
- Agente 8 reaudita a saída do agente 9 antes da publicação. Os 12 alvos são PROVISÓRIOS, sem juízo humano; aprovação técnica não implica semântica perfeita.
- Etapa exclusiva de QA. Ranking de produção permanece idêntico à v2.6.7. Necessário APK novo, testes Android offline, assinatura, SHA e entrega, além de próxima issue. PR draft.
