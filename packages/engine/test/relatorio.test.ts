import assert from "node:assert/strict";
import { test } from "node:test";
import { letraCorreta } from "../src/correcao.ts";
import type { Resposta } from "../src/correcao.ts";
import { gerarRelatorio, gerarRelatorioAcumulado } from "../src/relatorio.ts";
import { montarSimulado } from "../src/simulado.ts";
import type { Letra } from "../src/types.ts";
import { edital, pool } from "./fixtures.ts";

const errada = (L: Letra): Letra => (L === "A" ? "B" : "A");

/** 10 questões: D01 (4: 2 em cada assunto), D02 (4), D03 (2). Define quais acertar. */
function cenario(acerta: (disc: string, item: string, i: number) => boolean, extra?: (r: Resposta, i: number) => Resposta) {
  const qs = pool().filter((q) => {
    const k = q.classificacao.editalItemId as string;
    return ["D01:1", "D01:2", "D02:1", "D02:2"].includes(k) ? Number(q.id.at(-1)) < 2 : k === "D03:1" && Number(q.id.at(-1)) < 2;
  });
  const s = montarSimulado(qs, { id: "S", seed: "r", criadoEm: "t" });
  const resp = s.itens.map((it, i) => {
    const L = letraCorreta(it);
    const c = it.snapshot.classificacao;
    const base: Resposta = { questaoId: it.questaoId, letra: acerta(c.disciplinaId as string, c.editalItemId as string, i) ? L : errada(L) };
    return extra ? extra(base, i) : base;
  });
  return { s, resp };
}

test("agrega por disciplina e assunto e aponta o foco no que errou, ponderado pelo edital", () => {
  const { s, resp } = cenario((d, item) => !(d === "D01" && item === "D01:2") && d !== "D02");
  const r = gerarRelatorio(s, resp, { edital: edital() });
  assert.equal(r.resumo.total, 10);
  assert.equal(r.resumo.acertos, 4);
  const d01 = r.porDisciplina.find((l) => l.chave === "D01")!;
  assert.equal(d01.acertos, 2);
  assert.equal(d01.peso, 0.5);
  assert.equal(r.porAssunto.find((a) => a.itemId === "D01:2")?.acertos, 0);
  assert.equal(r.focos[0]?.itemId.startsWith("D0"), true);
  // D01 (peso 0.5, 50% de acerto) ou D02 (peso 0.3, 0%): conferir que a ordem usa peso × falta
  const prioridades = r.focos.map((f) => f.prioridade);
  assert.deepEqual(prioridades, [...prioridades].sort((a, b) => b - a));
  assert.ok(r.cadernoDeErros.length === 6);
});

test("sem edital o relatório ainda funciona (peso desconhecido = 0, nome vem da questão)", () => {
  const { s, resp } = cenario(() => false);
  const r = gerarRelatorio(s, resp);
  assert.ok(r.porDisciplina.every((l) => l.peso === 0));
  assert.ok(r.focos.length > 0);
});

test("poucas questões = evidência insuficiente: nível indefinido e fora dos focos", () => {
  const { s, resp } = cenario((d) => d !== "D03");
  const r = gerarRelatorio(s, resp, { edital: edital() });
  const d03 = r.porDisciplina.find((l) => l.chave === "D03")!;
  assert.equal(d03.n, 2);
  assert.equal(d03.nivel, "indefinido");
  assert.ok(!r.focos.some((f) => f.itemId.startsWith("D03")));
  assert.ok(r.insights.some((t) => t.includes("indicativo")));
});

test("agregação hierárquica: o pai soma os filhos", () => {
  const qs = pool().slice(0, 4).map((q, i) => ({ ...q, classificacao: { ...q.classificacao, editalItemId: i < 2 ? "D01:5.5.1" : "D01:5.5.2", editalItemTrilha: ["D01:5", "D01:5.5", i < 2 ? "D01:5.5.1" : "D01:5.5.2"] } }));
  const s = montarSimulado(qs, { id: "H", seed: "h", criadoEm: "t" });
  const resp = s.itens.map((it, i) => ({ questaoId: it.questaoId, letra: i === 0 ? letraCorreta(it) : errada(letraCorreta(it)) }));
  const r = gerarRelatorio(s, resp);
  const pai = r.porAssunto.find((a) => a.itemId === "D01:5.5")!;
  assert.equal(pai.n, 4);
  assert.equal(pai.agregado, true);
  assert.equal(r.porAssunto.find((a) => a.itemId === "D01:5.5.1")?.agregado, false);
  assert.equal(pai.acertos, 1);
});

