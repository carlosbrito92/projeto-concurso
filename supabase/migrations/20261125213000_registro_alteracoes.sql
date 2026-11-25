-- Registro de alterações do produto: o aluno lê (somente leitura); só o servidor escreve; nada é editado nem apagado depois.
-- Texto voltado ao aluno: nunca inclui enunciado, gabarito nem a justificativa interna dos reportes.

create table public.registro_alteracao (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  tipo          text not null check (tipo in ('novidade', 'conteudo', 'correcao', 'questao_retirada')),
  titulo        text not null check (length(btrim(titulo)) between 3 and 120),
  resumo        text check (length(resumo) <= 1000),
  concurso_slug text,                       -- sem FK de propósito: o registro é histórico e não pode ser alterado por cascata
  questao_id    text,                       -- interno (auditoria do administrador); não exposto ao aluno
  autor         text                        -- interno: quem publicou (ID do Clerk) ou 'sistema'
);
create index registro_alteracao_criado_idx on public.registro_alteracao (criado_em desc);

alter table public.registro_alteracao enable row level security;
create policy registro_leitura on public.registro_alteracao for select to authenticated using (true);

revoke all on public.registro_alteracao from anon, authenticated;
grant select (id, criado_em, tipo, titulo, resumo, concurso_slug) on public.registro_alteracao to authenticated;
-- INSERT só pelo servidor (service_role); ninguém altera ou apaga:
create function public.registro_imutavel() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'registro_alteracao é imutável (somente inclusão)';
end $$;
create trigger registro_alteracao_imutavel before update or delete on public.registro_alteracao
  for each row execute function public.registro_imutavel();
create trigger registro_alteracao_sem_truncate before truncate on public.registro_alteracao
  for each statement execute function public.registro_imutavel();

-- Retirar uma questão agora também publica uma entrada genérica no registro (sem a justificativa interna).
create or replace function public.resolver_reporte(p_id bigint, p_resolucao text, p_justificativa text, p_admin text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_questao text;
  v_texto   text := btrim(coalesce(p_justificativa, ''));
  v_n       integer;
  v_q       record;
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
    get diagnostics v_n = row_count;
    select concurso_slug, banca, ano, numero_na_prova into v_q from public.questao where id = v_questao;
    insert into public.registro_alteracao (tipo, titulo, resumo, concurso_slug, questao_id, autor)
    values ('questao_retirada', 'Questão retirada após revisão',
            'Uma questão ' || coalesce('da prova ' || nullif(btrim(concat_ws(' ', v_q.banca, v_q.ano::text)), ''), 'de prova anterior')
              || coalesce(' (nº ' || v_q.numero_na_prova::text || ')', '')
              || ' foi retirada dos novos simulados depois de um reporte. Simulados já feitos não mudam.',
            v_q.concurso_slug, v_questao, p_admin);
  else
    update public.reporte_questao
       set resolvido_em = now(), resolucao = p_resolucao, justificativa = v_texto, resolvido_por = p_admin
     where id = p_id and resolvido_em is null;
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end $$;

-- Histórico inicial (fatos já ocorridos no produto).
insert into public.registro_alteracao (tipo, titulo, resumo, autor) values
  ('novidade', 'Simulados com correção e relatório por assunto', 'Monte um simulado na proporção do edital, responda e veja o relatório com os assuntos em que você mais perde pontos.', 'sistema'),
  ('conteudo', 'Conteúdo inicial: 4 concursos e 4 provas anteriores', 'Editais e provas de PC-MG (FGV 2024 e FUMARC 2014), PC-MA (FGV 2012) e PC-AM (FGV 2021) para Investigador. Provas antigas mostram aviso de vigência da legislação.', 'sistema'),
  ('novidade', 'Reportar problema em uma questão', 'Durante a prova, use "Reportar problema nesta questão" para apontar gabarito, enunciado, assunto ou vigência. Cada reporte é revisado.', 'sistema'),
  ('novidade', 'Registro de alterações', 'Esta página mostra o que muda no produto e no conteúdo. Ela é somente leitura e nunca é editada depois de publicada.', 'sistema');
