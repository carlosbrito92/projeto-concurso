#!/usr/bin/env python3
"""Testes de segurança do banco (RLS, privilégios de coluna, invariantes) contra um Postgres descartável.

Uso:
    TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres python3 supabase/tests/test_rls.py

Cria e apaga um banco temporário. NUNCA aponte para um banco real. Reproduz o que o Supabase fornece
(papéis anon/authenticated/service_role e auth.jwt() lendo request.jwt.claims) e aplica as migrações em ordem.
"""
import json
import os
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import errors as E

RAIZ = Path(__file__).resolve().parent.parent
BOOTSTRAP = """
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
-- Como no Supabase: tudo que for criado em public já nasce com ALL para os três papéis (a segurança vem de RLS e dos REVOKE das migrações).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
"""


def url_para(banco: str) -> str:
    p = urlsplit(os.environ["TEST_DATABASE_URL"])
    return urlunsplit((p.scheme, p.netloc, "/" + banco, "", ""))


class Base(unittest.TestCase):
    banco = ""
    admin: psycopg.Connection

    @classmethod
    def setUpClass(cls):
        cls.banco = "rls_" + uuid.uuid4().hex[:10]
        with psycopg.connect(os.environ["TEST_DATABASE_URL"], autocommit=True) as a:
            a.execute(f'create database "{cls.banco}"')
        cls.admin = psycopg.connect(url_para(cls.banco), autocommit=True)
        cls.admin.execute(BOOTSTRAP)
        for m in sorted(Path(os.environ.get("MIGRATIONS_DIR", RAIZ / "migrations")).glob("*.sql")):
            cls.admin.execute(m.read_text(encoding="utf-8"))
        cls._fixtures()

    @classmethod
    def tearDownClass(cls):
        cls.admin.close()
        with psycopg.connect(os.environ["TEST_DATABASE_URL"], autocommit=True) as a:
            a.execute(f'drop database if exists "{cls.banco}" with (force)')

    @classmethod
    def _fixtures(cls):
        x = cls.admin.execute
        x("insert into concurso (slug, orgao, uf, banca, cargo, edital, ano, total_questoes, alternativas) values ('c1','Orgao','MG','BANCA','Cargo','1/2024',2024,10,5)")
        x("insert into disciplina (concurso_slug, id, nome, numero, titulo_literal, questoes, peso) values ('c1','D01','Disc um',1,'DISC UM',10,1)")
        x("insert into item_edital (concurso_slug, id, disciplina_id, numero, texto, pai, pagina, ordem) values ('c1','D01:1','D01','1','Item',null,1,1)")
        x("insert into prova (slug, concurso_slug, banca, ano, total_questoes, alternativas, gabarito_situacao) values ('p1','c1','BANCA',2024,10,5,'definitivo')")
        alts = json.dumps(["a", "b", "c", "d", "e"])
        for qid, status, dir_, rev in (("Q000001", "ativa", "liberada", "revisado"), ("Q000002", "rascunho", "pendente_juridico", "automatico")):
            x("insert into questao (id, schema_version, prova_slug, concurso_slug, tipo, enunciado, alternativas, disciplina_ids, disciplina_nome, edital_item_id, origem_tipo, direitos_status, revisao_status, status)"
              " values (%s,'3.0','p1','c1','MultiplaEscolha','Enunciado sintetico',%s::jsonb,'{D01}','Disc um','D01:1','prova_real',%s,%s,'rascunho')", (qid, alts, dir_, rev))
            x("insert into questao_gabarito (questao_id, correta, comentario) values (%s, 2, 'SEGREDO')", (qid,))
        x("update questao set status = 'ativa' where id = 'Q000001'")
        for sid, uid, status in (("00000000-0000-0000-0000-00000000000a", "user_A", "em_andamento"),
                                 ("00000000-0000-0000-0000-00000000000b", "user_B", "em_andamento"),
                                 ("00000000-0000-0000-0000-0000000000a2", "user_A", "finalizado")):
            x("insert into simulado (id, usuario_id, concurso_slug, seed, status, finalizado_em) values (%s,%s,'c1','s',%s, case when %s = 'finalizado' then now() end)", (sid, uid, status, status))
            x("insert into simulado_item (simulado_id, posicao, questao_id, ordem, payload) values (%s,1,'Q000001','{0,1,2,3,4}','{\"enunciado\":\"x\"}')", (sid,))
            x("insert into simulado_gabarito (simulado_id, posicao, letra_correta, snapshot) values (%s,1,'C','{\"correta\":2}')", (sid,))
        x("insert into relatorio_simulado (simulado_id, conteudo) values ('00000000-0000-0000-0000-0000000000a2', '{}')")
        x("insert into relatorio_simulado (simulado_id, conteudo) values ('00000000-0000-0000-0000-00000000000b', '{}')")

    @contextmanager
    def como(self, papel: str, usuario: str | None = None):
        """Executa como `papel` (anon/authenticated/service_role), com o JWT do `usuario`. Sempre desfaz no fim."""
        with psycopg.connect(url_para(self.banco)) as c:
            claims = {"role": papel}
            if usuario:
                claims["sub"] = usuario
            c.execute(f"set local role {papel}")
            c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
            try:
                yield c
            finally:
                c.rollback()

    def negado(self, papel, usuario, sql, params=()):
        """Passa se o banco recusa (privilégio/RLS) OU se nenhuma linha é afetada/visível."""
        with self.como(papel, usuario) as c:
            try:
                cur = c.execute(sql, params)
            except (E.InsufficientPrivilege, E.CheckViolation):
                return
            if cur.description is not None:
                self.assertEqual(cur.fetchall(), [], f"vazou: {sql}")
            else:
                self.assertEqual(cur.rowcount, 0, f"afetou linhas: {sql}")


