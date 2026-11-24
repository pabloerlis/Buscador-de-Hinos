# Harrier 600M — etapa experimental H1

Checkpoint: restore/v2.8.2-pre-harrier (a46b699e41e685c354ffbcab80b250d345f7dfd3).
Modelo MIT de embeddings Microsoft. Exportação ONNX Community fixada no commit dbaf6767003608562dd5b744bc443656a29c45bd. O grafo e pesos q4f16 somam 353435746 bytes; tokenizer/config adicionais. Q4 sem FP16 soma 399202294 bytes e é alternativa CPU. Hashes de cada peso publicados nos ponteiros LFS desse commit; o script verifica antes de inferir.

A saída Harrier é 1024D; BPE, last-token pooling, L2 e prefixo instrucional somente na consulta. E5 é 384D, Unigram e mean pooling. É proibido misturar os índices. O teste H1 compara a mesma coleção de 24 textos sintéticos originais (16 positivos e 8 distratores) com 16 consultas em português. Mede Recall@1/5, MRR e nDCG@10, latência, pico RSS e compatibilidade ORT 1.20 CPU x86. Não prova superioridade na coletânea nem compatibilidade Android.

H2: selecionar variante operacional, conferir tokenização e vetores contra referência, gerar índice com mesmo checkpoint e pipeline; verificar em ARM64, incluindo RAM, cold/warm, latência e corpus real. H3: gerenciador de pacote externo com manifesto de tamanho/hash fixos, download explícito, cancelamento, instalação atômica, armazenamento privado e remoção; busca atual sempre disponível. Não ativar ranking vetorial sem índice compatível. APK padrão continua sem pesos. Nenhum modelo generativo.
