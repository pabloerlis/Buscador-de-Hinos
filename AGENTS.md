# AGENTS.md — verificação obrigatória antes de cada APK

Este projeto utiliza **agentes automatizados do GitHub Actions** (jobs independentes de validação), não agentes de IA que substituem testes.

## Papéis obrigatórios

1. **Fontes e licenças** — gerar índices bíblicos a partir de fontes pinadas, verificar hashes, atribuição, integridade, 66 livros, 31.102 versículos, narrativas e referências cruzadas.
2. **Código e segurança estática** — checar sintaxe de todos os scripts, HTML sem IDs repetidos, dependências locais, versão Android, tela Sobre e integridade das regras de bloqueio.
3. **Regressões** — executar **todos** os arquivos `tests/test-*.js` com Bíblia/grafo gerados e validados. Nenhum teste pode ser ignorado para permitir o build.
4. **Relevância** — importar a coletânea pública pinada **somente no CI**, executar consultas de histórias e referências, medir Recall@10, Recall@20 e nDCG@5 contra `qa/metrics-baseline.json`. Não treinar sobre os exemplos de avaliação nem codificar exceções para eles.
5. **Auditoria do APK** — **após** o Gradle, confirmar assinatura, AndroidManifest, versionName/versionCode, commit real, desenvolvedor, licença e ausência de modelos e letras da coletânea.

## Ordem e bloqueio

A compilação `build_apk` depende de `sources`, `static`, `regressions` e `relevance` concluídos com sucesso. O artefato **aprovado** só existe se `audit_apk` também passar. Nunca adicionar `continue-on-error`, `|| true` para testes, nem remover `needs`.

## Regras para cada funcionalidade futura

- Uma funcionalidade por etapa, com novo `versionCode` crescente, `versionName` identificável e um APK distinto.
- Incluir testes funcionais e casos negativos de contextos análogos; preservar resultados já bons.
- Melhorar **a causa geral**; não criar exceções por hino, história, nome, código ou referência bíblica para fazer um benchmark passar.
- Não colocar letras de hinos no APK. O APK **padrão** permanece sem modelos; a variante E5 desta etapa, compilada com `-PenableLocalEmbeddings=true`, inclui apenas o encoder ONNX int8, vocabulário, vetores e licenças auditados, nunca o GGUF.
- Atualizar métricas e explicar eventuais regressões; aumentar baselines somente após comprovar melhoria em avaliação mais ampla.
- Manter branches/PRs em rascunho até aprovação dos gates, sem merge automático em `main`.

**Diagnóstico manual:** os logs e relatórios JSON dos jobs são a evidência. Aprovação do pipeline não equivale a validação semântica exaustiva.

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
