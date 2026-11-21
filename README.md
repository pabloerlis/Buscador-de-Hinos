# Buscador de Hinos Android v2.5.0

A busca e a comparação funcionam offline depois de importar a coletânea. O app consulta títulos, letras, temas, narrativas e referências bíblicas locais. A comparação reúne até cinco resultados com os trechos e a afinidade estimada.

Em buscas temáticas, o ranking favorece hinos que sustentam dois temas da consulta em até quatro versos da mesma estrofe. O cartão exibe esse trecho. A frase curada “cansado de esperar” aciona o tema perseverança e pode ser combinada com expressões como “ainda confio em Deus”.

`node tests/test-stanza-ranking.js` avalia a ordem dos cinco primeiros resultados em 40 consultas temáticas e 10 controles. As notas de relevância usam letras sintéticas com os temas juntos e separados. A opção `--baseline=<diretório de assets>` compara outra versão. A opção `--catalog=<arquivo JSON>` mede separadamente a presença de evidência na coletânea fornecida.

| Consulta | Comportamento |
| --- | --- |
| `apenas os de vigilância` no refinamento | Mantém os hinos da busca atual que têm vigilância no texto ou como tema direto. Requisitos sucessivos se acumulam. |
| `gratidão sem alegria` | Exclui hinos que contêm a palavra ou têm associação direta com o tema da alegria. |
| `gratidão sem foco em alegria` | Reduz a pontuação dos hinos associados à alegria e mantém os que atendem aos critérios. |
| `"canto sem medo"` | Busca a sequência de palavras no título ou na letra. |
| `nova busca por esperança` no refinamento | Limpa a consulta anterior e seus filtros. |

O ranking prioriza o título exato, consulta a frequência das palavras na coletânea e admite um erro simples de grafia nos modos Equilibrada e Contextual. No modo Literal, a busca usa correspondências de texto.

Os filtros acompanham a paginação e a lista de hinos não aprendidos. Use aspas em um requisito para exigir o trecho exato, como em `somente "vem logo senhor"`.

O APK padrão desativa GGUF e E5. O GitHub Actions compila com `gradle assembleDebug` e verifica o conteúdo do APK gerado. Para desenvolvimento com os modelos locais, a compilação usa `gradle assembleDebug -PenableLocalModels=true`, NDK 27.2.12479018 e CMake 3.22.1. O E5 também exige os dados locais gerados pelo script em `scripts/build_e5_assets.py`.

## v2.3 - Busca complementar com GGUF

- O GGUF pode pedir uma busca complementar por termos em português ao usar **Comparar com IA** ou **Buscar hinos com IA**. O app permite uma consulta por comparação, mantém os filtros ativos e mostra os termos usados. Mesmo sem resultado inicial, o modelo pode buscar candidatos no índice local.
- As sugestões de temas usam uma lista estruturada com os nomes do catálogo. Pesquisas por número exato e pesquisas em modo literal ficam fora dessa expansão.
- Alterar filtros preserva exclusões, temas aplicados e o vetor da consulta. Refinamentos longos mantêm o texto novo dentro do limite de 500 caracteres.

## v2.2 — Comparação com GGUF e teste de geração

1. Abra **Configurações → IA local experimental**, escolha um GGUF e toque em **Carregar modelo**.
2. Toque em **Testar modelo**. O app executa uma geração curta e mostra o tempo de preparação, de processamento da entrada e até o primeiro token.
3. Faça uma pesquisa com pelo menos dois hinos e toque em **Comparar com IA**. O modelo recebe até cinco trechos do índice local, junto dos temas e da passagem bíblica quando disponíveis. O app mostra até duas escolhas com a justificativa da IA e o trecho da coletânea.

A busca e a comparação pelo índice continuam disponíveis durante a geração. A comparação via GGUF tem um prazo de até 60 segundos. Todas as consultas e inferências são executadas no aparelho após a importação. O motor incluído é `llama.cpp b8201` e não suporta arquivos GGUF com arquitetura `gemma4`.

Para verificar cancelamento durante o uso, inicie uma comparação e toque em **Interromper IA**. Para verificar o descarte de respostas antigas, inicie uma comparação e faça uma nova busca antes da conclusão.

## v2.1 — Repertório da igreja

