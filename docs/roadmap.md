# Roadmap de funcionalidades

## F-001 — Cadastro e importação de novas letras

**Status:** planejado, não implementado.
**Solicitação:** 24/11/2026.
**Dependência:** integração e validação do motor Harrier no Android.

### Requisitos

- Disponibilizar área de gerenciamento da biblioteca para cadastrar letras por texto livre (digitação ou colagem) ou importar arquivos de texto, inicialmente TXT UTF-8, sem excluir a importação JSON existente.
- Converter automaticamente a entrada para o formato interno do catálogo, preservando acentos, parágrafos, estrofes e refrões.
- Permitir revisar título, número opcional, coleção e letra antes de salvar; não inventar metadados ausentes. Identificar duplicatas e oferecer decisão explícita sobre atualização quando pertinente.
- Permitir editar e excluir registros pessoais; preservar referências e coleções originais. Não sobrescrever silenciosamente conteúdo da biblioteca.
- Atualizar imediatamente os índices lexical, temático e narrativo, bem como a busca e recomendações.
- Calcular embeddings Harrier somente para letras novas ou modificadas, usando o mesmo modelo, versão, tokenização, segmentação e normalização da base principal. Manter fila persistente de indexação, com progresso e recuperação após interrupção; não bloquear a busca convencional se o modelo não estiver instalado.
- Persistir letras e vetores incrementais no armazenamento local, fora do APK. Planejar banco transacional (SQLite ou solução equivalente após análise); permitir backup/restauração sem duplicatas.
- Consultar conjuntamente a base pré-calculada versionada no repositório e os vetores pessoais. Identificar vetores por fingerprint e revisão do modelo. Invalidar apenas registros afetados por edição/exclusão, nunca misturar espaços vetoriais incompatíveis.
- Não exigir recompilação, conexão à internet ou atualização dos pesos para incluir letras depois de instalado o modelo. Não enviar letras pessoais ao repositório ou a serviços externos automaticamente.

### Critérios de aceite

1. Cadastrar por texto livre e importar TXT; visualizar e revisar resultado antes de salvar.
2. Confirmar busca textual imediata e busca vetorial após indexação; testar com e sem pacote Harrier instalado.
3. Editar letra e confirmar reindexação somente do registro alterado; excluir e confirmar ausência na busca.
4. Tratar entrada vazia, codificação inválida, duplicatas, falha de inferência, interrupção do aplicativo e restauração de backup.
5. Preservar biblioteca, dicionário pessoal e configurações existentes; executar todos os gates de qualidade do projeto.

Formatos adicionais e fluxo de interface serão definidos em etapa própria. Nenhuma funcionalidade deste item é entregue por este registro de planejamento.
