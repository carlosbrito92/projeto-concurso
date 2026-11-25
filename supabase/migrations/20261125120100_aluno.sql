-- Dados do aluno. Identidade vem do JWT do Clerk (third-party auth): claim `sub` = id do usuário (texto, nunca uuid).
-- O aluno LÊ o que é dele; quem cria simulado, corrige e gera relatório é o servidor (service_role).

create function public.usuario_atual() returns text
language sql stable set search_path = '' as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

create table public.usuario_concurso (
  usuario_id    text not null default public.usuario_atual(),
  concurso_slug text not null references public.concurso (slug) on delete cascade,
  criado_em     timestamptz not null default now(),
  primary key (usuario_id, concurso_slug)
);

create table public.simulado (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    text not null,
  concurso_slug text not null references public.concurso (slug),
  seed          text not null,
  modo          text not null default 'misto' check (modo in ('misto', 'disciplina', 'revisao')),
  status        text not null default 'em_andamento' check (status in ('em_andamento', 'finalizado', 'abandonado')),
  config        jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  finalizado_em timestamptz,
  constraint simulado_finalizado_tem_data check ((status = 'finalizado') = (finalizado_em is not null))
);
create index simulado_usuario_idx on public.simulado (usuario_id, criado_em desc);

-- O que o navegador recebe de cada questão (payload = saída de paraCliente do motor: sem gabarito).
create table public.simulado_item (
  simulado_id uuid not null references public.simulado (id) on delete cascade,
  posicao     smallint not null check (posicao > 0),
  questao_id  text not null references public.questao (id),
  peso        numeric not null default 1,
  ordem       smallint[] not null,
  payload     jsonb not null,
  primary key (simulado_id, posicao)
);

-- Snapshot completo (COM gabarito) e letra correta: só servidor.
create table public.simulado_gabarito (
  simulado_id   uuid not null,
  posicao       smallint not null,
  letra_correta char(1) not null check (letra_correta in ('A', 'B', 'C', 'D', 'E')),
  snapshot      jsonb not null,
  primary key (simulado_id, posicao),
  foreign key (simulado_id, posicao) references public.simulado_item (simulado_id, posicao) on delete cascade
);

create table public.resposta (
  simulado_id  uuid not null,
  posicao      smallint not null,
  letra        char(1) check (letra in ('A', 'B', 'C', 'D', 'E')),
  tempo_ms     integer check (tempo_ms >= 0),
  chute        boolean not null default false,
  respondida_em timestamptz not null default now(),
  -- Preenchidos SÓ pelo servidor ao finalizar (o aluno não tem privilégio de coluna sobre eles):
  acertou      boolean,
  pontos       numeric,
  primary key (simulado_id, posicao),
  foreign key (simulado_id, posicao) references public.simulado_item (simulado_id, posicao) on delete cascade
);

create table public.relatorio_simulado (
  simulado_id uuid primary key references public.simulado (id) on delete cascade,
  gerado_em   timestamptz not null default now(),
  conteudo    jsonb not null
);

-- Denúncia de problema numa questão (gabarito, enunciado, assunto, vigência...). Alimenta a revisão humana.
create table public.reporte_questao (
  id           bigint generated always as identity primary key,
  usuario_id   text not null default public.usuario_atual(),
  questao_id   text not null references public.questao (id) on delete cascade,
  motivo       text not null check (motivo in ('gabarito', 'enunciado', 'assunto', 'vigencia', 'imagem', 'outro')),
  texto        text check (length(texto) <= 2000),
  criado_em    timestamptz not null default now(),
  resolvido_em timestamptz
);
create index reporte_questao_idx on public.reporte_questao (questao_id);

alter table public.usuario_concurso   enable row level security;
alter table public.simulado           enable row level security;
alter table public.simulado_item      enable row level security;
alter table public.simulado_gabarito  enable row level security;
alter table public.resposta           enable row level security;
alter table public.relatorio_simulado enable row level security;
alter table public.reporte_questao    enable row level security;

-- (select public.usuario_atual()) em vez da chamada direta: o planejador avalia uma vez por consulta.
create policy usuario_concurso_proprio on public.usuario_concurso for all to authenticated
  using (usuario_id = (select public.usuario_atual())) with check (usuario_id = (select public.usuario_atual()));

create policy simulado_leitura on public.simulado for select to authenticated
  using (usuario_id = (select public.usuario_atual()));

create policy simulado_item_leitura on public.simulado_item for select to authenticated
  using (exists (select 1 from public.simulado s where s.id = simulado_id and s.usuario_id = (select public.usuario_atual())));

-- simulado_gabarito: nenhuma política (servidor apenas).

create policy resposta_leitura on public.resposta for select to authenticated
  using (exists (select 1 from public.simulado s where s.id = simulado_id and s.usuario_id = (select public.usuario_atual())));

create policy resposta_inserir on public.resposta for insert to authenticated
  with check (exists (select 1 from public.simulado s where s.id = simulado_id and s.usuario_id = (select public.usuario_atual()) and s.status = 'em_andamento'));

create policy resposta_atualizar on public.resposta for update to authenticated
  using (exists (select 1 from public.simulado s where s.id = simulado_id and s.usuario_id = (select public.usuario_atual()) and s.status = 'em_andamento'))
  with check (exists (select 1 from public.simulado s where s.id = simulado_id and s.usuario_id = (select public.usuario_atual()) and s.status = 'em_andamento'));

create policy relatorio_leitura on public.relatorio_simulado for select to authenticated
  using (exists (select 1 from public.simulado s where s.id = simulado_id and s.usuario_id = (select public.usuario_atual())));

create policy reporte_proprio on public.reporte_questao for select to authenticated
  using (usuario_id = (select public.usuario_atual()));
create policy reporte_inserir on public.reporte_questao for insert to authenticated
  with check (usuario_id = (select public.usuario_atual()));

-- Privilégios: menor necessário. O aluno nunca escreve `acertou`/`pontos`, nem cria/edita simulado.
revoke all on public.usuario_concurso, public.simulado, public.simulado_item, public.simulado_gabarito,
              public.resposta, public.relatorio_simulado, public.reporte_questao from anon, authenticated;
grant select, insert, delete on public.usuario_concurso to authenticated;
grant select on public.simulado, public.simulado_item, public.relatorio_simulado to authenticated;
grant select on public.resposta to authenticated;
grant insert (simulado_id, posicao, letra, tempo_ms, chute) on public.resposta to authenticated;
grant update (letra, tempo_ms, chute) on public.resposta to authenticated;
grant select on public.reporte_questao to authenticated;
grant insert (questao_id, motivo, texto) on public.reporte_questao to authenticated;
grant usage on sequence public.reporte_questao_id_seq to authenticated;

-- LGPD: apagar todos os dados de um usuário (chamado pelo servidor ao receber user.deleted do Clerk).
create function public.apagar_dados_usuario(p_usuario text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_usuario is null or p_usuario = '' then
    raise exception 'usuario obrigatorio';
  end if;
  delete from public.simulado           where usuario_id = p_usuario;  -- cascata: itens, gabarito, respostas, relatório
  delete from public.reporte_questao    where usuario_id = p_usuario;
  delete from public.usuario_concurso   where usuario_id = p_usuario;
end $$;
revoke all on function public.apagar_dados_usuario(text) from public, anon, authenticated;
grant execute on function public.apagar_dados_usuario(text) to service_role;
