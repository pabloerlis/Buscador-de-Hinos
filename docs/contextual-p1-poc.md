# P0/P1 — Perfil semântico integral: prova de conceito isolada

**Estado:** módulo experimental fora da aplicação Android. Direção da issue #58 e do RFC contextual. Não substitui a busca existente.

## Incluído

- scripts/semantic_profile_poc.js: anotação estruturada sobre a letra integral, hash SHA-256 de origem e letra, referências por estrofe/linha, rejeição de fontes alteradas, checks de cobertura e cópias longas da letra, texto preparado para uma futura indexação E5.
- tests/test-semantic-profile.js: testes com documento administrativo inventado, sem letras de hinos reais, cobrindo negação, desfecho, referências inexistentes, edição alterada, falta de estrofe e alegações de validação sem prova.
- qa/contextual-p0-baseline.json: snapshot processual, métricas de P1 ainda nulas.

## Escopo e limites

O criador aceita análise anotada externamente; NÃO infere sozinho a mensagem central. A análise inclui perspectiva, abertura, conflito, transformação, resolução, temas, menções incidentais, eventos negados e paralelos bíblicos explícitos/inferidos. As referências s0:l0 usam base zero; cada estrofe exige uma referência real daquela estrofe.

A validação estrutural não comprova correção teológica/semântica. Todo perfil mantém validation.status=pending e method=none, mesmo após validar hashes. Não aceitar perfis ausentes ou com fingerprint divergente. Nenhum perfil é enviado ao APK nesta etapa. Nenhuma letra real é copiada aos artefatos.

## Testar

Rodar: node tests/test-semantic-profile.js. O CI já executa automaticamente tests/test-*.js. Esta entrega modifica apenas experimentos/QA; por isso não altera versionCode nem anuncia APK com funcionalidade nova.

## Critério restante de P1

Revisar independentemente 19 alertas e rotular letras reais completas com humanos conforme issue #25, incluindo candidatos fora do top10; definir holdout; anotar amostra diversa de perfis licenciados; confrontar perfil e recuperação atual nos mesmos julgamentos, medindo Recall@50, Precision@5, nDCG@5 e falsos positivos. Nenhuma métrica real é alegada enquanto faltam rótulos humanos.

Após P1 validado, P2 investigará embeddings E5 dos perfis e recuperação independente da página; qualquer função Android exige novo APK auditado, com E5+GGUF ARM64 preservados. Sem merge automático.
