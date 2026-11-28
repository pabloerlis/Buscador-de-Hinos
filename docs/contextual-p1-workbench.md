# P1 — bancada local de revisão integral

Ferramenta experimental associada às issues #58 e #60. Somente o operador local visualiza letras; o GitHub recebe código, testes sintéticos e os identificadores da fila de revisão sem texto das letras.

## Arquivos necessários

- Catálogo pinado usado no workflow (`catalogo.json`) em ambiente autorizado e local.
- Fila `contextual-review-queue.json` do artifact `contextual-review-p1-qa`.
- Destino recomendado `.tmp/reviews.json` (privado; caminho ignorado pelo Git).

## Comandos — Node 22

```sh
node scripts/contextual_review_workbench.js inspect catalogo.json fila.json .tmp/reviews.json
node scripts/contextual_review_workbench.js label catalogo.json fila.json .tmp/reviews.json
node scripts/contextual_review_workbench.js profile-template catalogo.json fila.json .tmp/reviews.json
node scripts/contextual_review_workbench.js profile-verify catalogo.json fila.json .tmp/reviews.json
node scripts/contextual_review_workbench.js audit catalogo.json fila.json .tmp/reviews.json
```

`inspect` exibe a letra integral por estrofe e linha (`s0:l0`, `s0:l1` etc.) apenas no terminal local. `label` coleta a nota 0–3, justificativa própria, referências e uma declaração explícita de leitura completa. Não preenche registros automaticamente. `profile-template` cria o próximo `.tmp/reviews.json.profile-<id>.json` com campos vazios; o revisor preenche mensagem central, perspectiva, situação, conflito, transformação, resolução, listas de temas, evidências de cada alegação e o resumo/funcão de todas as estrofes. Também preenche `reviewer_alias` e `attested_read_full_lyrics: true`. `profile-verify` verifica esse arquivo e salva apenas dados sem letra. O comando `audit` informa a cobertura da fila.

A revisão exige a MESMA edição usada para gerar a fila: hashes e títulos são comparados. Referências inexistentes, sem evidência, notas fora do intervalo, revisão sem atestação e reprodução literal longa são rejeitadas. O arquivo salvo não é incluído no APK nem nos artefatos de CI.

## Limitações e próximos passos

A assinatura de revisão é uma declaração voluntária e não autentica a identidade do revisor; a validação do schema e de IDs de linha não comprova significado, independência ou correção teológica. Perfis gerados por esse procedimento mantêm `validation: {status: pending, method: none}` até adjudicação independente.

A amostra atual tem 129 tarefas de relevância e 36 candidatos de perfil, extraídos de 1.557 hinos e 22 consultas. **Ainda não existem 129 notas humanas nem 36 perfis validados.** Reunir o gabarito da issue #25 e uma segunda revisão independente antes de calcular ganho de ranking. Não ativar a nova recuperação P2 e não modificar o Android antes disso.
