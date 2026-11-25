-- Área do concurso (segurança pública, justiça, fiscal...): agrupa o seletor de concursos no app.
-- O rótulo de cada área fica no app; aqui só o identificador (slug), para novas áreas não exigirem migração.
alter table public.concurso
  add column area text not null default 'outras' check (area ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Os 4 concursos já carregados (Investigador de Polícia).
update public.concurso set area = 'seguranca-publica'
 where slug in ('pc-mg-fgv-2024', 'pc-mg-fumarc-2014', 'pc-ma-fgv-2012', 'pc-am-fgv-2021');
