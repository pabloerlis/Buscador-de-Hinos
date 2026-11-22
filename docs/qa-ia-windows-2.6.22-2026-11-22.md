# Validação da IA no Windows · Buscador de Hinos 2.6.22

**Data** 22/11/2026  
**Conclusão** O LFM3 carrega e gera respostas localmente. A curadoria conversacional apresenta falhas de seleção e de aplicação de preferências. A instalação e a execução do APK no Android deste PC ficaram pendentes.

## Versão avaliada

| Item | Identificação |
| --- | --- |
| APK funcional com chat | 2.6.22, build 41, `br.com.buscadordehinos.app`, variante Debug |
| Código de origem | PR #43, commit `6b90b22bbc6de78d4c3b046b673086f5678675cd` |
| APK | 193.984.314 bytes, SHA-256 `1a3b046bc00e894d80078b0d69a2d26423d5de3d3455b762487a6e6ac330ebf0` |
| GGUF executado no PC | LFM3-1.7B-QAD-Q4_0, SHA-256 `43a7d09a0e9cba91b63eb7052488b9564569bddfd65754d2e426465e572a7452` |
| PC | Windows build 26200, Intel Core i9-9900K, Node 24.22.0, Java 21 |

O piloto KleidiAI 2.6.16/build 35 foi auditado para identificar a linha de desenvolvimento. Pertence ao PR #46, usa `br.com.buscadordehinos.app.qa.arm64` e possui um binário JNI distinto da 2.6.22. A campanha de chat usa a 2.6.22. [PR #43](https://github.com/pabloerlis/Buscador-de-Hinos/pull/43) · [PR #46](https://github.com/pabloerlis/Buscador-de-Hinos/pull/46)

## O que foi executado neste PC

| Validação | Resultado e alcance |
| --- | --- |
| APK | SHA do arquivo igual ao artefato aprovado, CRC do ZIP, manifest binário e SHA do commit dentro do DEX verificados. A assinatura APK v2 passou na verificação RSA PKCS#1/SHA-256 e no digest dos 187 blocos. O controle com um byte alterado foi rejeitado. Android mínimo 24, alvo 34. |
| Assets de produção | `app.js`, `offline-api.js` e `local-hymn-ai.js` extraídos do APK. O blob Git do `app.js` (`4c702dd1476a76182a1a326ac77a080471347928`) coincide com o do commit. A cópia de trabalho usada por dois testes auxiliares contém uma revisão anterior de `app.js`, que difere no tratamento de hino retirado fora da página e na filtragem das alternativas. |
| Chat e busca | 16 verificações automatizadas em Node, com JavaScript do APK, catálogo sintético e respostas controladas para a ponte NativeGGUF. Cinco controles passaram e 11 comportamentos indesejados foram reproduzidos. |
| Chat com modelo real | Oito turnos passaram pelo código JS de produção e pelo catálogo sintético via Node. Sete chamaram o JNI Windows para inferência real e um foi resolvido pelo catálogo. Quatro turnos cumpriram o objetivo por completo. Seis entradas adicionais passaram diretamente pelo gerador de prompts e pelo validador do APK. |
| Relevância e arquivos | Seis suítes Node passaram sobre os assets extraídos (integração E5, estrofes E5, RRF, eventos, narrativas e tela Sobre). Quatro de quatro narrativas sintéticas ficaram em primeiro lugar. Verificação de sintaxe em 15 scripts. O autoteste do auditor ARM64 passou com uma fixture positiva e sete negativas. Duas suítes auxiliares da cópia de trabalho passaram (`test-gguf.js` e `test-offline.js`). |
| Motor nativo | O C++ exato do commit (blob `cb60739f20298dbc18fe130cc38d3ec34229b119`) foi recompilado como JNI Windows. Executou em CPU com o runtime local llama.cpp b11960 e o GGUF oficial. O build Android usa b12088. Foram rodados casos de geração, gestão do tempo e retomada. |
| Android neste PC | O SDK continha Platform-Tools 37.0.1. O ADB falhou em `fdevent_poll.cpp:62` ao criar o socketpair, e o SDK Manager não conseguiu baixar o emulador nem a imagem API 35 x86_64 devido à falha de acesso aos manifests de `dl.google.com`. WSL também retornou acesso negado. A ponte Java Android, a WebView Android, o seletor de arquivos e o encoder ONNX em execução ficaram fora da validação local. |

