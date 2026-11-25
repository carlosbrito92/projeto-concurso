import assert from "node:assert/strict";
import { test } from "node:test";
import { POLITICA_PADRAO } from "@concurso/engine";
import { CONCURSO_DEMO, criarRepoDemo } from "../src/lib/repo/demo.ts";
import { criarSimulado, publicarRegistro, reportarQuestao, resolverReporte } from "../src/lib/servico.ts";
import { ErroDeNegocio } from "../src/lib/tipos.ts";

let n = 0;
const ctx = () => ({ agora: () => new Date(Date.UTC(2026, 0, 1, 12, 0, n++)), novoId: () => `sim-g-${n++}`, aleatorio: () => String(n++) });

test("publicar: valida tipo, título e resumo; guarda texto aparado", async () => {
  const repo = criarRepoDemo();
  await assert.rejects(publicarRegistro(repo, "admin_1", "questao_retirada", "Título válido", ""), ErroDeNegocio, "questao_retirada é só automático");
  await assert.rejects(publicarRegistro(repo, "admin_1", "xss", "Título válido", ""), ErroDeNegocio);
  await assert.rejects(publicarRegistro(repo, "admin_1", "novidade", "ab", ""), /pelo menos 3/);
  await assert.rejects(publicarRegistro(repo, "admin_1", "novidade", "   ", ""), ErroDeNegocio);
  await assert.rejects(publicarRegistro(repo, "admin_1", "novidade", "x".repeat(121), ""), ErroDeNegocio);
  await assert.rejects(publicarRegistro(repo, "admin_1", "novidade", "Título válido", "r".repeat(1001)), ErroDeNegocio);
  assert.equal((await repo.listarRegistro(10)).length, 0, "nada foi gravado após as recusas");
  await publicarRegistro(repo, "admin_1", "conteudo", "  Nova prova carregada  ", "  PC-SP 2023.  ");
  await publicarRegistro(repo, "admin_1", "novidade", "Relatório por disciplina", "");
  const r = await repo.listarRegistro(10);
  assert.equal(r.length, 2);
  assert.equal(r[0]?.titulo, "Relatório por disciplina", "mais recente primeiro");
  assert.equal(r[0]?.resumo, null);
  assert.equal(r[1]?.titulo, "Nova prova carregada");
  assert.equal(r[1]?.resumo, "PC-SP 2023.");
});

test("o que o aluno lê não traz autor nem referência interna", async () => {
  const repo = criarRepoDemo();
  await publicarRegistro(repo, "admin_secreto", "novidade", "Algo novo", "Resumo");
  const json = JSON.stringify(await repo.listarRegistro(10));
  assert.ok(!json.includes("admin_secreto"));
  assert.ok(!/questaoId|autor/.test(json));
});

test("limite da listagem", async () => {
  const repo = criarRepoDemo();
  for (let i = 0; i < 5; i++) await publicarRegistro(repo, "admin_1", "novidade", `Entrada ${i}`, "");
  assert.equal((await repo.listarRegistro(3)).length, 3);
  assert.equal((await repo.listarRegistro(3))[0]?.titulo, "Entrada 4");
});

test("retirar questão gera entrada automática genérica; justificar não gera; resolver de novo não duplica", async () => {
  const repo = criarRepoDemo();
  const id = await criarSimulado(repo, "u1", { concursoSlug: CONCURSO_DEMO, n: 10 }, POLITICA_PADRAO, ctx());
  await reportarQuestao(repo, "u1", id, 1, "gabarito", "");
  await reportarQuestao(repo, "u1", id, 2, "gabarito", "");
  const [a, b] = await repo.listarReportes("abertos");
  assert.ok(a && b);
  await resolverReporte(repo, "admin_1", a.id, "justificado", "Conferido na fonte.");
  assert.equal((await repo.listarRegistro(10)).length, 0, "justificar não publica");
  await resolverReporte(repo, "admin_1", b.id, "questao_retirada", "SEGREDO-INTERNO enunciado ambíguo");
  const reg = await repo.listarRegistro(10);
  assert.equal(reg.length, 1);
  assert.equal(reg[0]?.tipo, "questao_retirada");
  assert.ok(!JSON.stringify(reg).includes("SEGREDO"), "a justificativa é interna");
  assert.ok(reg[0]?.concursoSlug === CONCURSO_DEMO);
  await resolverReporte(repo, "admin_1", b.id, "questao_retirada", "de novo");
  assert.equal((await repo.listarRegistro(10)).length, 1);
});