SIM_A = "00000000-0000-0000-0000-00000000000a"
SIM_B = "00000000-0000-0000-0000-00000000000b"
SIM_A_FIM = "00000000-0000-0000-0000-0000000000a2"


class AcessoAnonimo(Base):
    def test_anon_nao_le_nada(self):
        for t in ("concurso", "disciplina", "item_edital", "banca_perfil", "prova", "questao", "questao_gabarito", "simulado",
                  "simulado_item", "simulado_gabarito", "resposta", "relatorio_simulado", "reporte_questao", "usuario_concurso"):
            with self.subTest(tabela=t):
                with self.como("anon") as c:
                    with self.assertRaises(E.InsufficientPrivilege):
                        c.execute(f"select * from public.{t}")


class BancoDeQuestoesFechado(Base):
    def test_aluno_nao_le_questao_gabarito_prova_nem_snapshot(self):
        for t in ("questao", "questao_gabarito", "prova", "simulado_gabarito"):
            with self.subTest(tabela=t):
                with self.como("authenticated", "user_A") as c:
                    with self.assertRaises(E.InsufficientPrivilege):
                        c.execute(f"select * from public.{t}")

    def test_aluno_le_a_estrutura_publica_do_edital(self):
        with self.como("authenticated", "user_A") as c:
            self.assertEqual(c.execute("select count(*) from concurso").fetchone()[0], 1)
            self.assertEqual(c.execute("select count(*) from item_edital").fetchone()[0], 1)

    def test_aluno_nao_escreve_conteudo(self):
        for sql in ("insert into concurso (slug, orgao, uf, banca, cargo, edital, ano, total_questoes, alternativas) values ('x','o','MG','b','c','e',2024,1,5)",
                    "update concurso set orgao = 'hack'", "delete from disciplina"):
            with self.subTest(sql=sql[:40]):
                with self.como("authenticated", "user_A") as c:
                    with self.assertRaises(E.InsufficientPrivilege):
                        c.execute(sql)

    def test_payload_do_simulado_nao_contem_gabarito(self):
        with self.como("authenticated", "user_A") as c:
            payloads = [r[0] for r in c.execute("select payload::text from simulado_item")]
        self.assertTrue(payloads)
        self.assertTrue(all("correta" not in p and "SEGREDO" not in p for p in payloads))