test("chutes, tempo médio e avisos de vigência entram no relatório", () => {
  const velhas = pool().slice(0, 5).map((q) => ({ ...q, pendencias: ["verificar_vigencia"] }));
  const s = montarSimulado(velhas, { id: "V", seed: "v", criadoEm: "t" });
  const resp = s.itens.map((it, i) => ({ questaoId: it.questaoId, letra: letraCorreta(it), tempoMs: 1000 * (i + 1), chute: i < 2 }));
  const r = gerarRelatorio(s, resp);
  assert.equal(r.resumo.tempoMedioMs, 3000);
  assert.deepEqual(r.resumo.chutes, { total: 2, acertos: 2 });
  assert.equal(r.avisos.find((a) => a.codigo === "vigencia")?.questoes, 5);
  assert.ok(r.insights.some((t) => t.includes("prova antiga")));
  assert.ok(r.insights.some((t) => t.includes("sorte")));
});

test("sem evidência por assunto, o foco sobe para a disciplina (não fica vazio)", () => {
  const { s, resp } = cenario((d) => d !== "D02");
  const r = gerarRelatorio(s, resp, { edital: edital() });
  assert.ok(r.focos.length > 0);
  assert.equal(r.focos[0]?.escopo, "disciplina");
  assert.equal(r.focos[0]?.itemId, "D02");
  assert.match(r.focos[0]?.motivo ?? "", /poucas questões por assunto/);
});

test("acumulando simulados, a evidência por assunto aparece e o foco passa a apontar o item exato", () => {
  const sessoes = [0, 1, 2].map((k) => {
    const doItem = (id: string) => pool().filter((q) => q.classificacao.editalItemId === id).slice(k * 2, k * 2 + 2);
    const qs = [...doItem("D01:1"), ...doItem("D01:2")];
    const s = montarSimulado(qs, { id: `S${k}`, seed: `acc${k}`, criadoEm: "t" });
    const respostas = s.itens.map((it) => ({ questaoId: it.questaoId, letra: it.snapshot.classificacao.editalItemId === "D01:1" ? letraCorreta(it) : errada(letraCorreta(it)) }));
    return { simulado: s, respostas };
  });
  const r = gerarRelatorioAcumulado(sessoes, { edital: edital() });
  assert.equal(r.resumo.total, sessoes.reduce((a, x) => a + x.simulado.itens.length, 0));
  const fraco = r.porAssunto.find((a) => a.itemId === "D01:2")!;
  assert.ok(fraco.n >= 3);
  assert.equal(fraco.acertos, 0);
  assert.equal(r.focos[0]?.escopo, "assunto");
  assert.equal(r.focos[0]?.itemId, "D01:2");
});

test("o corte do foco acontece DEPOIS de ordenar assunto e disciplina juntos", () => {
  const { s, resp } = cenario((d) => d !== "D01" && d !== "D02"); // D01 e D02 erram tudo; D01 pesa mais
  const r = gerarRelatorio(s, resp, { edital: edital(), maxFocos: 1 });
  assert.equal(r.focos.length, 1);
  assert.equal(r.focos[0]?.itemId, "D01");
  const todos = gerarRelatorio(s, resp, { edital: edital(), maxFocos: 10 }).focos.map((f) => f.prioridade);
  assert.deepEqual(todos, [...todos].sort((a, b) => b - a));
});

test("com poucas questões por disciplina o relatório explica por que não aponta foco", () => {
  const { s, resp } = cenario(() => false);
  const pouco = montarSimulado(s.itens.slice(0, 2).map((i) => i.snapshot), { id: "P", seed: "p", criadoEm: "t" });
  const r = gerarRelatorio(pouco, resp.slice(0, 2).map((x, i) => ({ questaoId: (pouco.itens[i] as { questaoId: string }).questaoId, letra: x.letra })), { edital: edital() });
  assert.equal(r.focos.length, 0);
  assert.ok(r.insights.some((t) => t.startsWith("Ainda não há")));
});
