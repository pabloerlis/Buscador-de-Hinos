# P4 piloto — Chat com ferramentas locais GGUF (v2.6.30)

## Contrato implementado

- Duas abas: Pesquisa existente (inalterada) e Chat com IA.
- O LFM3 primeiro seleciona **exatamente uma** ação entre BUSCAR, LER, BIBLIA e CONVERSAR por gramática GBNF fixa; o JavaScript valida a resposta e executa somente endpoints locais da allowlist.
- Ferramentas reais: `search_hymns` (`/api/contextual/candidates`, preserva filtros e ranking basal), `get_hymn_full_lyrics` (`/api/hymns/:id`, validando ID), `get_bible_context` (`/api/bible/context`, Bíblia Livre local). Nenhum acesso à rede, escrita direta no repertório ou ferramenta arbitrária.
- Uma segunda inferência do GGUF redige a resposta em português com diálogo recente, preferências explicitadas pelo usuário e evidências locais; limite de tokens/tempo e cancelamento. Histórico apenas em memória de sessão, não exportado.
- Painel Atividade da IA exibe ação escolhida, chamadas, quantidades e duração, sem revelar texto integral nem raciocínio privado.
- A resposta não deve declarar um hino verificado integralmente se o texto excedeu o orçamento; a ferramenta consulta a letra inteira no dispositivo, mas o LFM3 recebe no máximo trechos do início, meio e fim. Essa limitação é exposta ao usuário.
- Sem integração MCP; mantém JNI GGUF e seus limites atuais. Modelo GGUF permanece externo, selecionado pelo usuário; busca tradicional continua offline sem modelo.

## Limites conhecidos

- Não há ainda perfis semânticos globais revisados nem reranker P3 por mensagem completa; o roteador de ferramentas é experimental. A qualidade da conversa com LFM3-1.7B Q4 depende de latência e do formato de resposta real no aparelho.
- O roteador escolhe entre **uma** ferramenta por turno; não há múltiplas chamadas encadeadas pelo modelo. A consulta utiliza contexto recente e memória breve de preferências, sem armazenamento persistente.
- `n_ctx=1280`, prompts limitados por tamanho, resposta em até 100 tokens e timeout de geração; possível erro se modelo selecionado não respeitar GBNF ou exceder orçamento.
- Benchmarks no emulador x86_64 são obrigatórios antes do APK QA; teste de percepção e latência no ARM64 físico permanece pendente. IA desativada ou não carregada mantém a busca acessível.

## QA de segurança

- Testes cobrem decisões fora da allowlist, argumentos de ID, retorno não verificado, filtros de coleção, consulta bíblica, memória explícita, links de interface, cancelamento, ausência de chamadas externas e limite de trechos.
- CI integra todos os gates antigos, incluindo agente 8 revisão independente, agente 9 busca semântica, agente 11 letras completas e agente 12 execução GGUF real.

**Próximo marco:** perfis globais P1 validados por humanos, recuperação E5 desses perfis e reranking P3 com verificação original da letra completa, só ativar padrão depois de Recall@50, P@5 e nDCG@5 auditados.