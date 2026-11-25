import assert from "node:assert/strict";
import { test } from "node:test";
import { chaveDisciplina, pesosDoEdital, POLITICA_DESENVOLVIMENTO, POLITICA_PADRAO, repartir, selecionar } from "../src/selecao.ts";
import { edital, pool, questao } from "./fixtures.ts";

const ids = (qs: { id: string }[]) => qs.map((q) => q.id);

test("repartir: maior resto, soma exata e determinístico", () => {
  const r = repartir(10, { A: 0.5, B: 0.3, C: 0.2 });
  assert.deepEqual(r, { A: 5, B: 3, C: 2 });
  const s = repartir(7, { A: 1, B: 1, C: 1 });
  assert.equal(Object.values(s).reduce((a, b) => a + b, 0), 7);
  assert.deepEqual(repartir(7, { A: 1, B: 1, C: 1 }), s);
});

test("pesosDoEdital: nº de questões / total; grupo dividido igualmente", () => {
  const e = edital();
  assert.deepEqual(pesosDoEdital(e), { D01: 0.5, D02: 0.3, D03: 0.2 });
  const g = { ...e, disciplinas: e.disciplinas.map((d) => (d.id === "D02" || d.id === "D03" ? { ...d, questoes: null } : d)), grupos: [{ nome: "g", questoes: 5, disciplinas: ["D02", "D03"] }] };
  assert.deepEqual(pesosDoEdital(g), { D01: 0.5, D02: 0.25, D03: 0.25 });
});

test("chaveDisciplina junta ids quando a prova cobre mais de uma disciplina do edital", () => {
  const q = questao({ id: "x", classificacao: { disciplina: "Penal", disciplinaIds: ["D07", "D08"], assunto: null } });
  assert.equal(chaveDisciplina(q), "D07+D08");
});

test("seleciona n questões, sem repetir, e reparte pelo peso do edital", () => {
  const r = selecionar(pool(), { n: 10, seed: "s1", pesos: pesosDoEdital(edital()) });
  assert.equal(r.questoes.length, 10);
  assert.equal(new Set(ids(r.questoes)).size, 10);
  assert.deepEqual(r.cotas, { D01: 5, D02: 3, D03: 2 });
});

test("determinístico: mesma semente igual; independe da ordem do pool; semente diferente muda", () => {
  const a = selecionar(pool(), { n: 8, seed: "A" });
  const b = selecionar(pool().reverse(), { n: 8, seed: "A" });
  const c = selecionar(pool(), { n: 8, seed: "B" });
  assert.deepEqual(ids(a.questoes), ids(b.questoes));
  assert.notDeepEqual(ids(a.questoes), ids(c.questoes));
});

test("rodízio: com n = nº de assuntos, cada assunto aparece uma vez", () => {
  const r = selecionar(pool(), { n: 5, seed: "r", cotas: { D01: 2, D02: 2, D03: 1 } });
  const assuntos = r.questoes.map((q) => q.classificacao.editalItemId);
  assert.equal(new Set(assuntos).size, 5);
});

test("grupo de equivalência nunca se repete", () => {
  const p = pool().map((q, i) => ({ ...q, grupoEquivalencia: i % 2 === 0 ? "G-par" : "G-impar" }));
  const r = selecionar(p, { n: 5, seed: "g" });
  const grupos = r.questoes.map((q) => q.grupoEquivalencia);
  assert.equal(new Set(grupos).size, grupos.length);
  assert.ok(r.questoes.length <= 2);
  assert.ok(r.avisos.some((a) => a.includes("Só foi possível")));
});

test("política padrão barra o que não está liberado, ativo, revisado e completo", () => {
  const ruins = [
    questao({ id: "anulada", anulada: true, correta: undefined }),
    questao({ id: "direitos", direitos: { status: "pendente_juridico" } }),
    questao({ id: "rascunho", status: "rascunho" }),
    questao({ id: "sem-revisao", revisao: { status: "automatico" } }),
    questao({ id: "imagem", pendencias: ["imagem"] }),
    questao({ id: "tabela", pendencias: ["tabela"] }),
  ];
  const boa = questao({ id: "boa" });
  const r = selecionar([...ruins, boa], { n: 7, seed: "p" });
  assert.deepEqual(ids(r.questoes), ["boa"]);
  assert.deepEqual(r.excluidas, { anulada: 1, direitos: 1, status: 1, revisao: 1, pendencia_incompleta: 2 });
});

