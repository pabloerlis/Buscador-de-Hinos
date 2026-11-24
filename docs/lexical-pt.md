# Base lexical offline — OpenWordnet-PT 1.0.0

Fonte oficial: https://github.com/own-pt/openWordnet-PT/releases/tag/v1.0.0 (asset 46281227, own-pt.tar.gz, 3161610 bytes). Licença CC BY 4.0. Autores: Alexandre Rademaker, Valeria de Paiva, Fredson Aguiar e colaboradores. Baseada em Princeton WordNet 3.0: https://wordnet.princeton.edu/wordnet/license/.

O gerador valida o tamanho do arquivo de release, registra seu SHA-256 e exige cobertura mínima. O upstream não publica digest para esse asset; o hash medido ainda precisa ser fixado após a primeira geração independente bem-sucedida. Não há equivalência transitiva ou expansão por antônimos/hiperônimos. Um lema polissêmico pode ter vários sentidos; a opção curada reduz falsos positivos.

Geração local antes do Gradle: python3 scripts/build_lexical_pt.py. O CI gera e transfere o índice real para regressões, métricas e build. O APK deve conter o índice e controles; a auditoria de assinatura continua obrigatória.
