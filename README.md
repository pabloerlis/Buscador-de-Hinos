# Buscador de Hinos para Android (APK)

Versão Android nativa 1.2.0 com interface WebView e busca local em JavaScript, agora com base de conhecimento semântico offline.

## Funcionalidades
- Busca local por hino, número, título e trecho, com associação semântica por taxonomia de conceitos e relações ponderadas.
- Banco auxiliar `semantic-db.json`: 41 temas, 350 sinais textuais, 221 expressões de intenção e 133 relações ponderadas entre temas.
- Exemplo: a consulta "ansiedade" pode encontrar hinos sobre "confiança", "paz" e "refúgio" quando essas ideias estiverem fundamentadas na letra.
- Indexação dos temas a partir das letras na importação; o índice é armazenado no IndexedDB e reconstruído quando a versão da taxonomia muda.
- Explicações locais mostram palavras/expressões encontradas e a relação temática usada.
- Cinco resultados iniciais e botão para carregar mais.
- Visualização das letras e referências explícitas.
- Refinamento contextual local, mantendo critérios da conversa.
- Dados salvos em IndexedDB no próprio aparelho: após a primeira importação, a busca funciona offline.
- Importação da Coletânea 2018 via GitHub ou arquivo JSON escolhido no telefone.

## Compilar no Android Studio
Abra esta pasta no Android Studio e selecione **Build > Build APK(s)**.
Requer JDK 17, Android SDK 35 e conexão para baixar dependências Gradle.
O APK de debug é gerado em `app/build/outputs/apk/debug/app-debug.apk`.

Também há workflow GitHub Actions em `.github/workflows/android-apk.yml` para compilar o APK automaticamente após envio ao repositório.

## Instalar
Transfira o APK para o aparelho, abra-o e confirme a instalação quando solicitado.
A versão debug é assinada pela chave de desenvolvimento e não é adequada para publicação em lojas.

## Limites e direitos
A versão Android usa **semântica lexical-associativa**, não embeddings nem modelos de linguagem. O motor associa conceitos via taxonomia local e somente apresenta resultados que possuam sinais textuais correspondentes na letra ou no título. Há limitações: ironia, negação, ambiguidade e interpretação teológica profunda não são compreendidas. As relações não são doutrina oficial, precisam de revisão humana. Não exige chave de API nem internet após importar a coletânea.
As letras não acompanham o APK. O usuário importa diretamente da fonte ou de um arquivo próprio.
A origem disponível publicamente não prova permissão para redistribuição das letras.
A build não foi validada em telefone físico; teste a instalação, importação e o armazenamento antes de distribuir.

Fonte de dados: `https://github.com/italozaina/projection-html5-icm`.
Código-base da interface derivado do projeto Buscador de Hinos desenvolvido nesta conversa.

## Banco de dados auxiliar semântico (v1.1)

- `app/src/main/assets/semantic-db.json`: base editável e independente das letras; cada registro possui `id`, `label`, `evidence` (expressões pesquisadas nas letras), `intent` (formas de perguntar) e `related` (temas associados com pesos de 0 a 1).
- `app/src/main/assets/semantic-engine.js`: normalização de texto, detecção de evidências, expansão limitada a **uma relação temática**, pontuação e justificativa fundamentada.
- `app/src/main/assets/offline-api.js`: indexa os hinos automaticamente na importação, armazena perfis e os utiliza no ranking e no refinamento.
- A pesquisa sempre funciona no aparelho; somente a importação inicial por GitHub exige internet. Um JSON local também pode ser importado sem internet.
- O APK anterior não recebe este recurso automaticamente: é necessário compilar e instalar a versão **1.1.0**. O projeto inclui um workflow GitHub Actions para compilação.

### Testes

Execute `node tests/test-offline.js` para verificar a importação e buscas locais. A validação com a coletânea completa e testes em aparelho Android físico ainda são pendentes.

### Atualizar taxonomia

Edite `semantic-db.json`, aumente a chave `revision` para forçar a reindexação dos hinos já importados e compile novamente. Em uma edição futura da coletânea, basta importar o JSON correspondente.

## Modelo de IA local GGUF (v1.2)

**O recurso GGUF é opcional:** sem arquivo, a base semântica e todas as buscas anteriores continuam offline. Para usar IA generativa no aparelho:

1. Abra Configurações → **Escolher arquivo .gguf**, localize no Android um modelo GGUF do tipo Instruct, preferencialmente pequeno e quantizado.
2. Toque em **Carregar modelo**. O arquivo permanece em seu local original; a aplicação abre um descritor persistente do Storage Access Framework e faz mmap com o motor nativo `llama.cpp`.
3. Faça uma pesquisa normalmente. Toque em **Reinterpretar com GGUF** para expandir semanticamente sua consulta. A classificação final sempre ocorre sobre os hinos da coletânea importada.

**Limitações:** somente Android ARM64; desempenho depende da CPU e da memória. Há restrições em arquivos de provedores de nuvem e SAF sem acesso aleatório; prefira GGUF baixado para o armazenamento local. O modelo **não é distribuído no APK** e pode ter licença própria. A inferência não exige internet. O mecanismo nativo usa `llama.cpp` b8201 (MIT), obtido automaticamente durante a compilação Gradle com CMake/NDK. A extensão executa o modelo localmente; não há verificação doutrinária automática.

**Compilação:** é necessário Android NDK 27.2.12479018, CMake 3.22.1, Git e acesso de rede na primeira compilação para buscar as fontes do llama.cpp. Execute `gradle assembleDebug`. O processo de compilação nativa é significativamente mais pesado que nas versões anteriores. Esta entrega não foi testada em aparelho físico; testes automatizados verificam a lógica JavaScript e a interface, não a inferência em hardware real.