Os cinco controles do chat cobriram contexto da pergunta, inclusão após desambiguação por coletânea, exclusão de um hino fora da página com bloqueio de reintrodução, rejeição de posição inválida e de retorno atrasado após cancelamento, e filtro lexical sem GGUF. O catálogo sintético foi usado nos testes locais de busca. A consulta remota ao catálogo de avaliação também ficou indisponível no PC. O APK contém JNI LFM3 e ONNX para `arm64-v8a` e `x86_64`, com encoder E5 e 10.496 vetores de 384 dimensões com hashes esperados. Os pesos GGUF são fornecidos à parte.

## LFM3 real no Windows

O modelo carregou em 341–347 ms nas execuções registradas. A reprodução das quatro entradas de referência retornou as ações esperadas.

| Entrada de referência | Ação do modelo | Geração |
| --- | --- | ---: |
| Dúvida sobre preferência | `["perguntar","ritmo"]` | 2.885 ms |
| Retirada confirmada | `["retirar",1]` | 1.084 ms |
| Inclusão confirmada | `["acrescentar",2]` | 1.330 ms |
| Retirada contextual | `["retirar",1]` | 1.046 ms |

A primeira gramática fixa a ação `perguntar`. A segunda e a terceira fixam ação e posição. A quarta permite ao LFM3 decidir entre perguntar e retirar e escolher a posição. Os tempos correspondem a esta CPU e a esse runtime. A abertura inicial usou um GGUF disponível no armazenamento local.

### Conversa com o JavaScript do APK e o modelo real

O Node executou o controlador do chat, a busca offline e a montagem do prompt. A ponte de teste encaminhou o pedido ao JNI Windows e devolveu a resposta ao callback de produção. A interface e o IndexedDB foram representados em memória. O histórico foi mantido nos pares 01–02 e 07–08. A lista inicial do catálogo sintético continha Consolo e Paz, Louvor alegre, Esperança, Chegada ao céu e Retorno e arrependimento.

| Turno | Pedido | Resposta e efeito observado | Geração |
| --- | --- | --- | ---: |
| 01 | Estou em dúvida sobre o estilo. | **Passou.** Perguntou se o usuário prefere hinos alegres ou solenes. | 6.824 ms |
| 02 | Mais alegres, com foco no retorno e arrependimento. | **Falhou.** Destacou a primeira posição, Consolo e Paz, sem aplicar a preferência solicitada. | 2.032 ms |
| 03 | Retire o hino sobre chegada ao céu. | **Falhou.** Perguntou sobre clima e manteve Chegada ao céu. | 1.896 ms |
| 04 | Retire o hino sobre o sangue do cordeiro. | **Falhou no esclarecimento.** Preservou a lista e perguntou sobre clima. O alvo ausente exigia pergunta sobre o hino. | 1.886 ms |
| 05 | Não retire nenhum hino. Só me explique a lista. | **Parcial.** Preservou a lista, mas exibiu texto de aspecto interno iniciado por `buscar:Consolo;`. A explicação não foi entregue. | 3.672 ms |
| 06 | Somente hinos de alegria. | **Passou.** `buscar` acionou o refinamento, `requiredTerms` recebeu `alegria` e a lista exibiu Alegria do perdão. | 1.787 ms |
| 07 | Acrescente o hino 005. | **Passou.** Perguntou qual dos dois hinos 005 o usuário queria. A lista ficou intacta. | Catálogo |
| 08 | O da CIA. | **Passou.** Acrescentou Canção de Fé, número 005 da CIA, com confirmação do modelo. | 1.740 ms |

Com outra lista de teste, o LFM3 retornou um alvo errado em **duas rodadas**. Para reproduzir, use `Filho Pródigo` como consulta e as duas últimas mensagens `Estou em dúvida sobre o estilo.` e `Você prefere hinos mais alegres ou mais solenes?`. Ofereça o hino 101, De Volta ao Pai, na posição 1 e o 102, Chegada ao Céu, na posição 2. Os trechos sintéticos foram “Volto arrependido e o pai me recebe” e “Chego ao céu e me alegro”. O validador de produção aceitou `["retirar",1]` tanto depois de pedir a retirada do hino 102 pela descrição quanto depois de pedir a retirada de um hino sobre o sangue do cordeiro, ausente da lista. Na segunda rodada os tempos foram 1.065 ms e 970 ms. Essa prova cobre geração real e aceitação pelo validador, com a alteração da lista reproduzida separadamente no controlador.

Nos demais casos diretos, a pergunta sobre estilo e a inclusão confirmada do hino 201 passaram. Ao receber a preferência “Mais alegres, com foco no retorno e arrependimento”, o modelo gerou `["buscar",", Filho Pródigo"]`, rejeitado por começar com vírgula. O pedido explícito de manter o hino 101 gerou `["falar","filho pródigo"]`, preservando a lista com uma resposta pouco informativa. A amostra é qualitativa e usa dados sintéticos.

