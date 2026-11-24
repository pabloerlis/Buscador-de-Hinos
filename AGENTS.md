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

## Assinatura e atualização dos APKs distribuídos

Por solicitação expressa do responsável pelo projeto, em 24/11/2026, a correspondência com o certificado anterior deixa de bloquear a entrega da linha de testes. A assinatura criptográfica válida continua obrigatória.

- Manter o applicationId e incrementar o versionCode. Verificar o APK com apksigner verify --print-certs e registrar o SHA-256 do certificado, a integridade e a proveniência.
- A divergência do certificado da versão 2.6.1-agentes-QA é um aviso, não uma falha. Não prometer atualização direta nem preservação dos dados sem teste de instalação.
- APKs auditados da linha de testes podem ser distribuídos com chave de depuração. Não publicar chaves privadas. A distribuição estável com atualização automática deverá adotar keystore persistente, quando solicitada.
- Preservar todos os demais gates de qualidade, incluindo verificação de assinatura válida.

## Regras para cada funcionalidade futura

- Uma funcionalidade por etapa, com novo `versionCode` crescente, `versionName` identificável e um APK distinto.
- Incluir testes funcionais e casos negativos de contextos análogos; preservar resultados já bons.
- Melhorar **a causa geral**; não criar exceções por hino, história, nome, código ou referência bíblica para fazer um benchmark passar.
- Não colocar letras de hinos nem modelos opcionais de IA no APK padrão.
- Atualizar métricas e explicar eventuais regressões; aumentar baselines somente após comprovar melhoria em avaliação mais ampla.
- Manter branches/PRs em rascunho até aprovação dos gates, sem merge automático em `main`.

**Diagnóstico manual:** os logs e relatórios JSON dos jobs são a evidência. Aprovação do pipeline não equivale a validação semântica exaustiva.

## Backlog de produto

Consultar `docs/roadmap.md` ao planejar próximas versões. Funcionalidades registradas ali não devem ser tratadas como implementadas. A inclusão manual e por arquivo de novas letras, com indexação incremental local, é requisito futuro solicitado pelo responsável em 24/11/2026.

O runtime ONNX ARM64 e o código do tokenizer (licença Apache-2.0) podem integrar o APK para executar o pacote externo Harrier. Pesos, dados externos ONNX, vocabulário do modelo e índice vetorial continuam proibidos no APK padrão. Fixtures sintéticas de conformidade são permitidas; não incluem letras da coletânea.
