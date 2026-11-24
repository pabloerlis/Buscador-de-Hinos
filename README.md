# Buscador de Hinos — Android 2.8.2

Aplicativo para pesquisa de hinos por letra, tema, número e contexto bíblico. Após importar as coleções, os mecanismos principais funcionam inteiramente offline, sem modelos de linguagem generativos.

## Recursos

- Busca literal, lexical, temática e narrativa; referências e grafo bíblico.
- OpenWordnet-PT 1.0.0: 26.129 termos, 15.372 grupos de sinônimos; licença CC BY 4.0 (ver docs/lexical-pt.md).
- Filtros de palavras obrigatórias, proibidas e preferenciais; opção de sinônimos e escopo individual; evidência destacada na letra.
- Dicionário pessoal, narrativas, associações, sinônimos e backup JSON.
- Repertório aprendido, comparação determinística de resultados, recomendações de hinos semelhantes.
- Cinco paletas, modo claro/escuro/sistema, animações configuráveis e fonte ajustável no leitor.

## Compilação

JDK 17, Android SDK 35, Gradle 8.9. Gerar os índices antes de compilar:

```sh
python3 scripts/build_scripture_index.py
python3 scripts/build_bible_graph.py
python3 scripts/build_lexical_pt.py
gradle assembleDebug
```

E5 Small é opcional: apenas embeddings, sem geração de texto. Exige os assets gerados por scripts/build_e5_assets.py e compilação com `-PenableEmbeddings=true`. Não é incluído no APK padrão.

## Qualidade e dados

O GitHub Actions executa os cinco gates descritos em AGENTS.md. Os índices são licenciados e validados. O APK não inclui letras da coletânea nem modelos opcionais. Faça backup dos dados pessoais antes de trocar uma instalação incompatível. Afinidade é uma pontuação heurística, não uma avaliação doutrinária oficial.
