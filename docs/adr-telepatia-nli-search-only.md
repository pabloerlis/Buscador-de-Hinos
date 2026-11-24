# ADR 2026-11-23 — Buscador sem conversa com Telepatia Laya NLI

**Decisão confirmada pelo responsável do produto:** abandonar temporariamente o LFM3/GGUF. Adotar **`telepatia-ai/laya-pt-es-nli`** como único modelo classificador contextual nesta linha de desenvolvimento. O E5 Small permanece **recuperador** semântico e o índice lexical/narrativo existente permanece disponível. **Não substituir o Telepatia por Laya Multilingual genérico**, mesmo que exista conversão ONNX deste último.

## Fluxo obrigatório
1. Usuário escreve contexto/versículo/tema sem diálogo.
2. E5 + índice lexical + Bíblia recuperam top-K candidatos.
3. Telepatia NLI **externo ao APK** avalia hipóteses de mensagem principal e de desfecho contra a letra completa ou janelas controladas, retornando entailment / neutral / contradiction com evidências.
4. Os resultados são armazenados com chaves de cache: SHA da letra e da hipótese, hash do arquivo do modelo, tokenização, versão do classificador e contexto.
5. Sliders reponderam pontuações e evidências **em memória** sem executar o modelo novamente; ao alterar a consulta, invalidar caches afetados e inferir novamente.
6. Histórico permanece local e é apagável.

## Critérios de integridade
- **Sem conversa e sem LFM3/GGUF no APK destinado ao usuário.** Código legado pode permanecer no repositório apenas para compatibilidade enquanto migra; o build final não pode compilar/empacotar a biblioteca nativa do GGUF.
- **Nenhum checkpoint dentro do APK:** seleção por SAF de modelo ONNX e tokenizer externos, SHA256 e licença manifestados; a ausência/incompatibilidade do modelo gera estado explícito, nunca pontuação simulada.
- Não chamar heurísticas E5, eventos ou palavras de 'NLI' ou 'desfecho comprovado'. Exibir claramente o que foi medido.
- A documentação pública do checkpoint Telepatia contém pesos Safetensors e arquivos de tokenizer. A exportação completa encoder + cabeça de decisão para ONNX, tokenização e paridade PyTorch–ONNX/Android **ainda precisam ser comprovadas**.
- Resultados prévios: em 31 casos, Telepatia NLI central 25/31 com 1 FP e 5 FN. O hino 264 foi corretamente rejeitado, mas houve falsos negativos. Portanto, **não usar filtro NLI eliminatório** antes da validação humana.
- Paridade Android offline + benchmark ARM64, auditoria de pesos, 100+ casos reais revisados, zero hardcodes de hino, sem letras no repositório/APK, SHA do APK e 8+ agentes independentes são obrigatórios para release.

## Estado da branch `feat/semantic-sliders-live-20261123`
**Parcial.** Os controles e o reordenador de sinais existentes estão escritos. Os sliders **ainda não** executam NLI. O workflow Android histórico ainda testa e exige GGUF; ele não deve ser considerado critério de aprovação do APK **Telepatia** até ser migrado para NLI com auditoria correspondente. Não gerar/entregar APK como se o NLI estivesse integrado. Próxima etapa descrita na issue #63 e PR draft #64.