Novidade: repertório da igreja. Qualquer hino pode ser marcado como **não aprendido**, ficando fora das sugestões principais e preservado em gavetas recolhíveis nos resultados e nas recomendações. A marcação é independente da importação e permanece armazenada localmente entre atualizações normais. Não desinstalar/limpar dados sem backup.

# Buscador de Hinos v2.0 — Índice bíblico offline

- Pesquisa por livros, capítulos e intervalos de versículos (ex.: `Marcos 5:25-34`).
- Busca por 48 nomes narrativos e sinônimos (ex.: `mulher do fluxo de sangue`), mantidos como suplemento, não limite da cobertura.
- Grafo compilado no GitHub Actions com tópicos bíblicos NEUU (CC BY 4.0) e referências cruzadas de OpenBible/NEUU (CC BY 4.0).
- Tópicos ingleses são filtrados e mapeados a 41 categorias em português. Não é uma tradução indiscriminada das 5.745 entradas.
- Referências cruzadas configuráveis: desativadas, conservadoras e ampliadas; evidência direta sempre tem prioridade.
- Pontuação explicável por evidência encontrada na própria letra do hino; evita classificar pela simples menção de Deus/Jesus.
- Mecanismo estritamente local, sem invocar o E5 ou o GGUF para consultas bíblicas reconhecidas. O E5 permanece opcional para consultas livres.
- APK preserva as três coleções importáveis e mantém a compatibilidade com o armazenamento existente.
- Fontes fixadas em commits para compilação reproduzível. Os dados de hinos não são redistribuídos junto ao APK.

Atribuição: Bible Topics Dataset © NEUU, CC BY 4.0, https://github.com/neuu-org/bible-topics-dataset. Bible Cross-References Dataset © NEUU / OpenBible, CC BY 4.0, https://github.com/neuu-org/bible-crossrefs-dataset. Bíblia Livre © 2018 Diego Santos, Mario Sérgio e Marco Teles, CC BY 4.0 Brasil.

Essas associações são heurísticas de recuperação textual; não representam julgamento doutrinário nem probabilidades estatísticas.

---

# Buscador de Hinos — Android v1.9

## Novidade: três bibliotecas pesquisáveis

- **Coletânea 2018**: 795 registros na fonte de 20/11/2026.
- **Avulsos 2018**: 531 registros na mesma fonte.
- **CIA 2018**: 241 registros na mesma fonte.
- **Total bruto: 1.567 registros**. Dez letras idênticas foram encontradas na verificação inicial, com cerca de 1.557 registros únicos (a quantidade efetiva é recalculada no aparelho).
- Origem: `https://raw.githubusercontent.com/italozaina/projection-html5-icm/master/data/data.json`; as três coleções são importadas a pedido do usuário e armazenadas no IndexedDB local do Android. Outros grupos presentes na fonte, como Coletânea Antiga, Test e Prova, são ignorados.
- **Não se distribuem letras dessas coletâneas dentro do APK**; a importação exige conexão e os dados permanecem localmente. O aplicativo não é um serviço de streaming, catálogo oficial ou verificador de direitos autorais.
- **Deduplicação por texto normalizado da letra:** mantém uma entrada por conteúdo idêntico, preservando todas as referências de número e coleção. Variações textuais não idênticas permanecem distintas para evitar falsos agrupamentos.
- **Pesquisa e recomendações em cadeia:** filtros por coleção e resultados cruzados, inclusive com números homônimos.
- **E5 Small:** na compilação Android, vetores são pré-calculados para as três fontes de 2018. O modelo roda no aparelho para consultas de pesquisa, sem geração GGUF; somente hinos com impressão digital correspondente ao índice usam essa camada, enquanto hinos de JSON pessoais continuam localmente pesquisáveis.
- **Migração:** instalações anteriores com cache da coletânea principal são preservadas. Para adicionar Avulsos e CIA, acione `Adicionar Avulsos e CIA` na página principal.
- **Compatibilidade:** ARM64-v8a, Android 7+, APK de depuração. Não há garantia de assinatura de atualização entre builds CI diferentes.
- **Licenciamento:** o app não inclui os textos completos de hinos. A biblioteca Bíblia Livre é distribuída com atribuição CC BY; verificar permissões para qualquer redistribuição de letras.

---

# Buscador de Hinos — Android 1.6

Aplicativo Android ARM64 com busca offline, ranking estimado e motor GGUF opcional (`llama.cpp`).