class IsolamentoEntreUsuarios(Base):
    def test_cada_um_ve_so_os_proprios_simulados(self):
        with self.como("authenticated", "user_A") as c:
            ids = {str(r[0]) for r in c.execute("select id from simulado")}
        self.assertEqual(ids, {SIM_A, SIM_A_FIM})
        with self.como("authenticated", "user_B") as c:
            self.assertEqual({str(r[0]) for r in c.execute("select id from simulado")}, {SIM_B})

    def test_itens_e_relatorios_tambem_isolados(self):
        with self.como("authenticated", "user_A") as c:
            self.assertEqual(c.execute("select count(*) from simulado_item").fetchone()[0], 2)
            self.assertEqual({str(r[0]) for r in c.execute("select simulado_id from relatorio_simulado")}, {SIM_A_FIM})

    def test_sem_jwt_valido_nao_ve_nada(self):
        with self.como("authenticated", None) as c:
            self.assertEqual(c.execute("select count(*) from simulado").fetchone()[0], 0)
            self.assertEqual(c.execute("select count(*) from simulado_item").fetchone()[0], 0)

    def test_aluno_nao_cria_nem_altera_nem_apaga_simulado(self):
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("insert into simulado (usuario_id, concurso_slug, seed) values ('user_A','c1','s')")
        self.negado("authenticated", "user_A", "update simulado set status = 'finalizado'")
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("delete from simulado")


class Respostas(Base):
    def test_aluno_responde_no_proprio_simulado_em_andamento(self):
        with self.como("authenticated", "user_A") as c:
            c.execute("insert into resposta (simulado_id, posicao, letra, tempo_ms, chute) values (%s,1,'C',1500,true)", (SIM_A,))
            c.execute("update resposta set letra = 'D' where simulado_id = %s and posicao = 1", (SIM_A,))
            self.assertEqual(c.execute("select letra from resposta").fetchone()[0], "D")

    def test_nao_responde_no_simulado_de_outro(self):
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):  # viola a política de RLS (WITH CHECK)
                c.execute("insert into resposta (simulado_id, posicao, letra) values (%s,1,'A')", (SIM_B,))

    def test_nao_responde_apos_finalizar(self):
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("insert into resposta (simulado_id, posicao, letra) values (%s,1,'A')", (SIM_A_FIM,))

    def test_aluno_nao_escreve_acertou_nem_pontos(self):
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("insert into resposta (simulado_id, posicao, letra, acertou) values (%s,1,'C',true)", (SIM_A,))
        self.admin.execute("insert into resposta (simulado_id, posicao, letra) values (%s,1,'A') on conflict do nothing", (SIM_A,))
        try:
            with self.como("authenticated", "user_A") as c:
                with self.assertRaises(E.InsufficientPrivilege):
                    c.execute("update resposta set acertou = true, pontos = 99 where simulado_id = %s", (SIM_A,))
        finally:
            self.admin.execute("delete from resposta where simulado_id = %s", (SIM_A,))

    def test_aluno_nao_apaga_resposta(self):
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("delete from resposta")

    def test_letra_invalida_e_recusada(self):
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.CheckViolation):
                c.execute("insert into resposta (simulado_id, posicao, letra) values (%s,1,'Z')", (SIM_A,))


