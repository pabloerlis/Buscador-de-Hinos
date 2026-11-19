# Buscador de Hinos — Android 1.3.1

Aplicativo Android ARM64 com busca offline, ranking estimado e motor GGUF opcional (`llama.cpp`).

## Corrigido na 1.3.1

- Seleção pelo seletor oficial do Android (`ACTION_OPEN_DOCUMENT`) e permissão persistente de leitura quando disponível.
- Corrigido o erro `/proc/self/fd/N (Permission denied)`: o GGUF é copiado por streaming, sem ocupar RAM equivalente ao tamanho do arquivo, para o diretório privado do app antes de carregar com `llama.cpp`.
- Progresso de cópia separado do progresso de carregamento, com exibição do armazenamento livre e do cache.
- A cópia é reutilizada em carregamentos seguintes. Exige espaço livre para uma cópia adicional do GGUF.
- Ainda é necessária validação real com Qwen3.5 2B/Gemma 4 E2B no smartphone.

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
