-- Conteúdo: concurso, edital, provas e banco de questões.
-- Regra de ouro: o BANCO DE QUESTÕES e os GABARITOS nunca são lidos pelo navegador.
-- Só o servidor (service_role) acessa `questao`, `questao_gabarito` e `prova`.
-- O aluno enxerga apenas a estrutura pública do edital e as questões dos próprios simulados (ver migração seguinte).

create table public.concurso (
  slug               text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  orgao              text not null,
  uf                 char(2) not null,
  banca              text not null,
  cargo              text not null,
  edital             text not null,
  ano                integer not null,
  vagas              integer,
  total_questoes     integer not null check (total_questoes > 0),
  alternativas       smallint not null check (alternativas between 2 and 5),
  pontos_por_questao numeric not null default 1,
  nota_minima        numeric,
  data_provavel      date,
  criado_em          timestamptz not null default now()
);

create table public.disciplina (
  concurso_slug     text not null references public.concurso (slug) on delete cascade,
  id                text not null check (id ~ '^D[0-9]{2}$'),
  modulo            text check (modulo in ('basicos', 'especificos')),
  numero            integer not null,
  titulo_literal    text not null,
  nome              text not null,
  questoes          integer check (questoes >= 0),     -- null quando o edital só informa o total de um grupo
  peso              numeric check (peso between 0 and 1),
  numeracao_itens   text check (numeracao_itens in ('edital', 'sintetica')),
  bibliografia_bruta text,
  primary key (concurso_slug, id)
);

create table public.grupo_edital (
  concurso_slug text not null references public.concurso (slug) on delete cascade,
  nome          text not null,
  questoes      integer not null check (questoes > 0),
  disciplinas   text[] not null,
  primary key (concurso_slug, nome)
);

create table public.item_edital (
  concurso_slug text not null,
  id            text not null check (id ~ '^D[0-9]{2}:[0-9]+(\.[0-9]+)*$'),
  disciplina_id text not null,
  numero        text not null,
  texto         text not null,
  pai           text,
  pagina        integer not null,
  ordem         integer not null,
  primary key (concurso_slug, id),
  foreign key (concurso_slug, disciplina_id) references public.disciplina (concurso_slug, id) on delete cascade,
  foreign key (concurso_slug, pai) references public.item_edital (concurso_slug, id) on delete cascade
    deferrable initially deferred
);
create index item_edital_disciplina_idx on public.item_edital (concurso_slug, disciplina_id, ordem);