class ReportesEPerfil(Base):
    def test_reporte_usa_o_usuario_do_jwt(self):
        with self.como("authenticated", "user_A") as c:
            c.execute("insert into reporte_questao (questao_id, motivo, texto) values ('Q000001','gabarito','acho errado')")
            self.assertEqual(c.execute("select usuario_id from reporte_questao").fetchone()[0], "user_A")

    def test_nao_forja_reporte_em_nome_de_outro(self):
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):  # usuario_id nem é coluna liberada para INSERT
                c.execute("insert into reporte_questao (usuario_id, questao_id, motivo) values ('user_B','Q000001','gabarito')")

    def test_reportes_sao_privados(self):
        self.admin.execute("insert into reporte_questao (usuario_id, questao_id, motivo) values ('user_B','Q000001','outro')")
        try:
            with self.como("authenticated", "user_A") as c:
                self.assertEqual(c.execute("select count(*) from reporte_questao").fetchone()[0], 0)
        finally:
            self.admin.execute("delete from reporte_questao where usuario_id = 'user_B'")

    def test_usuario_concurso_proprio_e_isolado(self):
        with self.como("authenticated", "user_A") as c:
            c.execute("insert into usuario_concurso (concurso_slug) values ('c1')")
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("insert into usuario_concurso (usuario_id, concurso_slug) values ('user_B','c1')")


