-- Pontuação com desconto por erro (Quadrix, Cebraspe: certo +1, errado -1, branco 0) e módulo "complementares".

alter table public.concurso
  add column pontos_por_erro         numeric not null default 0 check (pontos_por_erro <= 0),
  add column nota_minima_por_modulo  jsonb check (nota_minima_por_modulo is null or jsonb_typeof(nota_minima_por_modulo) = 'object');

alter table public.disciplina drop constraint disciplina_modulo_check;
alter table public.disciplina add constraint disciplina_modulo_check check (modulo in ('basicos', 'complementares', 'especificos'));
