# Buscador de Hinos para Android (APK)

Versão Android nativa com interface WebView e busca local em JavaScript.

## Funcionalidades
- Busca local por hino, número, título, trecho, tema e associação contextual heurística.
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
A versão Android usa busca semântica aproximada por regras de temas; **não inclui IA generativa nem embeddings** e não exige chave de API.
As letras não acompanham o APK. O usuário importa diretamente da fonte ou de um arquivo próprio.
A origem disponível publicamente não prova permissão para redistribuição das letras.
A build não foi validada em telefone físico; teste a instalação, importação e o armazenamento antes de distribuir.

Fonte de dados: `https://github.com/italozaina/projection-html5-icm`.
Código-base da interface derivado do projeto Buscador de Hinos desenvolvido nesta conversa.