class ResolucaoDeReportes(Base):
    def _reporte(self, usuario, questao="Q000001", motivo="gabarito"):
        return self.admin.execute("insert into reporte_questao (usuario_id, questao_id, motivo, texto) values (%s,%s,%s,'x') returning id",
                                  (usuario, questao, motivo)).fetchone()[0]

    def tearDown(self):
        self.admin.execute("delete from reporte_questao")
        self.admin.execute("update questao set status = 'ativa' where id = 'Q000001'")

    def test_aluno_ve_o_proprio_reporte_mas_nao_a_justificativa(self):
        rid = self._reporte("user_A")
        self.admin.execute("select public.resolver_reporte(%s,'justificado','Gabarito conferido na fonte.','admin_1')", (rid,))
        with self.como("authenticated", "user_A") as c:
            self.assertIsNotNone(c.execute("select resolvido_em from reporte_questao").fetchone()[0], "vê que foi tratado")
        for coluna in ("justificativa", "resolvido_por", "resolucao"):
            with self.subTest(coluna=coluna), self.como("authenticated", "user_A") as c:
                with self.assertRaises(E.InsufficientPrivilege):
                    c.execute(f"select {coluna} from reporte_questao")
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("select * from reporte_questao")

    def test_aluno_nao_resolve_nem_edita_reporte(self):
        rid = self._reporte("user_A")
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("update reporte_questao set resolvido_em = now(), resolucao = 'justificado', justificativa = 'ok', resolvido_por = 'user_A' where id = %s", (rid,))
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("insert into reporte_questao (questao_id, motivo, resolucao) values ('Q000001','outro','justificado')")
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("delete from reporte_questao where id = %s", (rid,))

    def test_aluno_nao_chama_resolver_reporte(self):
        rid = self._reporte("user_A")
        for papel, usuario in (("authenticated", "user_A"), ("anon", None)):
            with self.subTest(papel=papel), self.como(papel, usuario) as c:
                with self.assertRaises(E.InsufficientPrivilege):
                    c.execute("select public.resolver_reporte(%s,'questao_retirada','tentativa','user_A')", (rid,))

    def test_reporte_aberto_duplicado_e_barrado_mas_outro_motivo_ou_aluno_passa(self):
        self._reporte("user_A")
        with self.assertRaises(E.UniqueViolation):
            self._reporte("user_A")
        self._reporte("user_A", motivo="enunciado")
        self._reporte("user_B")

    def test_depois_de_resolvido_pode_reportar_de_novo(self):
        rid = self._reporte("user_A")
        self.admin.execute("select public.resolver_reporte(%s,'justificado','Conferido.','admin_1')", (rid,))
        self._reporte("user_A")

    def test_justificar_fecha_so_aquele_reporte(self):
        a, b = self._reporte("user_A"), self._reporte("user_B")
        with self.como("service_role") as c:
            self.assertEqual(c.execute("select public.resolver_reporte(%s,'justificado','  Conferido na fonte vigente.  ','admin_1')", (a,)).fetchone()[0], 1)
            linha = c.execute("select resolucao, justificativa, resolvido_por, resolvido_em is not null from reporte_questao where id = %s", (a,)).fetchone()
            self.assertEqual(linha, ("justificado", "Conferido na fonte vigente.", "admin_1", True))
            self.assertIsNone(c.execute("select resolvido_em from reporte_questao where id = %s", (b,)).fetchone()[0])
            self.assertEqual(c.execute("select status from questao where id = 'Q000001'").fetchone()[0], "ativa")

    def test_retirar_inativa_a_questao_e_fecha_os_reportes_dela(self):
        a, b = self._reporte("user_A"), self._reporte("user_B", motivo="enunciado")
        outro = self._reporte("user_A", questao="Q000002")
        with self.como("service_role") as c:
            self.assertEqual(c.execute("select public.resolver_reporte(%s,'questao_retirada','Enunciado ambíguo.','admin_1')", (a,)).fetchone()[0], 2)
            self.assertEqual(c.execute("select status from questao where id = 'Q000001'").fetchone()[0], "inativa")
            self.assertEqual(c.execute("select count(*) from reporte_questao where questao_id = 'Q000001' and resolucao = 'questao_retirada'").fetchone()[0], 2)
            self.assertIsNone(c.execute("select resolvido_em from reporte_questao where id = %s", (outro,)).fetchone()[0], "outra questão intocada")
            self.assertEqual(c.execute("select status from questao where id = 'Q000002'").fetchone()[0], "rascunho")

    def test_resolver_duas_vezes_nao_faz_nada(self):
        rid = self._reporte("user_A")
        with self.como("service_role") as c:
            self.assertEqual(c.execute("select public.resolver_reporte(%s,'justificado','Conferido.','admin_1')", (rid,)).fetchone()[0], 1)
            self.assertEqual(c.execute("select public.resolver_reporte(%s,'questao_retirada','De novo.','admin_2')", (rid,)).fetchone()[0], 0)
            self.assertEqual(c.execute("select status from questao where id = 'Q000001'").fetchone()[0], "ativa")
            self.assertEqual(c.execute("select resolvido_por from reporte_questao where id = %s", (rid,)).fetchone()[0], "admin_1")
            self.assertEqual(c.execute("select public.resolver_reporte(999999,'justificado','Conferido.','admin_1')").fetchone()[0], 0)

    def test_entradas_invalidas_sao_recusadas(self):
        rid = self._reporte("user_A")
        for args in (("apagar", "Conferido.", "admin_1"), ("justificado", "  ", "admin_1"), ("justificado", "ok", "admin_1"),
                     ("justificado", "x" * 2001, "admin_1"), ("justificado", "Conferido.", ""), (None, "Conferido.", "admin_1")):
            with self.subTest(args=args), self.como("service_role") as c:
                with self.assertRaises(E.RaiseException):
                    c.execute("select public.resolver_reporte(%s,%s,%s,%s)", (rid, *args))
        self.assertIsNone(self.admin.execute("select resolvido_em from reporte_questao where id = %s", (rid,)).fetchone()[0])

    def test_estado_de_resolucao_incoerente_e_barrado_pelo_banco(self):
        rid = self._reporte("user_A")
        with self.assertRaises(E.CheckViolation):
            self.admin.execute("update reporte_questao set resolvido_em = now() where id = %s", (rid,))