## Corrigido na 1.3.1

- Seleção pelo seletor oficial do Android (`ACTION_OPEN_DOCUMENT`) e permissão persistente de leitura quando disponível.
- Corrigido o erro `/proc/self/fd/N (Permission denied)`: o GGUF é copiado por streaming, sem ocupar RAM equivalente ao tamanho do arquivo, para o diretório privado do app antes de carregar com `llama.cpp`.
- Barra de progresso de cópia separada do progresso de carregamento; mostra espaço de armazenamento livre e volume do cache. A cópia é reutilizada em carregamentos seguintes.
- Exige espaço para uma cópia adicional do GGUF no armazenamento do dispositivo. **Essa cópia não representa consumo de RAM.**
- Continua sendo necessária validação com Qwen3.5 2B e Gemma 4 E2B no aparelho físico.

## O que mudou

- Exibe uma **afinidade em %** para cada hino. É uma **pontuação heurística**, não probabilidade calibrada e nem validação teológica.
- Exibe o estado da IA: **selecionado, carregando, pronto, gerando ou erro**, além de progresso, RAM disponível, tamanho do GGUF e último erro de execução.
- O GGUF pode **interpretar consultas automaticamente** (alternável), **comparar os 5 melhores resultados** e **analisar o hino selecionado**.
- Consultas por **texto bíblico** e referências mapeadas (por exemplo, Salmo 23 e Filipenses 4:6) usam uma tabela contextual revisável. Versículos não mapeados devem ser colados em texto.
- A busca local funciona sem modelo e nenhuma resposta do modelo é tratada como se fosse um hino da coletânea.
- Carregamento com `mmap`, sem `mlock`, contexto econômico de 1280 tokens, lotes de 128 tokens e logs de erro nativo (não apresentar toda falha como falta de RAM).

## Usar

1. Instalar o APK de teste (compilado pelo GitHub Actions).
2. Importar a coletânea pelo próprio aplicativo, via GitHub ou arquivo JSON. Não há letras distribuídas neste repositório.
3. Abrir **Configurações → IA local**; escolher GGUF e carregar. Somente a escolha do arquivo não ativa o modelo.
4. Observar o indicador **IA: ...** no topo. Quando aparecer **IA: Modelo pronto**, a geração está disponível.
5. Pesquisar e observar a busca local imediata; com a opção automática ligada, o GGUF complementa a interpretação. Também é possível comparar os 5 resultados ou analisar um hino.

## Problemas de memória

Memória livre indicada em Configurações é a memória do sistema, **não garantia de alocação dentro de um único processo**. O motor pode recusar modelos por quantização, arquitetura GGUF, permissões do provedor de arquivos ou RAM. A nova versão mostra a mensagem do motor em vez de assumir falta de RAM.

Como primeira tentativa, usar um GGUF *Instruct* de ~0,8B a 2B em Q4, armazenado localmente em `Downloads`. Alguns modelos multimodais, como variantes do Gemma 4 E2B, exigem mais memória que seu número de parâmetros sugere. Não há garantia de compatibilidade com qualquer GGUF: o motor compilado está fixado no `llama.cpp b8201`.

## Compilação

GitHub Actions: `.github/workflows/android-apk.yml`, branch `android-apk`.

Requisitos: JDK 17, Android SDK 35, NDK 27.2, CMake 3.22, Gradle 8.9, internet para baixar o código do `llama.cpp` durante compilação.

Com os requisitos instalados: `gradle assembleDebug`.

## Segurança e limitações

- APK de depuração, não adequado à distribuição em loja.
- IA e busca offline após importação; o download da base exige internet.
- Modelo escolhido no aparelho, não incluído no APK.
- Sem publicação de letras antes de confirmar direitos de uso.
- Inference e carregamento de Qwen3.5 2B/Gemma4 E2B **ainda não testados em aparelho físico**.


## Versão 1.4 — Pesquisa rápida e GGUF opcional

