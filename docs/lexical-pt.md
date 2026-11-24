# Base lexical offline — OpenWordnet-PT 1.0.0

Fonte oficial: https://github.com/own-pt/openWordnet-PT/releases/tag/v1.0.0 (asset 46281227, own-pt.tar.gz, 3161610 bytes). Licença CC BY 4.0. Autores: Alexandre Rademaker, Valeria de Paiva, Fredson Aguiar e colaboradores. Baseada em Princeton WordNet 3.0: https://wordnet.princeton.edu/wordnet/license/.

O gerador valida o tamanho e o SHA-256 do arquivo da release (fixado após geração bem-sucedida no CI: 207c2c9066396ccec0884ac6b2de2aada6b6475fe2b5b21ef71455b84c90506e). O upstream não publica digest próprio para esse asset. O índice gerado contém 15.372 grupos, 26.129 termos e 512.343 bytes; a geração agora exige exatamente essa cobertura. Não há equivalência transitiva ou expansão por antônimos/hiperônimos. Um lema polissêmico pode ter vários sentidos; a opção curada reduz falsos positivos.

Geração local antes do Gradle: python3 scripts/build_lexical_pt.py. O CI gera e transfere o índice real para regressões, métricas e build. O APK deve conter o índice e controles; a auditoria de assinatura continua obrigatória.
