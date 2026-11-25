-- Reportes de questão: resolução pelo administrador (justificar ou retirar a questão).
-- O aluno cria o reporte (política existente) e só vê os próprios, sem a resposta do administrador.
-- Quem resolve é o servidor, com a chave secreta, pela função abaixo; não há política para o navegador resolver.

alter table public.reporte_questao
  add column resolucao     text check (resolucao in ('justificado', 'questao_retirada')),
  add column justificativa text check (length(justificativa) <= 2000),
  add column resolvido_por text,
  add constraint reporte_resolucao_coerente check (
    (resolvido_em is null and resolucao is null and justificativa is null and resolvido_por is null)
    or (resolvido_em is not null and resolucao is not null and justificativa is not null and resolvido_por is not null)
  );

-- No máximo um reporte aberto por aluno, questão e motivo (duplo clique ou reenvio não vira fila de repetidos).
create unique index reporte_aberto_unico on public.reporte_questao (usuario_id, questao_id, motivo) where resolvido_em is null;
-- Fila do administrador: abertos, mais antigos primeiro.
create index reporte_abertos_idx on public.reporte_questao (criado_em) where resolvido_em is null;

-- O aluno enxerga o próprio reporte e se foi tratado (resolvido_em), mas não a justificativa nem quem resolveu.
revoke select on public.reporte_questao from authenticated;
grant select (id, usuario_id, questao_id, motivo, texto, criado_em, resolvido_em) on public.reporte_questao to authenticated;

-- Resolve um reporte. 'questao_retirada' também inativa a questão e fecha os demais reportes abertos dela, na mesma transação.
-- Devolve quantos reportes foram fechados (0 = já estava resolvido ou não existe).
create function public.resolver_reporte(p_id bigint, p_resolucao text, p_justificativa text, p_admin text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_questao text;
  v_texto   text := btrim(coalesce(p_justificativa, ''));
  v_n       integer;
begin
  if p_resolucao is null or p_resolucao not in ('justificado', 'questao_retirada') then
    raise exception 'resolucao invalida';
  end if;
  if p_admin is null or p_admin = '' then
    raise exception 'administrador obrigatorio';
  end if;
  if length(v_texto) < 3 or length(v_texto) > 2000 then
    raise exception 'justificativa deve ter de 3 a 2000 caracteres';
  end if;

  select questao_id into v_questao from public.reporte_questao where id = p_id and resolvido_em is null for update;
  if v_questao is null then
    return 0;
  end if;

  if p_resolucao = 'questao_retirada' then
    update public.questao set status = 'inativa' where id = v_questao;
    update public.reporte_questao
       set resolvido_em = now(), resolucao = p_resolucao, justificativa = v_texto, resolvido_por = p_admin
     where questao_id = v_questao and resolvido_em is null;
  else
    update public.reporte_questao
       set resolvido_em = now(), resolucao = p_resolucao, justificativa = v_texto, resolvido_por = p_admin
     where id = p_id and resolvido_em is null;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.resolver_reporte(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.resolver_reporte(bigint, text, text, text) to service_role;