- Busca lexical e temas indexados em memória: a coletânea é ordenada localmente sem aguardar um modelo.
- A IA local só escolhe **até 4 temas existentes na taxonomia**. Não recebe letras ou títulos completos de hinos.
- Resposta nativa limitada a **36 tokens** (antes 152), em vez de comparações/análises longas.
- **16 segundos** como limite de solicitação, com cancelamento cooperativo nativo; o modelo pode demorar um pouco para abortar operações internas.
- IA automática **desligada por padrão**, inclusive em instalações que usavam a configuração da versão antiga. Pode ativá-la nas configurações.
- Comparação dos cinco melhores resultados e resumo de temas são **100% offline**, sem GGUF.
- Se o GGUF falhar ou esgotar o tempo, a busca local permanece funcional.
- A porcentagem é heurística; não representa probabilidade ou confiança calibrada.


## Versão 1.5 — Busca por narrativas, sem depender de IA

- **Base auxiliar de 13 narrativas bíblicas**, com aliases de pesquisa, referências para contextualização, expressões discriminativas e grupos de evidências. Inclui Filho Pródigo, Ovelha Perdida, Bom Samaritano, Bom Pastor, Tempestade Acalmada, Emaús, Mulher Samaritana, Lázaro, Vale de Ossos Secos, Paulo e Silas, Dez Virgens, Davi e Golias e Multiplicação dos Pães.
- A busca por **Filho Pródigo** reconhece letras que descrevem voltar ao Pai, ser recebido e ser perdoado mesmo sem dizer "filho". Uma menção isolada a "filho" ou "pai" não é suficiente para classificar uma narrativa.
- As associações narrativas têm justificativas baseadas nos trechos efetivos da letra e a indicação de referência bíblica serve apenas como metadado da narrativa, **não como citação presente na letra**.
- Preferências: busca literal/equilibrada/contextual, intensidade semântica, ligar/desligar narrativas e temas relacionados, afinidade mínima, 5 ou 10 por página, justificativas e painel "como a busca interpretou".
- Dicionário de sinônimos **personalizável**: associar expressões digitadas a narrativas; armazenado localmente, sem alterar a coletânea.
- A base importada anteriormente é reindexada automaticamente na primeira abertura, sem exigir importação novamente. A primeira abertura pode demorar mais; as buscas seguintes usam índices em memória.
- Área GGUF mantida sob **Configurações → IA local experimental**; sem IA automática por padrão. O painel da IA fica oculto quando não há modelo carregado.
- São regras semânticas curadas, **não embeddings**; não há garantia de reconhecimento para toda parábola, referência bíblica ou hino. Validar resultados no contexto da letra.

### Testes

`node tests/test-offline.js && node tests/test-gguf.js && node tests/test-v14.js && node tests/test-v15.js`

O teste v1.5 usa letras sintéticas, não a coletânea integral de 2018. A precisão no catálogo real precisa ser avaliada após a importação.


## Versão 1.6 — Recomendações em cadeia

Ao abrir um hino, a seção **Hinos semelhantes a este** mostra outras letras com afinidade comprovável em temas, narrativas bíblicas e termos relevantes. Tocar um hino recomendado abre seus detalhes e recalcula as sugestões; o botão **Voltar ao hino anterior** recupera a sequência. Sugestões repetidas da trilha ficam ocultas por padrão.

### Duas referências no ranking

- **Semelhança com a letra selecionada:** índice de sobreposição ponderada de conceitos, narrativas e palavras relevantes (TF-IDF local).
- **Afinidade com a busca inicial:** obtida do próprio mecanismo de busca offline; refinamentos posteriores também influenciam o contexto, preservando a intenção inicial.
- **Compatibilidade geral:** composição ponderada das duas medidas; padrão 65% letra atual e 35% busca inicial, configurável em Configurações.
- Sem busca inicial, a compatibilidade usa somente o hino selecionado. Buscas só por número também não são tratadas como contexto semântico.

### Configurações adicionais

- Peso das letras atuais de 0% a 100% (a busca ocupa o restante).
- 5 ou 10 recomendações por abertura.
- Considerar ou ignorar a consulta inicial.
- Ocultar ou incluir hinos já visitados.
- Exibir ou ocultar as duas porcentagens separadas.

As pontuações são **heurísticas, não probabilidades de compatibilidade comprovada**. Não treinamos modelo, não há chamadas GGUF e não precisamos de internet depois da importação. São exibidas somente recomendações que possuem evidência temática, narrativa ou lexical; o sistema pode retornar menos de cinco.

### Testes v1.6

`node tests/test-v16.js` valida compatibilidade, cruzamento de hinos, conservação do contexto, porcentagens, deduplicação e preferências. Teste de navegação em navegador mobile também executado com letras sintéticas. A base completa real não foi validada.

