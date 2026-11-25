import assert from "node:assert/strict";
import { test } from "node:test";
import { POLITICA_PADRAO } from "@concurso/engine";
import { ehAdminId, idsAdmin } from "../src/lib/admin-regra.ts";
import { CONCURSO_DEMO, criarRepoDemo } from "../src/lib/repo/demo.ts";
import { criarSimulado, reportarQuestao, resolverReporte } from "../src/lib/servico.ts";
import { ErroDeNegocio, LIMITE_REPORTES_DIA } from "../src/lib/tipos.ts";
import type { Repositorio } from "../src/lib/tipos.ts";

let n = 0;
const ctx = () => ({ agora: () => new Date(Date.UTC(2026, 0, 1, 12, 0, n++)), novoId: () => `sim-r-${n++}`, aleatorio: () => String(n++) });

async function simuladoDe(repo: Repositorio, usuario: string) {
  return criarSimulado(repo, usuario, { concursoSlug: CONCURSO_DEMO, n: 10 }, POLITICA_PADRAO, ctx());
}

test("admin: lista de IDs, falha fechada e IDs inválidos ignorados", () => {
  assert.equal(ehAdminId("user_abc", "user_abc, user_def"), true);
  assert.equal(ehAdminId("user_def", "user_abc, user_def"), true);
  assert.equal(ehAdminId("user_x", "user_abc,user_def"), false);
  assert.equal(ehAdminId("user_abc", undefined), false, "sem lista, ninguém");
  assert.equal(ehAdminId("user_abc", ""), false);
  assert.equal(ehAdminId(null, "user_abc"), false);
  assert.equal(ehAdminId("", ""), false);
  assert.deepEqual([...idsAdmin("a b,  ,user_ok,;DROP")], ["user_ok"]);
});

test("aluno reporta questão do próprio simulado; aparece na fila com o conteúdo e sem identificar o aluno", async () => {
  const repo = criarRepoDemo();
  const id = await simuladoDe(repo, "u1");
  assert.equal(await reportarQuestao(repo, "u1", id, 3, "enunciado", "  A alternativa B está ambígua  "), "ok");
  const fila = await repo.listarReportes("abertos");
  assert.equal(fila.length, 1);
  assert.equal(fila[0]?.motivo, "enunciado");
  assert.equal(fila[0]?.texto, "A alternativa B está ambígua");
  assert.ok(fila[0]?.questao?.enunciado);
  assert.ok(!JSON.stringify(fila).includes("u1"), "a fila não expõe quem reportou");
  assert.equal(await repo.contagemReportesAbertos(), 1);
});

test("a questão vem do simulado: simulado alheio, inexistente ou posição inválida não geram reporte", async () => {
  const repo = criarRepoDemo();
  const id = await simuladoDe(repo, "u1");
  assert.equal(await reportarQuestao(repo, "u2", id, 1, "gabarito", ""), "inexistente");
  assert.equal(await reportarQuestao(repo, "u1", "nao-existe", 1, "gabarito", ""), "inexistente");
  assert.equal(await reportarQuestao(repo, "u1", id, 11, "gabarito", ""), "posicao_invalida");
  assert.equal(await reportarQuestao(repo, "u1", id, 0, "gabarito", ""), "posicao_invalida");
  assert.equal(await reportarQuestao(repo, "u1", id, 1.5, "gabarito", ""), "posicao_invalida");
  assert.equal((await repo.listarReportes("abertos")).length, 0);
});

test("validação: motivo desconhecido, texto longo e 'outro' sem descrição são recusados com mensagem", async () => {
  const repo = criarRepoDemo();
  const id = await simuladoDe(repo, "u1");
  await assert.rejects(reportarQuestao(repo, "u1", id, 1, "xss", ""), ErroDeNegocio);
  await assert.rejects(reportarQuestao(repo, "u1", id, 1, "gabarito", "x".repeat(2001)), ErroDeNegocio);
  await assert.rejects(reportarQuestao(repo, "u1", id, 1, "outro", "  "), /Em "Outro problema"/);
  assert.equal(await reportarQuestao(repo, "u1", id, 1, "gabarito", ""), "ok", "texto é opcional nos demais motivos");
});

test("reporte aberto igual não duplica; outro motivo ou outro aluno entra", async () => {
  const repo = criarRepoDemo();
  const a = await simuladoDe(repo, "u1");
  const b = await simuladoDe(repo, "u2");
  assert.equal(await reportarQuestao(repo, "u1", a, 1, "gabarito", ""), "ok");
  assert.equal(await reportarQuestao(repo, "u1", a, 1, "gabarito", "de novo"), "ja_reportado");
  assert.equal(await reportarQuestao(repo, "u1", a, 1, "enunciado", ""), "ok");
  assert.equal((await repo.listarReportes("abertos")).length, 2);
  // outro aluno reportando a mesma questão (quando ela cair no simulado dele)
  const comp = await repo.carregarSimuladoCompleto("u1", a);
  const alvo = comp?.simulado.itens[0]?.questaoId;
  const compB = await repo.carregarSimuladoCompleto("u2", b);
  const posB = (compB?.simulado.itens.findIndex((i) => i.questaoId === alvo) ?? -1) + 1;
  if (posB > 0) assert.equal(await reportarQuestao(repo, "u2", b, posB, "gabarito", ""), "ok");
});

