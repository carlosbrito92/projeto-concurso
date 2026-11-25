-- Índices de cobertura para chaves estrangeiras (advisor 0001_unindexed_foreign_keys): joins e DELETE em cascata sem varredura completa.
create index item_edital_pai_idx         on public.item_edital (concurso_slug, pai);
create index prova_concurso_idx          on public.prova (concurso_slug);
create index questao_prova_idx           on public.questao (prova_slug);
create index simulado_concurso_idx       on public.simulado (concurso_slug);
create index simulado_item_questao_idx   on public.simulado_item (questao_id);
create index usuario_concurso_concurso_idx on public.usuario_concurso (concurso_slug);
