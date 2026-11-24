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

- Manter o mesmo `applicationId` e assinar os APKs distribuídos com a mesma chave e o mesmo certificado entre versões. Incrementar o `versionCode` a cada entrega. Usar um keystore persistente e protegido, com backup e acesso via segredos do CI. Proibir a publicação de APKs assinados por uma chave de depuração gerada pelo runner.
- Antes da primeira entrega que implementar esta regra, verificar se a chave privada correspondente ao APK de referência está disponível. Para a 2.6.1-agentes-QA original (build 20), o SHA-256 do certificado é `cf07bce9b5f581a50beb7817e390d0393b46cc2dc771bf54df4cc03537c0c511`. Se a chave estiver indisponível, registrar que a atualização direta a partir desse APK é inviável, definir a migração para uma chave persistente e informar o usuário antes da entrega.
- No CI, verificar a assinatura com `apksigner verify --print-certs`, comparar o SHA-256 do certificado com o da versão de referência da mesma linha de distribuição e bloquear a publicação em caso de divergência. Manter a impressão digital pública versionada e a chave privada fora do repositório.
- Antes de publicar, instalar o APK anterior e atualizar com o candidato via `adb install -r`. Confirmar a nova versão e a preservação dos dados do aplicativo, incluindo a coletânea importada e as marcações do repertório.

## Regras para cada funcionalidade futura

- Uma funcionalidade por etapa, com novo `versionCode` crescente, `versionName` identificável e um APK distinto.
- Incluir testes funcionais e casos negativos de contextos análogos; preservar resultados já bons.
- Melhorar **a causa geral**; não criar exceções por hino, história, nome, código ou referência bíblica para fazer um benchmark passar.
- Não colocar letras de hinos nem modelos opcionais de IA no APK padrão.
- Atualizar métricas e explicar eventuais regressões; aumentar baselines somente após comprovar melhoria em avaliação mais ampla.
- Manter branches/PRs em rascunho até aprovação dos gates, sem merge automático em `main`.

**Diagnóstico manual:** os logs e relatórios JSON dos jobs são a evidência. Aprovação do pipeline não equivale a validação semântica exaustiva.
