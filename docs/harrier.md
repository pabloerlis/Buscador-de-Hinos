# Harrier 600M — etapa experimental H1

Checkpoint: restore/v2.8.2-pre-harrier (a46b699e41e685c354ffbcab80b250d345f7dfd3).
Modelo MIT de embeddings Microsoft. Exportação ONNX Community fixada no commit dbaf6767003608562dd5b744bc443656a29c45bd. O grafo e pesos q4f16 somam 353435746 bytes; tokenizer/config adicionais. Q4 sem FP16 soma 399202294 bytes e é alternativa CPU. Hashes de cada peso publicados nos ponteiros LFS desse commit; o script verifica antes de inferir.

A saída Harrier é 1024D; BPE, last-token pooling, L2 e prefixo instrucional somente na consulta. E5 é 384D, Unigram e mean pooling. É proibido misturar os índices. O teste H1 compara a mesma coleção de 24 textos sintéticos originais (16 positivos e 8 distratores) com 16 consultas em português. Mede Recall@1/5, MRR e nDCG@10, latência, pico RSS e compatibilidade ORT 1.20 CPU x86. Não prova superioridade na coletânea nem compatibilidade Android.

H2: selecionar variante operacional, conferir tokenização e vetores contra referência, gerar índice com mesmo checkpoint e pipeline; verificar em ARM64, incluindo RAM, cold/warm, latência e corpus real. H3: gerenciador de pacote externo com manifesto de tamanho/hash fixos, download explícito, cancelamento, instalação atômica, armazenamento privado e remoção; busca atual sempre disponível. Não ativar ranking vetorial sem índice compatível. APK padrão continua sem pesos. Nenhum modelo generativo.

## H2 — compatibilidade de runtime

H1 (run 45473665680): E5 / ORT 1.20.0 aprovado, Recall@1 0.5, Recall@5 0.6875, MRR 0.6094004953379952, nDCG@10 0.6450240236419504. Latência mediana 1.798 ms em CPU x86; RSS de processo 685612 KiB. Ambos Harrier falharam antes da inferência: atributo bits não reconhecido em GatherBlockQuantized. Não houve medição de qualidade do Harrier.

H2 fixa ORT 1.31.1 (disponível em PyPI e Maven Android), testa E5 e as duas variantes em CPU x86 e Harrier em CPU ARM64 Linux. O benchmark sintético, pesos, prefixos e métricas permanecem idênticos. Os relatórios incluem três fixtures com IDs e vetores completos para futura conferência Android. Linux ARM64 não é Android: não implica compatibilidade JNI nem prova desempenho em smartphone. A dependência Gradle da linha estável não muda até a validação. O índice, gerenciador e APK de integração ainda não existem.

## H3 — índice versionado

H2 (run 45474660816) aprovado nos cinco jobs. Harrier Q4F16 em ARM64 Linux: Recall@1 .75, Recall@5 .9375, MRR .819391, nDCG@10 .844861, mediana 194.936 ms, RSS 572684 KiB; Q4 mesma qualidade e mediana 271.993 ms. E5 x86 no mesmo runtime: Recall@1 .50, Recall@5 .6875, MRR .601910, nDCG@10 .674470. Pacote Q4F16 completo 362559399 bytes. A pequena avaliação sintética não valida a coletânea real.

Selecionado Q4F16, com todos os cinco arquivos fixados por SHA-256 e tamanho. O script build_harrier_index.py utiliza a revisão da coletânea já fixada no QA, guarda somente fingerprints e vetores int8 de 1024 dimensões (até dois segmentos por hino). Não grava títulos ou letras. Manifesta origem, hash, revisão, dimensão, prefixo, pooling e quantização. O workflow harrier-index.yml audita a base e cria a branch data/harrier-600m-v1, sem sobrescrever dados existentes. A publicação é condicionada ao sucesso da geração. A branch de dados deve ser utilizada por commit SHA para futuras instalações; não incluir pesos ou catálogo no APK. A cobertura exata contra o importador Android e qualidade no corpus real serão gates da integração. Não se presume compatibilidade Android pela execução em Linux ARM64.

## H4 — publicação e instalador

Base real 1562 fingerprints, 2898 vetores, 4034468 bytes, SHA-256 faa0adcaa299f9657e524d3f39a6617c4a46f632f49b1699a7b80c54c17ad664. Publicada na branch data/harrier-600m-v1, commit d4da3321702e048acae32c1cfca1223d0159b45d. O APK experimental 2.8.3 inclui um instalador independente, com origem fixa, sete arquivos e SHA-256, download sob demanda, progresso, cancelamento, diretório privado, finalização por rename e remoção. Tamanho total 366595730 bytes; reserva adicional de 32 MiB. Sem retomada parcial; cancelamento/erro remove estágio. Estado instalado exige arquivos de tamanho correto e marcador escrito após verificar todos os hashes; antes de inferir, o motor futuro deve revalidar os hashes. Nenhuma pesquisa usa Harrier ainda. A sessão E5 opcional não é modificada nesta etapa. Testes de download real e execução Android pendentes.

## H5 — diagnóstico Android (2.8.4)

ORT Android 1.31.1 com runtime ARM64 no APK, pesos externos inalterados. Tokenizers.js 0.2.0 Apache-2.0, tarball fixado por SHA-512, preparado no build; o vocabulário continua no pacote externo. Três fixtures reais de H2 (ARM64 Linux, run 45474660816, job 138731553632) armazenam texto sintético, IDs e embedding de referência. Diagnóstico exige tokenização idêntica, sete hashes do pacote, saída sentence_embedding 1024D finita, normalizada, cosseno >= .995 para os três casos. Relata latência e carregamento; fecha a sessão depois do diagnóstico. Não ativa ranking Harrier nesta etapa; após teste físico, integrar busca com calibração, filtros e cobertura. A auditoria do APK permite runtime nativo mas proíbe pesos, índice e vocabulário. Preparação local: python3 scripts/prepare_harrier_tokenizer.py antes de gradle assembleDebug.