### Segundo GGUF local

O Q4_K_M (SHA-256 `3793e1e6e2266919d6e015287221b41100175a98eddaba92e111aed3b05c93c4`) carregou em 1.886 ms no mesmo runtime. Reproduziu três das quatro ações de referência em 10.900, 1.072 e 1.120 ms, respectivamente. No caso de retirada contextual com escolha livre, pediu esclarecimento de clima em 1.555 ms. O QAD-Q4_0 retirou o hino esperado naquela entrada. Cada medição corresponde a uma rodada e indica a necessidade de testar os dois arquivos separadamente. Outro runtime local, b10709, rejeitou a arquitetura `lfm3`. O b11960 carregou os modelos.

### Robustez do C++ nativo

| Caso | Comportamento no PC |
| --- | --- |
| Entrada curta, gramática `OK` | `OK` em 507 ms, primeiro token em 446 ms. |
| Gramática inválida | Rejeitada em 2 ms. |
| Entrada acima de 1.000 tokens | Rejeitada antes do prefill. |
| Timeout de 1.000 ms com 508 tokens | Erro de timeout após 4.346 ms, estágio de prefill, zero tokens gerados. A próxima chamada respondeu `OK` em 322 ms. |
| Cancelamento sinalizado no início do prefill | Retornou cancelado em 3 ms, zero tokens gerados. A próxima chamada respondeu `OK` em 278 ms. |
| Cancelamento durante o prefill de 508 tokens | Solicitado aos 204–205 ms, retornou mais 252 ms e 3.641 ms depois, em duas execuções. Nenhuma gerou tokens. A chamada de recuperação respondeu `OK` em 259 ms. |
| Troca para um GGUF sintético de 64 bytes com cabeçalho válido e versão inválida | O JNI rejeitou a versão 0. A geração seguinte informou `Nenhum GGUF carregado`. Após recarregar o modelo oficial explicitamente, a inferência respondeu `OK` em 380 ms. |

## Achados dos agentes

Prioridade alta indica risco de ação sem intenção comprovada, quebra do fluxo principal ou perda de acesso à configuração. Prioridade média indica erro recuperável ou lacuna relevante de cobertura. Os achados abaixo identificam a forma de verificação.