test("limite diário de reportes por aluno", async () => {
  const repo = criarRepoDemo();
  const id = await simuladoDe(repo, "u1");
  let enviados = 0;
  for (let pos = 1; pos <= 10; pos++) {
    for (const motivo of ["gabarito", "enunciado", "assunto"]) {
      const r = await reportarQuestao(repo, "u1", id, pos, motivo, "");
      if (r === "ok") enviados++;
      if (r === "limite") {
        assert.equal(enviados, LIMITE_REPORTES_DIA);
        return;
      }
    }
  }
  assert.fail("o limite deveria ter sido atingido");
});

test("justificar fecha só aquele reporte e mantém a questão", async () => {
  const repo = criarRepoDemo();
  const id = await simuladoDe(repo, "u1");
  await reportarQuestao(repo, "u1", id, 1, "gabarito", "");
  await reportarQuestao(repo, "u1", id, 2, "gabarito", "");
  const [r1] = await repo.listarReportes("abertos");
  assert.ok(r1);
  assert.equal(await resolverReporte(repo, "admin_1", r1.id, "justificado", "Conferido na fonte vigente."), 1);
  assert.equal((await repo.listarReportes("abertos")).length, 1);
  const res = await repo.listarReportes("resolvidos");
  assert.equal(res.length, 1);
  assert.equal(res[0]?.resolucao, "justificado");
  assert.equal(res[0]?.justificativa, "Conferido na fonte vigente.");
  assert.equal(res[0]?.resolvidoPor, "admin_1");
  assert.equal(res[0]?.questao?.status, "ativa");
});

test("retirar inativa a questão, fecha os reportes dela e ela sai dos novos simulados; o histórico não muda", async () => {
  const repo = criarRepoDemo();
  const id = await simuladoDe(repo, "u1");
  const comp = await repo.carregarSimuladoCompleto("u1", id);
  const alvo = comp?.simulado.itens[0]?.questaoId as string;
  await reportarQuestao(repo, "u1", id, 1, "gabarito", "");
  await reportarQuestao(repo, "u1", id, 1, "enunciado", "");
  const [r1] = await repo.listarReportes("abertos");
  assert.ok(r1);
  assert.equal(await resolverReporte(repo, "admin_1", r1.id, "questao_retirada", "Enunciado ambíguo."), 2);
  assert.equal((await repo.listarReportes("abertos")).length, 0);
  const { itens } = await repo.listarQuestoesAdmin({ busca: alvo, pagina: 1 });
  assert.equal(itens[0]?.status, "inativa");
  // sai dos novos simulados (política padrão só aceita ativa)
  for (let i = 0; i < 5; i++) {
    const novo = await simuladoDe(repo, `novo${i}`);
    const c = await repo.carregarSimuladoCompleto(`novo${i}`, novo);
    assert.ok(!c?.simulado.itens.some((it) => it.questaoId === alvo), "questão retirada não deve voltar");
  }
  // o simulado antigo continua íntegro (snapshot imutável)
  const antigo = await repo.carregarSimuladoCompleto("u1", id);
  assert.equal(antigo?.simulado.itens[0]?.questaoId, alvo);
});

test("resolver de novo não faz nada; entradas inválidas são recusadas", async () => {
  const repo = criarRepoDemo();
  const id = await simuladoDe(repo, "u1");
  await reportarQuestao(repo, "u1", id, 1, "gabarito", "");
  const [r1] = await repo.listarReportes("abertos");
  assert.ok(r1);
  await assert.rejects(resolverReporte(repo, "admin_1", r1.id, "apagar", "ok ok"), ErroDeNegocio);
  await assert.rejects(resolverReporte(repo, "admin_1", r1.id, "justificado", "  "), /justificativa/i);
  await assert.rejects(resolverReporte(repo, "admin_1", r1.id, "justificado", "x".repeat(2001)), ErroDeNegocio);
  await assert.rejects(resolverReporte(repo, "admin_1", 0, "justificado", "Conferido."), ErroDeNegocio);
  assert.equal((await repo.listarReportes("abertos")).length, 1, "nada mudou após as recusas");
  assert.equal(await resolverReporte(repo, "admin_1", r1.id, "justificado", "Conferido."), 1);
  assert.equal(await resolverReporte(repo, "admin_2", r1.id, "questao_retirada", "Tarde demais."), 0);
  assert.equal((await repo.listarReportes("resolvidos"))[0]?.resolvidoPor, "admin_1");
});

test("banco de questões do admin: filtros, só com reporte aberto, paginação e gabarito visível só ali", async () => {
  const repo = criarRepoDemo();
  const id = await simuladoDe(repo, "u1");
  const tudo = await repo.listarQuestoesAdmin({ pagina: 1 });
  assert.ok(tudo.total > 25, "demonstração tem mais de uma página");
  assert.equal(tudo.itens.length, 25);
  assert.ok(tudo.itens.every((q) => q.correta === null || /^[A-E]$/.test(q.correta)));
  const p2 = await repo.listarQuestoesAdmin({ pagina: 2 });
  assert.notEqual(p2.itens[0]?.id, tudo.itens[0]?.id);
  await reportarQuestao(repo, "u1", id, 1, "gabarito", "");
  const so = await repo.listarQuestoesAdmin({ soComReporteAberto: true, pagina: 1 });
  assert.equal(so.total, 1);
  assert.equal(so.itens[0]?.reportesAbertos, 1);
  assert.equal((await repo.listarQuestoesAdmin({ status: "inativa", pagina: 1 })).total, 0);
  assert.equal((await repo.listarQuestoesAdmin({ concurso: "nao-existe", pagina: 1 })).total, 0);
});
