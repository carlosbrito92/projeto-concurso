# CLAUDE.md — Concurso Engine

Plataforma **comercial** em que o concurseiro gera provas de estudo, responde, e recebe um relatório estatístico de acertos e erros com indicação de onde focar. Acesso de qualquer dispositivo (web responsiva).

> Princípio de projeto: **o ativo principal não é a questão, é o conhecimento estruturado e citável.** A questão é uma representação temporária dele. Toda questão aponta para uma fonte verificável.

## Estado atual

Piloto: **Polícia Civil de Minas Gerais × FGV**, Edital nº 04/2024, cargo **Investigador de Polícia I** (slug `pc-mg-fgv-2024`). Prova de 70 questões objetivas A–E, 1 ponto cada, mínimo de 35 acertos (edital item 4.1.5 a 4.1.7).

Feito no piloto:
- `01-md/edital-04-2024.md`: edital completo em Markdown, com `<!-- p.N -->` por página (N = página do PDF).
- `02-json/edital.json`: estrutura do Anexo I (12 disciplinas, 339 itens, pesos pelo nº de questões), validada por `schemas/edital.schema.json`.

Pendente: páginas com possível tabela (29, 30, 53, 55, 56, 57) ainda precisam de revisão manual no MD. Próximas fontes: texto das leis citadas no Anexo I, provas anteriores da FGV/PCMG e perfil da banca.

Comandos (a partir da raiz):
```bash
python3 -I pipeline/pdf_para_md.py conteudo/concursos/<slug>/00-origem/<edital>.pdf conteudo/concursos/<slug>/01-md/<edital>.md
python3 -I pipeline/edital_para_json.py conteudo/concursos/<slug>
```

## Stack

| Camada | Escolha | Observação |
|---|---|---|
| Web | Next.js (App Router) + TypeScript | `apps/web` |
| Auth | **Clerk** | IDs de usuário são **texto** (`user_...`), nunca `uuid` |
| Banco | Supabase (Postgres + RLS) | `supabase/migrations` |
| Deploy | Vercel | |
| Motor | TypeScript puro, sem DOM | `packages/engine`; roda no servidor e no cliente |
| Pipeline de conteúdo | Python ≥ 3.10 + `jsonschema` | `pipeline/`, roda na máquina do autor/CI |

**Clerk + Supabase:** usar a integração de *third-party auth* (JWT do Clerk validado pelo Supabase). As políticas RLS comparam `auth.jwt()->>'sub'` com a coluna `usuario_id text`. Não usar a service role no cliente, nunca.

## Fluxo de conteúdo (o coração do projeto)

```
PDF (edital / prova / lei)  ──►  .md  ──►  .json (schema)  ──►  Postgres
   00-origem/                  01-md/        02-json/            seed
```

Cada concurso vive em `conteudo/concursos/<slug>/` (ex.: `pc-<uf>-fgv-<ano>`), copiando `_modelo/`.

1. **PDF → MD.** Limpeza fiel, sem resumir. Preservar numeração de itens do edital, tabelas e páginas (`<!-- p.12 -->`). Registrar o que não foi legível; nunca preencher o que não leu.
2. **MD → JSON.** Extrair (a) a **estrutura do edital** (disciplina → assunto → item) e (b) **conhecimentos atômicos** e **questões**, sempre contra `schemas/*.schema.json`.
3. **JSON → banco.** Script de `seed` idempotente. O JSON no Git é a fonte da verdade auditável; o banco é cópia servida.

Regras do pipeline:
- **PDFs não vão para o Git** (`00-origem/` é ignorado). Fica registrado só o `sha256`, o nome e a página em `manifest.json`.
- Todo JSON tem `schemaVersion`. Mudou o schema, sobe a versão e migra.
- Cada script de build **valida e sai com código ≠ 0** se algo estiver inconsistente (ids únicos, referências existentes, gabarito coerente com as afirmações).
- Rastreabilidade ponta a ponta: `questão → conhecimento → fonte (arquivo, página, trecho literal)`.
- **Nunca inventar** lei, artigo, súmula, prazo ou data. Sem fonte, o campo é `null` e o item fica `status: "rascunho"`.
- Trecho literal de fonte: curto (≤ 25 palavras). Lei e jurisprudência são fonte preferencial (texto público).

## Dois tipos de questão

| `origem.tipo` | O que é | Cuidado |
|---|---|---|
| `prova_real` | Questão de prova anterior (FGV etc.) | Direito autoral. Nasce com `direitos.status = "pendente_juridico"` e **não é publicada** até virar `liberada`. |
| `autoral_ia` | Gerada por IA a partir de conhecimentos do edital | Nasce `revisao.status = "automatico"`. Só vai ao aluno após validação (abaixo). |

Questão de IA só é publicada se: tem `fundamentacao` com fonte real e vigente; o gabarito foi conferido contra a fonte; um humano revisou (`revisao.status = "revisado"`). **A IA não pode ser a única verificadora do gabarito.**

Questão anulada ou com gabarito alterado: `anulada: true`, fora da geração de provas e fora das estatísticas.

## Estilo da banca (FGV)

Cada banca tem um **perfil** em `conteudo/bancas/<banca>.json` (formato, nº de alternativas, penalização, tempo médio, estilos de enunciado). FGV: múltipla escolha A–E, enunciados longos e situacionais, assertivas "I, II, III" combinadas, forte uso de texto de lei e jurisprudência. A geração por IA deve imitar o **estilo**, jamais copiar enunciados reais.

## Modelo de dados (resumo)

`Carreira → Concurso → Disciplina → Assunto → Conhecimento → Questão`

- **Conhecimento:** regra atômica citável (artigo, súmula, conceito). Tem `vigenteEm` e status (`vigente`, `superado`, `revogado`).
- **Simulado:** snapshot imutável (copia as questões, ordem e alternativas embaralhadas). Editar a questão depois não altera o histórico do aluno.
- **Resposta:** `usuario_id`, `simulado_id`, `questao_id`, `resposta`, `acertou`, `tempo_ms`, `marcou_chute`, `em`.
- **Relatório:** acerto por disciplina/assunto/banca, tempo, evolução, caderno de erros, revisão espaçada, prioridades ponderadas pelo peso do assunto no edital.

## Regras de código

- **Correção no servidor.** O gabarito nunca vai ao navegador antes de a resposta ser enviada.
- Motor (`packages/engine`) sem DOM e sem I/O. Seleção determinística por semente; testes obrigatórios.
- RLS ligada em toda tabela com dado de usuário. Toda migração nova é revisada com os advisors do Supabase.
- Segredos só em variáveis de ambiente (Vercel/Supabase/Clerk). Nunca em Git.
- Dados pessoais de aluno: coletar o mínimo (LGPD). Estatísticas só do próprio usuário.
- IDs de conteúdo são estáveis: **não renumerar**; só acrescentar.
- Ao mexer em schema, atualizar validador, `seed`, migração e testes na mesma mudança.

## Idioma

Código, nomes de campo e commits: o que o autor já usa (campos em português no JSON, identificadores de código em inglês quando for lib/infra). Textos de interface e conteúdo: **português do Brasil**.

## Origem

Arquitetura inspirada em um projeto anterior do autor, de outro contexto. **Nenhum conteúdo, dado ou arquivo de outros projetos ou empregadores entra neste repositório.**
