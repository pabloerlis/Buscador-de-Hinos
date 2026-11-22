# APK de testes independente — 2.6.15 (build 34)

Este build `-PqaSidecar=true` usa applicationId `br.com.buscadordehinos.app.qa`, enquanto o app normal preserva `br.com.buscadordehinos.app`. Isso permite instalação lado a lado mesmo quando o certificado Debug muda a cada execução do CI. O rótulo da versão de testes é **Buscador de Hinos QA**.

- Nenhum dado é transferido automaticamente da instalação original. Os dois apps usam armazenamento privado distinto.
- Não remover/desinstalar a instalação existente; nem este mecanismo substitui o trabalho de assinatura persistente/backup da issue #35.
- Para build local da variante QA: `gradle assembleDebug assembleDebugAndroidTest -PenableLocalEmbeddings=true -PenableLocalModels=true -PqaSidecar=true -PoptimizeGgufNative=true`.
- O CI instala e audita o mesmo APK `.qa`, testa E5 e GGUF LFM3 oficial sem rede, compara baseline e otimização e exige Agente 8 antes de publicar.
- O mesmo projeto com `qaSidecar=false` mantém o applicationId original. Não fazer merge automático.

## Bloqueio de entrega

Exigir package id `.app.qa`, certificado Android válido, versionCode 34, hash SHA256, E5, motor GGUF, todos agentes, Android offline, QA real e relatório independente. Teste físico ARM64 será realizado pelo usuário e ainda não está comprovado no CI.

## Piloto ARM64 KleidiAI 2.6.16/build35
- APK de teste independente: `br.com.buscadordehinos.app.qa.arm64`, rótulo **Buscador de Hinos ARM64 QA**; não substitui o app original nem a versão QA 2.6.15.
- Build opt-in: `-PqaSidecar=true -PqaArm64Pilot=true -PenableKleidiAI=true`.
- KleidiAI ativa **somente** em arm64-v8a. x86_64 mantém caminho anterior; o CI audita CMakeCache, arquivos realmente compilados e flags, sem exigir DOTPROD/I8MM globalmente.
- A aprovação do emulador x86_64 **não comprova aceleração ARM64**: medir tempo de primeira resposta, prefill, tokens/s, RAM e aquecimento no smartphone antes de declarar ganho.
- O GGUF não faz parte do APK; assinatura Debug muda entre runs. Não desinstalar instalações com dados.
