# 6B4b: ensaio ARM64 físico — protocolo reproduzível

**Estado: NÃO EXECUTADO.** A v2.6.10/code29 já passou 12/12 jobs em x86_64, mas não há evidência de ensaio ARM64 físico. A alteração nesta branch é SOMENTE instrumento de QA: não muda código do app, ranking, corpus, modelo nem versão. O teste sintético do agente 11 não representa aprovação de aparelho.

## Insumos fixos

- APK de produção de QA: [run 44892035791, artifact 14702767432](https://github.com/pabloerlis/Buscador-de-Hinos/actions/runs/44892035791/artifacts/14702767432), extrair app-debug.apk.
- SHA-256 exigido: 329a6195d3582a945a47894cc5e4e432e589bb41ba8bf4bfe785bdd49baa7fed.
- Instrumentação **do mesmo run**: artifact apk-instrumentation-qa, arquivo app-debug-androidTest.apk (retenção curta; se expirou, não substituir sem revalidar par APK/teste).
- Android ARM64 físico com depuração USB e ADB habilitado, conexão autorizada, cópia de segurança dos dados do app. O script não desinstala nem limpa dados; assinatura incompatível deve causar falha segura.

## Comando no computador conectado ao aparelho

    python3 scripts/qa_arm64_physical.py --app /caminho/app-debug.apk --tests /caminho/app-debug-androidTest.apk --out arm64-local-evidence

O script exige exatamente um alvo ADB conectado (ou --serial), SHA do APK, ABI arm64-v8a e ausência de sinais conhecidos de emulação. Instala APK + instrumentation, desliga Wi-Fi/dados móveis, verifica estados, roda E5 ONNX real duas vezes, confere canário de 384 dimensões, registra tempos ponta-a-ponta, cold/warm launch e TOTAL PSS, restaura conectividade previamente ativa. Não executa rollback de instalação, não limpa dados e não grava serial, identificadores exclusivos ou letras. Em caso de falha antes do fim, a etapa **não** é aprovada.

O **agente 11 separado** reabre os logs produzidos e o par APK/teste e rejeita evidência incompleta, divergência SHA, emulador sinalizado, falta de execução offline, falha da instrumentação ou divergência no canário. Seu laudo fica em arm64-local-evidence/independent-agent-11.json. O autoteste do agente 11 (1 positivo + 7 negativos sintéticos) roda automaticamente pelo agente 3, mas NÃO substitui o dispositivo.

## Critérios e limitações

- Aprovação da etapa física: captura **observada** num aparelho real, laudo do agente 11 com decision=approved, comparação das duas inferências e relato de condições de execução. A verificação de dispositivo usa propriedades ADB, não atestação criptográfica.
- Tempos de instrumentation medem ponta-a-ponta (inicialização + UI + ONNX), **não** latência isolada de embeddings. Cold launch via force-stop **não** é instalação limpa nem prova de expiração do cache. Não apagar dados da coletânea sem backup.
- O smoke test não avalia top20 da busca real no aparelho: exige um corpus local importado e instrumentação adicional. Permanece pendente.
- Os 12 alvos semânticos ainda são provisórios; não são 50 julgamentos cegos independentes. Fase de revisão humana e holdout conforme issue #15 permanece pendente.
- Não anexar logs crus contendo informações privadas ao Git. Registrar somente métricas não sensíveis e o resultado final da auditoria, com autorização para compartilhar.

**Próximo passo após coleta física:** registrar evidência real na issue #19 e abrir subtarefa separada para paridade top20 no ARM64 + >=50 intenções independentes, antes de calibrar ranking. Não fazer merge automático nem afirmar v2.6.11 entregue: este commit não gera mudança funcional no APK.