## Versão 1.7 — Conhecimento bíblico em português (offline)

- **Bíblia Livre (Almeida 1819, revisão 2018)**: na compilação, o script `scripts/build_scripture_index.py` baixa uma revisão fixa do [Midvash Bible Data](https://github.com/midvash/bible-data), confere o SHA Git do arquivo, verifica 66 livros e cerca de 31 mil versículos, e gera o arquivo `scripture-pt.json` dentro do APK. **Não precisa baixar a Bíblia após instalar.**
- **Referências bíblicas**: interpreta livro, capítulo, versículo e intervalo, por exemplo `Salmo 23`, `João 3:16`, `Lucas 15:11-32`, `1 Coríntios 13:4-7`. Extrai o texto da referência e determina até quatro temas por evidências de palavras na passagem. O texto da Bíblia não é apresentado como se fosse a letra de um hino.
- **Ponte de expressões do cotidiano**: 26 grupos curados de frases, como `não consigo dormir` (paz/confiança/consolo) e `recomeço espiritual` (renovação/graça/perdão). O mecanismo só recomenda hinos cujas letras oferecem evidências desses temas. Não adiciona automaticamente relações de um dicionário genérico.
- **Configurações**: o usuário pode ativar/desativar separadamente a interpretação de versículos e a ponte contextual. O ranking offline, as narrativas e a navegação de hinos relacionados continuam disponíveis sem a Bíblia.
- **Transparência**: Configurações mostram o número de livros carregados e de grupos de associações. A interpretação da consulta indica quando houve uso de texto bíblico ou de uma associação contextual. Porcentagens continuam heurísticas e requerem validação na coletânea.

### Fontes e direitos

**Texto bíblico:** Bíblia Livre (BLIVRE), Copyright © 2018 Diego Santos, Mario Sérgio e Marco Teles, http://sites.google.com/site/biblialivre/. Licença Creative Commons Atribuição 4.0 Brasil, http://creativecommons.org/licenses/by/4.0/br/. Fonte: https://github.com/midvash/bible-data , pasta `versions/pt/almeida-livre`, com licença própria no `metadata.json`. As modificações são somente de formato e compactação para indexação.

**Base de temas bíblicos:** https://github.com/neuu-org/bible-topics-dataset (CC BY 4.0, 5.745 tópicos ingleses). Analisada, mas **não importada indiscriminadamente**: o inglês e a ausência de definições na camada `01_parsed` exigem tradução e validação, sob risco de falsos positivos. **OpenWordNet-PT** (CC BY 4.0) foi avaliada como fonte futura para sinônimos, mas não incorporada integralmente, pois sinônimos sem contexto podem alterar o sentido de um hino. A ponte lexical da versão 1.7 é uma curadoria local independente dessas duas bases.

### Testes

`node tests/test-v17.js` — referências bíblicas, associação lexical sem falsos positivos, compatibilidade com o mecanismo de recomendações e opção de desativar as novas camadas. A cobertura total dos hinos dependerá de validação posterior com a coletânea inteira.

O arquivo `scripture-pt.json` é gerado pelo pipeline e não está no repositório para manter uma fonte de verdade única e versão auditável. É obrigatório para que o APK distribua o recurso bíblico offline.

## v1.8 — Multilingual E5 Small / embeddings locais

A partir da v1.8 a pesquisa usa **busca híbrida real**: o mecanismo textual, os
conceitos e a Bíblia continuam operando imediatamente; um modelo **multilingual-e5-small
int8** (ONNX Runtime Android) gera apenas o vetor da consulta, sem produzir textos.
Os hinos recebem vetores na compilação e não precisam passar pelo modelo no telefone.
A lista é então atualizada com semelhança vetorial, mantendo o contexto original.

- O APK contém os pesos do modelo e os índices vetoriais, portanto é substancialmente maior.
  Ao primeiro uso, o ONNX é copiado uma única vez para o armazenamento do app.
- Fonte de embeddings: `Xenova/multilingual-e5-small`, modelo `intfloat/multilingual-e5-small`
  (MIT). Versão fixada no script de geração. O projeto não distribui letras.
- Os vetores foram gerados com o `tokenizers` oficial e ONNX Runtime; no telefone,
  um tokenizador SentencePiece Unigram em Java é usado. A equivalência exata de
  tokenização com modelos particulares deverá ser medida no aparelho real.
- Confere uma impressão digital SHA-256 por hino; se a letra diferir da fonte usada
  para o índice, o recurso vetorial se desativa, sem misturar edições.
- Cada hino tem dois embeddings `passage:` de trechos diferentes, normalizados e
  quantizados em int8 para comparação rápida.
- O modelo usa a entrada `query:` e seu vetor é combinado com regras textuais e
  semânticas. O resultado imediato local não espera o modelo.
- Em Configurações → *Modelo vetorial E5 Small*, escolha **Híbrida**, **Priorizar
  significado** ou **Desativada**. A busca GGUF permanece experimental, separada.
- Uma referência numérica exata não é reordenada pelo modelo vetorial. O modelo
  nunca inventa hinos, só reordena registros realmente importados.
- A pontuação percentual é heurística, não probabilidade calibrada. Os embeddings
  são baseados em similaridade de significado, não validação doutrinária.

### Preparação e compilação

Em compilações com o E5 habilitado, `scripts/build_e5_assets.py` baixa uma revisão
fixa do modelo e gera `e5-model.onnx`, `e5-vocab.bin` e `e5-index.json` no diretório
`assets`. O script `verify_e5_assets.py` valida os arquivos antes da compilação.

### Testes recomendados no aparelho

1. Importar a coletânea 2018 e confirmar a indicação de hinos vetorizados.
2. Pesquisar `Filho Pródigo`, `Quero voltar para Deus`, `Consolo na tristeza`;
   verificar a atualização de ranking após a primeira lista aparecer.
3. Pesquisar `Hino 125` e confirmar que a correspondência exata prevalece.
4. Desativar E5 nas configurações e conferir que a busca textual permanece ativa.
5. Trocar/alterar letras no JSON e confirmar a desativação dos vetores incompatíveis.


## Agentes independentes — auditoria semântica de letras completas (nov/2026)

A qualidade das sugestões é verificada por três agentes distintos antes de compilar o APK:

1. **Avaliador de casos integrais** (tests/agents/fixture-agent.js): oito consultas com hinos originais de três estrofes e distratores intencionais. Confere recuperabilidade, persistência do texto completo e rastreabilidade dos trechos.
2. **Auditor do catálogo real** (tests/agents/catalog-agent.js): baixa em tempo de execução as três coletâneas de 2018, importa com a API real, lê todas as letras completas e examina 22 consultas, inclusive *Filho Pródigo*, *Mulher com fluxo de sangue*, *Marcos 5:25-34*, temas combinados e recomendações em cadeia. **O hino 286 — Um dia eu quis te deixar — deve estar entre os dez primeiros resultados para Filho Pródigo.**
3. **Consolidador de laudos** (tests/agents/run-validation.js): registra os testes executados, calcula o veredito e emite relatórios independentes.

Execução: gerar os índices bíblicos com os scripts do projeto; baixar temporariamente o JSON da fonte indicada em README para .tmp/catalog-2018.json; então executar `node tests/agents/run-validation.js .tmp/catalog-2018.json`.

O GitHub Actions publica os relatórios **relatorio-completo.md**, **relatorio-simples.md** e **resultado-agentes.json** no artefato `Relatorios-Testes-Semanticos-Letra-Inteira`, mesmo quando os testes falham. O download da coletânea não é publicado nos artefatos nem empacotado no APK.

**Critério de conclusão:** todos os testes obrigatórios PASS e workflow verde. O APK é compilado e enviado como artefato somente depois da aprovação. Falhas reais não devem ser omitidas para liberar o build. Após cada etapa, entregar o link exato do novo APK aprovado e registrar a próxima etapa no GitHub.

**Limite da medição:** o auditor usa indícios textuais de **todas as estrofes**, separados das heurísticas do aplicativo, mas não substitui revisores humanos ou um avaliador semântico independente. Os indicadores de apoio textual são *proxies*, não precisão semântica certificada. Sugestões ambíguas e possíveis falsos negativos entram em uma fila de revisão; não há redistribuição de letras completas.

**Próxima etapa registrada:** avaliar as falhas do teste real, principalmente a posição do hino 286 para *Filho Pródigo*; corrigir o algoritmo em alteração separada, criar conjunto de relevância humana com o contexto completo e repetir a auditoria antes do próximo APK.