test("hoje nenhuma questão real é liberada: política padrão devolve vazio com aviso claro", () => {
  const reais = pool().map((q) => ({ ...q, direitos: { status: "pendente_juridico" as const }, status: "rascunho" as const, revisao: { status: "automatico" as const } }));
  const r = selecionar(reais, { n: 5, seed: "z" });
  assert.equal(r.questoes.length, 0);
  assert.match(r.avisos[0] as string, /Nenhuma questão elegível/);
  assert.equal(selecionar(reais, { n: 5, seed: "z", politica: POLITICA_DESENVOLVIMENTO }).questoes.length, 5);
});

test("anulada e sem gabarito nunca passam, nem na política de desenvolvimento", () => {
  const p = [questao({ id: "a", anulada: true, correta: undefined }), questao({ id: "b", correta: undefined })];
  assert.equal(selecionar(p, { n: 2, seed: "x", politica: POLITICA_DESENVOLVIMENTO }).questoes.length, 0);
});

test("falta de oferta numa disciplina é redistribuída às outras", () => {
  const p = pool().filter((q) => q.classificacao.disciplinaId !== "D03" || q.id.endsWith("-0"));
  const r = selecionar(p, { n: 10, seed: "f", pesos: pesosDoEdital(edital()) });
  assert.equal(r.questoes.length, 10);
  assert.equal(r.cotas["D03"], 1);
});

test("excluirIds e vistas: nunca repete as excluídas e prefere as não vistas", () => {
  const p = pool();
  const r1 = selecionar(p, { n: 6, seed: "e", excluirIds: ids(p).slice(0, 20) });
  assert.ok(r1.questoes.every((q) => !ids(p).slice(0, 20).includes(q.id)));
  const vistas = Object.fromEntries(ids(p).slice(0, 25).map((i) => [i, 3]));
  const r2 = selecionar(p, { n: 5, seed: "v", cotas: { D03: 5 }, vistas });
  assert.ok(!ids(r2.questoes).includes("Q-D031-0"), "a única já vista fica de fora quando há 5 não vistas");
  assert.equal(r2.questoes.length, 5);
});

test("foco: assunto fraco do aluno recebe mais questões", () => {
  const sem = selecionar(pool(), { n: 6, seed: "k", cotas: { D01: 6 } });
  const com = selecionar(pool(), { n: 4, seed: "k", cotas: { D01: 4 }, foco: { "D01:2": 1 } });
  const cnt = (qs: { classificacao: { editalItemId?: string } }[], id: string) => qs.filter((q) => q.classificacao.editalItemId === id).length;
  assert.equal(cnt(sem.questoes, "D01:1"), 3);
  assert.ok(cnt(com.questoes, "D01:2") > cnt(com.questoes, "D01:1"));
  assert.equal(POLITICA_PADRAO.statusAceitos.includes("rascunho"), false);
});

test("prefere assuntos com questão ainda não vista: não repete enquanto houver questão nova", () => {
  const p = pool();
  const vistas = Object.fromEntries(p.filter((q) => q.classificacao.editalItemId === "D01:1").map((q) => [q.id, 1]));
  const r = selecionar(p, { n: 6, seed: "nv", cotas: { D01: 6 }, vistas });
  assert.equal(r.questoes.filter((q) => q.classificacao.editalItemId === "D01:1").length, 0, "as 6 de D01:2 são novas e bastam");
  const todasVistas = Object.fromEntries(p.filter((q) => q.classificacao.disciplinaId === "D01").map((q) => [q.id, 1]));
  assert.equal(selecionar(p, { n: 4, seed: "nv", cotas: { D01: 4 }, vistas: todasVistas }).questoes.length, 4, "se não há nova, repete em vez de faltar");
});