| ID | Prioridade e prova | Reprodução e observação |
| --- | --- | --- |
| A01 | Média · ponte controlada | Após excluir alegria, pedir `Acrescente o hino 005 da Principal` pode fixar um hino alegre apesar do filtro ativo. A lista de inclusões verifica coletâneas, com precedência sobre o resultado filtrado. `app.js:273–279,302`, `offline-api.js:476`. |
| A02 | Média · ponte controlada | Incluir um hino no chat e escrever `nova busca por arrependimento` preserva no topo a inclusão do assunto anterior. `app.js:83,98`. |
| A03 | Alta · ponte controlada | `Não retire nenhum hino. Só me explique a lista.` deixa `retirar` disponível na gramática. Ao receber `["retirar",1]`, o aplicativo removeu o hino. A prova mede a aceitação pelo aplicativo. `local-hymn-ai.js:224–227`, `app.js:383`. |
| A04 | Alta · ponte controlada | `Somente hinos de alegria` pode retornar `["falar","Vamos focar na alegria."]` e manter o filtro vazio. A resposta de conversa encerra o turno sem executar a busca. `app.js:379–392`. |
| A05 | Média · ponte controlada | `Por favor, adicione o hino 012` perde o reconhecimento exato. O mesmo pedido sem a vírgula é reconhecido. `offline-api.js:466`. |
| A06 | Média · ponte controlada | Ao simular a expiração de 35 s depois de `sem alegria`, a busca fica intacta. Com o GGUF indisponível desde o início, a mesma frase aplica a exclusão lexical. `app.js:385–393,1069–1072`, `local-hymn-ai.js:250`. |
| A07 | Média · ponte controlada | Mensagem de 564 caracteres aceita pelo formulário. Só 185 chegam ao modelo. A instrução final sobre manter um hino desaparece sem aviso. `app.js:407–412`, `local-hymn-ai.js:241`. |
| A08 | Média · ponte controlada | Fixar hino alegre e depois refinar com `sem alegria` preserva o hino no topo. A lista visível e a descrição da busca divergem. `app.js:273–279`. |
| A09 | Baixa · ponte controlada | Inclusão exata após erro do modelo é executada pelo catálogo, enquanto o indicador informa erro da IA. A conversa confirma a inclusão sem indicar a origem da ação. `app.js:383–384,1072`. |
| A10 | Média · ponte controlada | `Acrescente o hino 012 da Coletânea` retorna zero candidatos e `da Principal` retorna um. O alias `coletanea` direciona a busca para a coleção pessoal. `offline-api.js:42–47,471–476,574`. |
| A11 | Média · ponte controlada | Em `Acrescente consolo`, a consulta geral encontrou seis hinos elegíveis. O chat recebeu cinco, todos já visíveis, e a gramática ficou sem ação de inclusão. O limite solicitado de oito cai para cinco na API. `offline-api.js:82,481`, `app.js:370–377`. |
| R01 | Alta · modelo real e validador do APK | Retirada pelo conteúdo selecionou o 101 em vez do 102. Alvo ausente também resultou em seleção do 101. Duas rodadas concordaram. A posição válida bastou para o validador aceitar a ação. `local-hymn-ai.js:196–250,259–279`, `app.js:379–384`. |
| R02 | Alta · modelo real e controlador JS | A preferência por hinos de retorno e arrependimento virou um destaque de Consolo e Paz. Noutro catálogo sintético, a consulta veio com vírgula inicial e foi rejeitada. `local-hymn-ai.js:224–250,272–274`, `app.js:379–392`. |
| R03 | Média · modelo real e controlador JS | A pergunta sobre o hino errado ou ausente virou uma pergunta de clima. Pedido de explicação aceitou texto iniciado por `buscar:`, apesar de o parser rejeitar alguns outros rótulos internos. `local-hymn-ai.js:188–195,264–274`. |
| N01 | Média · modelo real Windows | Em prefill de 508 tokens, um prazo de 1 s retornou em 4,346 s e o cancelamento no meio do lote demorou até mais 3,641 s. Revisar granularidade de lotes e checagem do prazo. `hinos_jni.cpp:252`. |
| N02 | Alta · JNI real e inspeção do Java | A tentativa de carregar arquivo corrompido deixou o processo sem modelo ativo. No Android, o app grava as preferências, descarrega o modelo e pode excluir o cache anterior antes de completar a cópia e validar com `nativeLoad`. A consequência sobre cópia e preferência precisa de instrumentação Android. `MainActivity.java:257–271,401–418`. |
| N03 | Média · inspeção do Java | O cache usa URI e tamanho. Se o provedor substituir o conteúdo pelo mesmo tamanho, uma nova seleção explícita pode recuperar a cópia antiga. `MainActivity.java:250–262`. |
| N04 | Média · dois modelos reais Windows | O Q4_K_M perguntou sobre clima onde o QAD-Q4_0 executou a retirada contextual esperada. Ambos produziram JSON aceito. O GGUF selecionado altera o comportamento que chega ao app. |
| P01 | Alta · auditoria binária | 2.6.21/build 40 e 2.6.22/build 41 têm o mesmo applicationId e certificados distintos. O Android exige continuidade de assinatura para atualização direta. Ambos desabilitam `allowBackup`. A validação foi feita sobre os pacotes, com a instalação física pendente. Ver [issue #42](https://github.com/pabloerlis/Buscador-de-Hinos/issues/42). |
| P02 | Média · inspeção da instrumentação | `verifyChat` chama JNI por reflexão com prompts prontos. O loop pode validar uma fixture que contém apenas um prefixo das quatro solicitações e ainda emitir `contextual_remove=true`. Instrumentar a WebView, validar cardinalidade e identificar cada cenário no log. `Lfm3DeviceSmokeTest.java:151–175`. |
| P03 | Média · inspeção da instrumentação | O teste de restauração pré-posiciona o GGUF no cache privado e grava as preferências antes de criar a Activity. Ainda falta cobrir a seleção real pelo Android, a cópia de um provedor e a recuperação de uma troca inválida. `Lfm3DeviceSmokeTest.java:103–135`. |
| E01 | Média · ponte E5 controlada | Modo literal com E5 ligado solicita inferência e anuncia busca híbrida. A API desativa E5 naquele modo. O teste confirmou custo de chamada e mensagem incoerente. `app.js:138,698–719`, `offline-api.js:558`. |
| E02 | Média · ponte E5 controlada | Paginar antes da resposta E5 descarta o vetor e deixa “interpretando a consulta no aparelho…” após a conclusão. `app.js:414,702–709`. |
| E03 | Baixa · ponte E5 controlada | Progresso de uma consulta antiga pode atualizar o indicador de uma busca nova porque o callback de progresso não verifica o identificador da busca. Reproduzido com callbacks serializados. O ranking mais recente foi preservado e o indicador voltou ao estado correto ao concluir a segunda busca. `app.js:680–681,705`, `MainActivity.java:48,143–167`. |
| E04 | Média · ponte E5 controlada | A revisão automática com GGUF espera E5 terminar ou falhar, embora a primeira lista já esteja exibida. O limite de E5 pode adicionar até 120 s de espera antes de a revisão começar. O chat manual segue um caminho diferente. `app.js:138–144,691`. |

Certificados SHA-256. 2.6.21 `07ade91d49753369932e347b9ee69c9b0125f4b177988afbb53b7e9e2269c465`. 2.6.22 `746c20ca6779bd7c14950f49bad324f17d1d719850ae69b00dae9eb84e35a22e`. Os seis binários JNI/ONNX das duas ABIs são idênticos entre essas versões. O piloto 2.6.16 possui outro pacote e certificado `52c13d854392db0ce90632e8521391d4995fc31197daf34f1d8acbc579d83f46`.

## Evidência Android anterior

Os 14 jobs da execução 44999673231 passaram. O artefato registra WebView/E5 offline no Android x86_64 em 11,38 s, quatro inferências de chat reportadas em 64,505 s e restauração do GGUF no início e na recriação da Activity. Os resultados são daquele runner. Nas 12 paráfrases provisórias do catálogo, o Recall@10 foi 2/12 com E5 ligado e desligado. O Recall@20 foi 4/12 com E5 ligado e 3/12 sem E5. Os alvos `principal:374` (18 → 21) e `cia:062` (3 → 4) pioraram no comparativo histórico RRF/aditivo. As 12 posições permaneceram no comparativo semântico entre versões. Os testes locais sintéticos não repetem essa avaliação. [CI #44999673231](https://github.com/pabloerlis/Buscador-de-Hinos/actions/runs/44999673231) · [Issue #44](https://github.com/pabloerlis/Buscador-de-Hinos/issues/44)

## Continuidade

1. Exigir evidência do hino solicitado e limitar ações de edição ao verbo autorizado pelo usuário. Validar negação, alvo ausente, ordem dos candidatos e respostas que só repetem o assunto.
2. Aplicar preferências e filtros explícitos de forma consistente com as inclusões manuais. Cobrir timeout, busca nova, coleção ambígua, pontuação e mensagens longas com testes de regressão.
3. Preservar modelo e cache anteriores até o carregamento da nova seleção ser confirmado. Validar troca, cancelamento, reinício e espaço insuficiente no Android.
4. Validar estratégia de assinatura e migração de dados antes de distribuir uma atualização sobre o mesmo pacote. Executar a suíte pelo fluxo real da WebView em emulador offline e repetir em ARM64 físico. [Issue #42](https://github.com/pabloerlis/Buscador-de-Hinos/issues/42) · [Issue #44](https://github.com/pabloerlis/Buscador-de-Hinos/issues/44)
5. Exercitar E5 com encoder real durante paginação e buscas sobrepostas. Comparar o indicador com o estado da busca e repetir a avaliação das paráfrases com mais julgamentos de relevância.

## Reproduções locais

- Chat com ponte controlada. `node qa-chat-2622/verify-chat.cjs` a partir da raiz do workspace desta campanha. Resultado `qa-chat-2622/resultado-chat.jsonl`, SHA-256 `b0c4926b92dfa5c9da5514c14ccd53af994ffe677fb55811d7dda310f43669c9`.
- Chat com modelo real. `qa-pc-2622/chat-app-real.cjs` e `qa-pc-2622/chat-real.cjs`, com prompts/gramáticas da produção encaminhados ao JNI Windows e limite de 60 tokens ou 35 s por chamada. As capturas consolidadas estão em `qa-pc-2622/flow-result.jsonl` e `qa-pc-2622/real-qad-decoded.json`.
- JNI Windows. `qa-native-2622/dialogue-qad.log`, `dialogue-q4km.log`, `stress-qad.log` e `followup-qad.log`. Compilar `hinos_jni.cpp` do commit indicado com JNI/ggml/llama no Windows, carregar o GGUF pelo método `nativeLoad(path,false)` e testar com as gramáticas de referência.
- Estado E5. `node qa-audit-2622/test-packaged-embedding-state.js`. Em condições balanceadas, a reordenação e o indicador foram atualizados. Ao simular erro nativo, o resultado lexical permaneceu disponível.
- Pacote e assinatura. `qa-audit-2622/inspect_apk.py`. O relatório considera o APK extraído e os hashes dos artefatos originais.
