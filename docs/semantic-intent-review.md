# Etapa 6B4c — Painel de 50 intenções semânticas para julgamento cego

## Propósito e limites
- 50 **consultas editoriais distintas**, não 50 julgamentos concluídos.
- 25 acontecimentos bíblicos diferentes e 25 intenções temáticas; 30 para desenvolvimento e 20 mantidas como holdout. Nenhum controle de título/número entra no denominador.
- **0 julgamentos humanos disponíveis** até revisão posterior. Não publicar Recall/nDCG/MRR sobre estas 50 sem rótulos independentes. As 12 paráfrases antigas continuam provisórias e sob o agente 10.
- Nenhum ajuste de ranking, modelo, dados dos hinos ou letras. v2.6.11/code30 é marco do pacote de QA e da próxima entrega do APK; a busca permanece igual à v2.6.10.

## Processo
1. Agente 5 gera **50 embeddings ONNX UINT8 reais** com modelo/revisão pinados, apenas em CI; arquivo `qa-report/intent50-vectors.json` não entra no APK.
2. Agente 12 chama o `OfflineAPI` real em 50 consultas com E5 desligado/ligado, recolhendo o top20 de ambas as variantes. A união deduplicada contém até 40 candidatos; qualquer variante pode retornar menos de 20 ou até zero. Quantidades observadas ficam no relatório, sem criar resultados artificiais.
3. O arquivo `intent50-blind-packet.json` apresenta consulta, títulos, coleção/número e identificador cego em **ordem embaralhada**, sem score, posição ou origem da variante. O arquivo **separado** `intent50-sealed-ranking.json` guarda a ordem das duas variantes para comparação só após o julgamento.
4. Agente 12 recusa vazamento de scores, ausência de qualquer consulta/vetor ou alteração de identidade; o autoteste com 1 positivo + 10 negativos é executado pelo agente 3.
5. Agente 8 reabre os artefatos e, em **outra implementação Python**, confere os conjuntos de candidatos/top20 e proveniência. Falhas impedem entrega do APK.

## Julgamento humano posterior (ainda pendente)
- Disponibilizar ao avaliador apenas o pacote cego e acesso legal às letras importadas *localmente*. O pacote mostra título/coleção/número, mas **nunca copia letras** no GitHub.
- Para cada candidato, registrar `relevant`, `partially_relevant`, `not_relevant` ou `unknown`, evidência sem reproduzir letra e identificador do avaliador. A avaliação deve ser independente do mecanismo e de sua posição; o holdout permanece sem exposição do ranking.
- Dois avaliadores independentes e adjudicação para discordâncias são desejáveis. Até existir avaliação real, não alterar `human_review_status` nem atribuir ganho à IA. Após fechamento dos rótulos, calcular métricas por categoria e analisar diferenças pareadas no holdout antes de mudar o ranking.
- Testes físicos do APK são feitos pelo usuário instalando-o em seu Android. Emulador CI não equivale a teste físico.

## Continuação no próximo chat
1. Exigir CI completo (agentes 1–12, auditoria independente 8, Android offline), baixar APK 2.6.11, conferir SHA, assinatura e entregar diretamente ao usuário.
2. Se o CI falhar, corrigir na mesma PR até todos os testes passarem. Não fechar apenas pelo autoteste do agente 12.
3. Separar uma nova issue para revisão cega humana do top20; não fingir relevância a partir de títulos ou proximidade vetorial. Só então abrir experimento de reranker sem vazamento de holdout.
4. PR draft, sem merge automático.