class Lgpd(Base):
    def test_aluno_nao_chama_apagar_dados(self):
        with self.como("authenticated", "user_A") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("select public.apagar_dados_usuario('user_B')")
        with self.como("anon") as c:
            with self.assertRaises(E.InsufficientPrivilege):
                c.execute("select public.apagar_dados_usuario('user_B')")

    def test_servidor_apaga_so_os_dados_do_usuario(self):
        sid = "00000000-0000-0000-0000-0000000000c1"
        self.admin.execute("insert into simulado (id, usuario_id, concurso_slug, seed) values (%s,'user_Z','c1','s')", (sid,))
        self.admin.execute("insert into simulado_item (simulado_id, posicao, questao_id, ordem, payload) values (%s,1,'Q000001','{0}','{}')", (sid,))
        self.admin.execute("insert into reporte_questao (usuario_id, questao_id, motivo) values ('user_Z','Q000001','outro')")
        with self.como("service_role") as c:
            c.execute("select public.apagar_dados_usuario('user_Z')")
            self.assertEqual(c.execute("select count(*) from simulado where usuario_id = 'user_Z'").fetchone()[0], 0)
            self.assertEqual(c.execute("select count(*) from simulado_item where simulado_id = %s", (sid,)).fetchone()[0], 0)
            self.assertEqual(c.execute("select count(*) from reporte_questao where usuario_id = 'user_Z'").fetchone()[0], 0)
            self.assertEqual(c.execute("select count(*) from simulado where usuario_id = 'user_A'").fetchone()[0], 2, "não apagou o de outros")


class InvariantesDoConteudo(Base):
    def _inserir(self, qid, status, dir_, rev, gabarito=True, anulada=False):
        x = self.admin.execute
        x("insert into questao (id, schema_version, concurso_slug, tipo, enunciado, alternativas, disciplina_ids, disciplina_nome, origem_tipo, direitos_status, revisao_status, status, anulada)"
          " values (%s,'3.0','c1','MultiplaEscolha','e',%s::jsonb,'{D01}','d','prova_real',%s,%s,'rascunho',%s)", (qid, json.dumps(list("abcde")), dir_, rev, anulada))
        if gabarito:
            x("insert into questao_gabarito (questao_id, correta) values (%s, 1)", (qid,))
        if status != "rascunho":
            x("update questao set status = %s where id = %s", (status, qid))

    def test_ativa_exige_liberacao_juridica(self):
        with self.assertRaises(E.CheckViolation):
            self._inserir("Q000010", "ativa", "pendente_juridico", "revisado")

    def test_ativa_exige_revisao_humana(self):
        with self.assertRaises(E.CheckViolation):
            self._inserir("Q000011", "ativa", "liberada", "automatico")

    def test_ativa_exige_gabarito(self):
        with self.assertRaises(E.CheckViolation):
            self._inserir("Q000012", "ativa", "liberada", "revisado", gabarito=False)

    def test_anulada_pode_ficar_sem_gabarito_mas_nao_ativa_sem_liberacao(self):
        self._inserir("Q000013", "rascunho", "pendente_juridico", "automatico", gabarito=False, anulada=True)
        self.admin.execute("delete from questao where id = 'Q000013'")

    def test_ativa_valida_passa(self):
        self._inserir("Q000014", "ativa", "liberada", "revisado")
        self.assertEqual(self.admin.execute("select status from questao where id='Q000014'").fetchone()[0], "ativa")
        self.admin.execute("delete from questao where id = 'Q000014'")

    def test_item_edital_aceita_hierarquia_e_rejeita_pai_inexistente(self):
        self.admin.execute("insert into item_edital (concurso_slug, id, disciplina_id, numero, texto, pai, pagina, ordem) values ('c1','D01:1.1','D01','1.1','Filho','D01:1',1,2)")
        with self.assertRaises(E.ForeignKeyViolation):
            self.admin.execute("insert into item_edital (concurso_slug, id, disciplina_id, numero, texto, pai, pagina, ordem) values ('c1','D01:9.9','D01','9.9','Orfao','D01:8',1,3)")
        self.admin.execute("delete from item_edital where id = 'D01:1.1'")


if __name__ == "__main__":
    if "TEST_DATABASE_URL" not in os.environ:
        raise SystemExit(__doc__)
    unittest.main(verbosity=2)
