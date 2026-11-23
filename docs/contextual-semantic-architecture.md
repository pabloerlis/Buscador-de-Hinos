# RFC — Busca contextual hierárquica por significado integral dos hinos

**Estado:** PROPOSTA APROVADA PARA PLANEJAMENTO; NÃO IMPLEMENTADA.  
**Prioridade de continuidade:** [issue #58](https://github.com/pabloerlis/Buscador-de-Hinos/issues/58).  
**Data:** 2026-11-22.  
**Responsável pela implementação:** Codex em etapas auditáveis, preservando a arquitetura Android offline.  
**Referências do projeto:** [AGENTS.md](../AGENTS.md), [issue #25 — gabarito humano](https://github.com/pabloerlis/Buscador-de-Hinos/issues/25), [issue #32 — GGUF/performance](https://github.com/pabloerlis/Buscador-de-Hinos/issues/32).

## 1. Decisão e objetivo

Substituir a **prioridade semântica baseada em palavras/trechos isolados** por uma arquitetura **hierárquica** em que a **mensagem integral** da letra seja representada e usada como principal critério de *relevância contextual*.

- Busca lexical, E5 por estrofes, RRF, Bíblia, narrativas e EventFrame **continuam** como recuperadores de candidatos.
- Um **perfil global versionado e verificável** de cada hino representa mensagem central, perspectiva, sequência narrativa, mudanças de sentido e conclusão. É derivado da **letra completa**, não de poucos snippets.
- Um reranker contextual separado da recuperação inicial considera esses perfis. Para recomendações verificadas, os **finalistas** passam por confirmação sobre a **letra original integral**, com evidências conferidas pelo aplicativo.
- A IA local LFM3-1.7B (GGUF escolhido pelo usuário) auxilia a interpretação, a avaliação dos finalistas e, em fase posterior, usa ferramentas locais explicitamente autorizadas. **Não** é necessária arquitetura MCP ou migração para banco vetorial/SQLite para iniciar.
- A busca permanece **100% offline após importação**, sem vincular a experiência básica à disponibilidade do GGUF; resultados sem revisão integral devem ser identificáveis como não verificados, nunca afirmados como validação integral da IA.

**Invariantes:** sem letras no repositório, APK, arquivos de benchmark ou relatórios; sem remoção de mecanismos; sem exceções por hino ou por caso de teste; sem percentuais tratados como probabilidades; número/título literal e filtros continuam corretos; repertório não aprendido permanece separado; sem merge automático; testes físicos ARM64 exigem execução real.

## 2. Diagnóstico confirmado na branch main (inspeção 2026-11-22)

| Arquivo | Observação no código | Consequência |
|---|---|---|
| `app/src/main/assets/local-hymn-ai.js` | `MAX_CANDIDATES=5` e `clip(hymn.snippet,72)`; resposta escolhe IDs | IA compara trechos muito curtos, não a letra completa |
| `app/src/main/assets/app.js` | `compareWithModel()` passa `state.lastResults`, a página corrente | Hinos relevantes que ficaram fora da página não podem ser escolhidos |
| `app/src/main/assets/vector-index.js` | até oito vetores E5 por hino, com intervalos de linhas | boa recuperação local, mas sem representação explícita do arco da letra |
| `scripts/build_e5_assets.py` | janela por bloco de até cinco linhas, no máximo oito trechos selecionados | uma mudança relevante fora das janelas pode não aparecer no índice |
| `app/src/main/assets/rrf-fusion.js` | `baseline=4.0`, `vector=0.8` | o prior da classificação existente domina relativamente a contribuição vetorial |
| `app/src/main/cpp/hinos_jni.cpp` | `cp.n_ctx=1280`; rejeita input >1000 tokens; `llama_memory_clear(...,true)` por chamada | não basta enviar cinco letras completas; é preciso revisar orçamento/tokenização/estado |
| `app/src/main/assets/offline-api.js` | IndexedDB contém `lyrics`; `hymnDetail()` e `/api/hymns/{id}` retornam letra | **não** requer migração imediata do banco para acesso ao texto integral |

As métricas atuais de agentes são úteis, mas não constituem um gabarito humano abrangente: a issue #25 registra alertas lexicais que precisam ser revisados.

## 3. Arquitetura-alvo

```text
Consulta (tema / história / referência bíblica / perspectiva)
       |
       v
Interpretação e normalização da intenção
       |
       v
RECUPERAÇÃO AMPLA: E5-estrofes + E5-perfil global + lexical +
                    narrativas bíblicas + EventFrame + RRF
       |             (união/diversidade, independente da página da UI)
       v
RECLASSIFICAÇÃO CONTEXTUAL: significado central e arco completo,
                              não apenas palavra coincidente
       |
       v
FINALISTAS: recuperar letra integral por ID/hash, verificar
             perspectiva, negação, começo/meio/fim e evidências
             por LFM3 quando disponível + verificações determinísticas
       |
       v
RESULTADOS: ordenar relevância contextual; motivo rastreável;
            distinguir "verificado" de "não verificado";
            preservar exclusões, coleção e repertório
```

**Não gerar IA para os 1.557 hinos a cada consulta.** Primeiro analisar a letra inteira uma vez por versão, armazenar perfis compactos e indexar seus significados. Usar LFM3 para verificar apenas finalistas e entradas sem perfil conforme orçamento. Exemplos de quantidades exploratórias: 30–60 candidatos iniciais e 3–8 finalistas; **não são critérios fixos** — medir Recall, latência e memória antes de escolher.

### 3.1 Camadas de dados

1. **Fonte original:** letra importada, título, coleção e metadados; manter em IndexedDB sem empacotar textos no APK.
2. **Perfil global:** resultado de análise da letra *completa*, sob hash e versão do schema. Campos importantes: mensagem central, perspectiva do narrador, situação inicial, conflito, transformação, conclusão, temas centrais e secundários, citações incidentais, negações, metáforas, analogias e paralelos bíblicos (marcar explícito/inferido).
3. **Perfis por estrofe:** papel de cada parte na progressão do significado; referências estáveis a índices de estrofes e linhas de texto; preservar refrões e ordem.
4. **Índices:** manter vetores E5 por trechos; acrescentar vetores E5 da representação textual curta do perfil global e, se medido como útil, das descrições contextualizadas das estrofes.
5. **Julgamento de relevância por consulta:** score/nível explicado por evidências existentes, consistência com intenção, perspectiva e conclusão; origem do resultado (heurística, perfil, IA verificadora) e status de validação.

Um **perfil não é evidência suficiente por si só**: é dado gerado e potencialmente incorreto. Para classificar como validado por IA, a etapa final deve conferir com a letra original e aceitar apenas identificadores de evidência reais; textos fornecidos pela letra não podem comandar ferramentas ou alterar instruções.

### 3.2 Schema lógico sugerido (a ser versionado e refinado no P1)

```json
{
  "schema_version": 1,
  "hymn_id": 0,
  "source_collection": "principal",
  "lyrics_sha256": "<hash>",
  "profile_generator": {
    "model_id": "<identificador>",
    "prompt_version": 1
  },
  "validation": {
    "status": "pending",
    "method": "none"
  },
  "global": {
    "central_message": "",
    "narrator_perspective": "",
    "opening_situation": "",
    "conflict": "",
    "transformation": "",
    "resolution": "",
    "primary_themes": [],
    "secondary_themes": [],
    "incidental_mentions": [],
    "negated_events": [],
    "biblical_parallels": [
      {"reference": "", "kind": "explicit_or_inferred"}
    ]
  },
  "stanzas": [
    {
      "stanza_index": 0,
      "semantic_role": "",
      "summary": "",
      "evidence_line_ids": []
    }
  ]
}
```

Este exemplo é **schema**, não análise factual de qualquer hino. Salvar identificadores e localizações, não a letra em duplicidade. Verificar integridade: `lyrics_sha256`, revisão, origem, escala de índices, comprimento e tipo de campos, unicidade de IDs. Não usar perfil cuja impressão digital não corresponda à importação. Hinos de outras edições e importações particulares continuam pesquisáveis sem perfil; sua análise pode ser realizada em momento posterior ou sob demanda, com indicação do nível de confiança.

### 3.3 Geração/validação de perfis

- O gerador deve receber a **letra integral, com estrofes preservadas**, e produzir JSON de schema estrito; preferir pré-cálculo em ambiente autorizado à custosa análise inicial em aparelhos modestos.
- É aceitável empregar um modelo de análise mais forte **fora do APK** para produção inicial de metadados, observando direitos/licenças e confidencialidade do texto; não enviar letras a serviços externos sem autorização/licença compatível.
- A qualidade deve ser auditada por comparação com a letra: detectar perspectiva, negação, mudança de sujeito, narração em primeira pessoa, final diferente do tema da introdução, refrão e alusões bíblicas indevidas.
- Testar a hipótese `perfil_global + E5` *contra* `E5 somente nas estrofes` com o mesmo catálogo e consultas. Não assumir que todos os resumos produzidos pelo modelo estão corretos.
- Empacotamento de índices somente com metadados/embeddings e hashes, respeitando regras de licenciamento já existentes. Se algum perfil puder reproduzir substancialmente a letra, reter fora do APK até revisão.

### 3.4 Recuperação, fusão, reranking e verificação

- Recuperar da **coleção inteira**, não de `state.lastResults` ou `pageSize`. Usar união de posições dos múltiplos mecanismos; evitar que baseline com peso maior limite o conjunto semântico, mas preservar busca por número e títulos inequívocos.
- Reclassificação em duas etapas: (A) filtro/score barato sobre perfis globais; (B) leitura da letra integral e julgamento de poucos finalistas pelo LFM3. Não mandar múltiplas letras grandes no mesmo prompt sem orçamento demonstrado.
- Ranking final deve distinguir **mensagem principal**, **analogia contextual válida**, **tema secundário** e **coincidência incidental**. Considerar a narrativa inteira, inclusive conclusão, sem exigir palavras idênticas à consulta.
- E5 cosseno e pontuações heurísticas **não são probabilidades**. Preferir ordenação, classes de relevância e justificativas curtas rastreáveis.
- Validação determinística de IDs, `evidence_line_ids`, hash, referências e saída JSON. Na ausência de IA, usar busca existente e sinalizar de maneira explícita que não houve julgamento integral pelo modelo.
- Proteger contra prompt injection via letras/perfis: conteúdo recuperado é **dado não confiável** e não deve autorizar novos comportamentos nem comandos.

### 3.5 Ferramentas locais controladas — etapa posterior

Propostas de funções de aplicação (contratos mínimos e resposta tipada):

- `search_hymns(query, filters, limit)`: IDs/candidatos e metadados de sinais, sem escopo arbitrário de acesso.
- `get_hymn_profile(hymn_id)`: perfil/hashes/status.
- `get_hymn_full_lyrics(hymn_id)`: texto completo, estrofes e índices a partir da biblioteca importada.
- `get_bible_context(reference)`: texto/estrutura da Bíblia local, se disponível.
- `submit_relevance_judgment(hymn_id, decision, evidence_ids, reason)`: proposta a ser validada pelo host; **não** escrita direta no banco por IA.

Projetar allowlist, quantidade máxima de chamadas, cancelamento, limite de bytes/tokens e fallback. A Liquid AI documenta formato de `tool_calls` e chat template; o código JNI atual chama `llama_chat_apply_template` para **apenas uma mensagem user**, sem ferramentas reais. Antes de ativar, testar o chat template embutido na versão GGUF **efetivamente selecionada** e o parser nativo `llama.cpp`. Um formato JSON/GBNF restrito também é aceitável se funcionar melhor; não presumir compatibilidade por nome da família do modelo. **MCP não é requisito.**

### 3.6 Orçamento de recursos Android

- O `n_ctx=1280` e a rejeição acima de 1000 tokens impedem análise direta de várias letras integrais. Estudar contextos 2048/4096/8192 **como hipóteses** com prefill, primeiro token, decode tok/s, pico de RSS, bateria e temperatura medidos no ARM64 físico. Não ativar aumento global sem RAM/latência satisfatórias.
- Manter modelo GGUF escolhido externamente pelo usuário, **não** embutido no APK.
- Diferenciar reutilização do objeto `llama_context` (já existente) de **reuso de KV/prefixo**, que o código atual não pratica ao limpar memória a cada geração. Implementar só após verificar consistência/segurança da arquitetura do LFM3.
- Permitir cancelamento cooperativo, timeout por fase e progresso, não bloquear consulta E5 nem UI, e fallback sem GGUF. Capturar métricas sem armazenar letras ou prompts.

## 4. Validação independente

### 4.1 Gabarito humano

A issue #25 é dependência direta: revisar pelo texto completo os 19 alertas e as consultas existentes; amostrar candidatos **fora do top10** para avaliar falsos negativos; ampliar progressivamente para **>=100 consultas distintas** (tema, história, referência, paráfrase, perspectiva, negação, temas múltiplos, controle numérico e título). Anotar relevância 0/1/2/3 com evidência identificada por linha/estrofe, sem transcrever a letra em relatório.

**Rótulos de IA não equivalem a gabarito humano.** Separar desenvolvimento e conjunto independente oculto; evitar overfitting em Filho Pródigo, Mulher do fluxo de sangue ou qualquer hino específico.

### 4.2 Métricas e gates

Medir antes/depois nas mesmas consultas, mesmo catálogo e versões dos recursos:

- Recall@20 e **Recall@50** da recuperação ampla, MRR@20, nDCG@5/nDCG@10, Precision@5, falsos positivos no top5 e relevância contextual 0–3.
- Relatar posições e casos que pioraram (inclusive top1), ablações `E5-off`, `E5-on`, `global-off`, `global-on`, `LFM3-off`, `LFM3-on`, e regressões de busca por número/título e repertório.
- Métricas de tempo/uso de memória na máquina de CI **separadas** de aparelho ARM64 físico.
- **Primeiro PoC:** não reduzir Recall@50 vs. controle; demonstrar menor incidência de correspondência meramente lexical e melhora em métrica de ranking em holdout, sem alegar significância estatística sem dados suficientes. Se resultado for inconclusivo, manter o recurso experimental desligado e investigar.

**Invariantes obrigatórios:** todos agentes existentes, agente 8 independente, agente 9 E5, cobertura de letras integrais, Android offline instrumentado, auditoria de APK/assinatura/SHA/ABIs. Nunca remover testes ou relaxar gate para passar.

### 4.3 Casos adversariais obrigatórios

- "Filho Pródigo" vs. hino que só menciona pai/filho; perspectiva do filho em primeira pessoa vs. relato externo.
- "Mulher com fluxo de sangue" vs. hinos sobre sangue da cruz; ação/atores do episódio e analogias legítimas.
- Hino cujo sentido na última estrofe modifica a situação do início.
- Termos presentes em negação ("não abandonarei") que não caracterizam abandono realizado.
- Tema apenas no refrão, metáfora, mudança de narrador, tema secundário vs. central.
- Consulta sem palavras em comum, mas com correspondência contextual verdadeira; número e título exatos.
- Importação nova, letra alterada, impressão digital inválida, perfil ausente, GGUF desconectado e timeout.

Nenhum caso pode gerar tratamento especial codificado por ID ou palavras do teste.

## 5. Plano por etapas e entregáveis

| Fase | Implementação | Entrega/condição |
|---|---|---|
| **P0 — baseline** | coletar CI/versão/latência e preparar revisões humanas (issue #25) | baseline reproduzível, separar treino/holdout; não inventar julgamento humano |
| **P1 — PRÓXIMA IMPLEMENTAÇÃO** | schema do perfil completo, extrator/validador e protótipo em **amostra diversificada** com corpus licenciado | JSONs sem letras, evidências verificáveis, testes de negacão/perspectiva/desfecho, comparação `perfil vs. atual` sem mudar o ranking padrão |
| P2 — recuperação ampla | E5-perfil global, E5-estrofes, lexical/Bíblia/eventos e união de candidatos **independente da UI** | Recall@50 e ablações auditados; filtros e fallbacks intactos |
| P3 — reranking | reclassificação contextual com verificação integral dos finalistas, evidências válidas e status de verificação | top5 com revisão de letra; regressões e UX medidas |
| P4 — tool calling local | orquestrador de funções + JNI/template/JSON restrito, limitação de chamadas e cancelamento | testes com o GGUF real; nenhuma dependência MCP ou rede |
| P5 — otimização | contexto, cache e desempenho ARM64 | benchmark físico + fallback seguro |
| P6 — rollout completo | perfis de toda biblioteca compatível e benchmark humano >=100 | decisão baseada em métricas independentes, aprovação final |

**Regra de implementação:** executar **uma fase funcional por APK** distinto, com `versionCode` crescente, auditoria do pacote **com E5 ONNX e GGUF engine ARM64**, CI completo e relatório simples + completo. A fase P1 pode começar por experimentos fora do APK para escolher schema; isso **não é** uma versão funcional entregue. Seguir o AGENTS.md para cada mudança funcional, não mesclar automaticamente.

### Instrução direta ao próximo Codex

1. **Abrir [issue #58](https://github.com/pabloerlis/Buscador-de-Hinos/issues/58) e este documento; começar exclusivamente por P0/P1.** Não iniciar migração SQLite, MCP, ajuste de pesos às cegas ou múltiplos módulos simultaneamente.
2. Consultar a `main` vigente, confirmar código e integridade dos recursos, manter branch/PR separados em draft. Registrar SHA inicial; antes de codificar, definir schema e conjunto de teste.
3. Ao concluir cada implementação: agentes independentes + emulador offline + auditoria binária + APK real acessível ao usuário (quando houver mudança no aplicativo), métricas/limitações documentadas e a próxima tarefa explicitada no GitHub.

## 6. Fontes técnicas — inspiração, não prova no catálogo

- [Anthropic — Contextual Retrieval](https://www.anthropic.com/research/contextual-retrieval): contextualizar chunks antes de embeddings/BM25; redução de falha de recuperação de **49%** sem reranking e **67%** com reranking nos testes deles, **não extrapolar** ao projeto.
- [Microsoft Azure — Semantic Ranker](https://learn.microsoft.com/en-us/azure/search/semantic-search-overview): reranking de até **50** primeiros candidatos da etapa de recuperação.
- [Liquid AI — LFM3-1.7B](https://huggingface.co/LiquidAI/LFM3-1.7B) e [chat template](https://huggingface.co/LiquidAI/LFM3-1.7B/blob/main/chat_template.jinja): modelo local, formatos de ferramentas/saídas; verificar GGUF real.
- [llama.cpp — Android](https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md): limites e memória para contexto no dispositivo.
- [llama.cpp — prompt cache](https://github.com/ggml-org/llama.cpp/blob/master/tools/completion/README.md): referência de mecanismos de cache, a **adaptar e comprovar** para nosso JNI.
