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