-- Perfil estatístico da banca (conteudo/bancas/*.json): só medidas, nenhum texto de questão.
create table public.banca_perfil (
  banca         text primary key,
  amostra       jsonb not null,
  medidas       jsonb not null,
  atualizado_em timestamptz not null default now()
);

create table public.prova (
  slug               text primary key,
  concurso_slug      text not null references public.concurso (slug),
  banca              text not null,
  ano                integer not null,
  caderno            text,
  total_questoes     integer not null check (total_questoes > 0),
  alternativas       smallint not null check (alternativas between 2 and 5),
  gabarito_situacao  text not null check (gabarito_situacao in ('definitivo', 'preliminar', 'oficial')),
  data_aplicacao     date,
  vigencia_suspeita  boolean not null default false,
  pdf_sha256         text
);

create table public.questao (
  id                   text primary key check (id ~ '^Q[0-9]{6}$'),
  schema_version       text not null,
  prova_slug           text references public.prova (slug),
  concurso_slug        text not null references public.concurso (slug),
  numero_na_prova      integer,
  tipo                 text not null check (tipo in ('MultiplaEscolha', 'CertoErrado', 'AfirmacoesCombinadas', 'VerdadeiroFalso')),
  enunciado            text not null check (length(enunciado) > 0),
  texto_apoio          text,
  alternativas         jsonb not null check (jsonb_typeof(alternativas) = 'array' and jsonb_array_length(alternativas) between 2 and 5),
  anulada              boolean not null default false,
  peso                 smallint not null default 1 check (peso between 1 and 5),
  grupo_equivalencia   text,
  disciplina_ids       text[] not null,
  disciplina_nome      text not null,
  edital_item_id       text,
  edital_item_trilha   text[] not null default '{}',
  assunto              text,
  classificacao_status text check (classificacao_status in ('sugerida', 'confirmada', 'indeterminada')),
  classificacao_metodo text,
  classificacao_score  numeric,
  origem_tipo          text not null check (origem_tipo in ('prova_real', 'autoral_ia')),
  banca                text,
  ano                  integer,
  direitos_status      text not null default 'pendente_juridico' check (direitos_status in ('pendente_juridico', 'liberada', 'nao_aplicavel')),
  revisao_status       text not null default 'automatico' check (revisao_status in ('automatico', 'revisado', 'rejeitado')),
  revisao_por          text,
  revisao_em           timestamptz,
  status               text not null default 'rascunho' check (status in ('rascunho', 'ativa', 'inativa', 'em_revisao')),
  pendencias           text[] not null default '{}',
  gabarito_oficial     boolean not null default false,
  imagens              jsonb,
  atualizado_em        timestamptz not null default now(),
  foreign key (concurso_slug, edital_item_id) references public.item_edital (concurso_slug, id),
  -- Defesa em profundidade (o motor aplica a mesma regra): nada vai a "ativa" sem liberação jurídica e revisão humana.
  constraint questao_ativa_exige_liberacao check (
    status <> 'ativa' or (direitos_status <> 'pendente_juridico' and revisao_status = 'revisado')
  )
);
create index questao_concurso_status_idx on public.questao (concurso_slug, status);
create index questao_item_idx on public.questao (concurso_slug, edital_item_id);
create index questao_disciplinas_idx on public.questao using gin (disciplina_ids);

-- Gabarito, comentário e fundamentação ficam em tabela à parte: nenhuma política para o navegador.
create table public.questao_gabarito (
  questao_id    text primary key references public.questao (id) on delete cascade,
  correta       smallint check (correta between 0 and 4),
  comentario    text,
  fundamentacao jsonb
);

-- Questão ativa e não anulada precisa ter gabarito.
create function public.exigir_gabarito_para_ativar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'ativa' and not new.anulada then
    if not exists (select 1 from public.questao_gabarito g where g.questao_id = new.id and g.correta is not null) then
      raise exception 'questao % nao pode ficar ativa sem gabarito', new.id using errcode = '23514';
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger questao_exigir_gabarito before insert or update on public.questao
  for each row execute function public.exigir_gabarito_para_ativar();

-- Segurança: RLS ligada em tudo. Estrutura pública do edital: leitura para usuário autenticado.
alter table public.concurso          enable row level security;
alter table public.disciplina        enable row level security;
alter table public.grupo_edital      enable row level security;
alter table public.item_edital       enable row level security;
alter table public.banca_perfil      enable row level security;
alter table public.prova             enable row level security;
alter table public.questao           enable row level security;
alter table public.questao_gabarito  enable row level security;

create policy concurso_leitura   on public.concurso     for select to authenticated using (true);
create policy disciplina_leitura on public.disciplina   for select to authenticated using (true);
create policy grupo_leitura      on public.grupo_edital for select to authenticated using (true);
create policy item_leitura       on public.item_edital  for select to authenticated using (true);
create policy perfil_leitura     on public.banca_perfil for select to authenticated using (true);
-- prova, questao, questao_gabarito: SEM política para anon/authenticated (só service_role, que ignora RLS).

-- Sem acesso anônimo a nada; escrita de conteúdo só pelo servidor.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on public.concurso, public.disciplina, public.grupo_edital, public.item_edital, public.banca_perfil from authenticated;
revoke all on public.prova, public.questao, public.questao_gabarito from authenticated;
