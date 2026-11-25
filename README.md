# Concurso Engine

Plataforma para concurseiros gerarem provas de estudo, responderem e receberem um relatório estatístico com os pontos fracos.

Piloto: Polícia Civil × FGV. Veja [`CLAUDE.md`](CLAUDE.md) para stack, fluxo de conteúdo (PDF → MD → JSON) e regras do projeto.

## Estrutura

```
conteudo/concursos/<slug>/{00-origem,01-md,02-json}   fonte da verdade do conteúdo
schemas/                                              JSON Schemas versionados
pipeline/                                             scripts Python (build e validação)
packages/engine/                                      motor TS (seleção, correção, relatório)
apps/web/                                             Next.js + Clerk
supabase/migrations/                                  banco e RLS
```
