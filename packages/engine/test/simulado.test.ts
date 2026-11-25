import assert from "node:assert/strict";
import { test } from "node:test";
import { avisosDaQuestao } from "../src/avisos.ts";
import { montarSimulado, paraCliente, podeEmbaralhar } from "../src/simulado.ts";
import { pool, questao } from "./fixtures.ts";

const opc = { id: "S1", seed: "sim", criadoEm: "2026-01-01T00:00:00Z" };

test("ordem é permutação das alternativas e o simulado é determinístico", () => {
  const qs = pool().slice(0, 10);
  const a = montarSimulado(qs, opc), b = montarSimulado(qs, opc);
  assert.deepEqual(a, b);
  for (const it of a.itens) assert.deepEqual([...it.ordem].sort(), [0, 1, 2, 3, 4]);
  assert.ok(a.itens.some((it) => it.ordem.join() !== "0,1,2,3,4"), "ao menos uma foi embaralhada");
});

test("snapshot é cópia: editar a questão depois não altera o simulado", () => {
  const q = questao({ id: "orig" });
  const s = montarSimulado([q], opc);
  q.enunciado = "ALTERADO";
  q.alternativas[0] = "ALTERADA";
  assert.notEqual(s.itens[0]?.snapshot.enunciado, "ALTERADO");
  assert.notEqual(s.itens[0]?.snapshot.alternativas[0], "ALTERADA");
});

test("não embaralha: combinações I/II, 'todas as anteriores', números, imagens", () => {
  const mk = (alts: string[]) => questao({ id: "x", alternativas: alts });
  assert.equal(podeEmbaralhar(mk(["I, apenas.", "I e II, apenas.", "II e III, apenas.", "I, II e III.", "III, apenas."])), false);
  assert.equal(podeEmbaralhar(mk(["a", "b", "c", "d", "Todas as anteriores."])), false);
  assert.equal(podeEmbaralhar(mk(["10%", "12%", "15%", "18%", "20%"])), false);
  assert.equal(podeEmbaralhar(mk(["R$ 48,00.", "R$ 50,00.", "R$ 52,00.", "R$ 54,00.", "R$ 56,00."])), false);
  assert.equal(podeEmbaralhar(mk(["[alternativa em imagem]", "[alternativa em imagem]", "[alternativa em imagem]", "[alternativa em imagem]", "[alternativa em imagem]"])), false);
  assert.equal(podeEmbaralhar(mk(["A pena aumenta", "A pena diminui", "O réu é absolvido", "O processo é arquivado", "Nada ocorre"])), true);
});

test("paraCliente NÃO vaza gabarito, comentário nem assunto", () => {
  const q = questao({ id: "seg", comentario: "SEGREDO-COMENTARIO", correta: 3, classificacao: { disciplina: "Penal", disciplinaId: "D07", assunto: "SEGREDO-ASSUNTO", editalItemId: "D07:1" } });
  const cliente = paraCliente(montarSimulado([q], opc));
  const json = JSON.stringify(cliente);
  assert.ok(!json.includes("SEGREDO"));
  assert.ok(!/"correta"|"gabarito"/i.test(json));
  assert.deepEqual(Object.keys(cliente.itens[0] as object).sort(), ["alternativas", "avisos", "disciplina", "enunciado", "peso", "posicao", "questaoId", "temImagem"]);
  assert.equal(cliente.itens[0]?.alternativas.length, 5);
});

test("avisos de vigência e de gabarito não confirmado aparecem; somem só com revisão + vigenteEm", () => {
  const velha = questao({ id: "v", pendencias: ["verificar_vigencia", "gabarito_preliminar", "confirmar_assunto"], concurso: { banca: "FUMARC", ano: 2014 }, classificacao: { disciplina: "D", assunto: "x", classificacaoStatus: "sugerida" } });
  const cods = avisosDaQuestao(velha).map((a) => a.codigo);
  assert.deepEqual(cods, ["vigencia", "gabarito_nao_confirmado", "assunto_sugerido"]);
  assert.match(avisosDaQuestao(velha)[0]?.texto ?? "", /2014/);
  const revisada = { ...velha, revisao: { status: "revisado" as const }, fundamentacao: { fonte: "CP art. 1", vigenteEm: "2026-11" } };
  assert.ok(!avisosDaQuestao(revisada).some((a) => a.codigo === "vigencia"));
  const ia = questao({ id: "ia", origem: { tipo: "autoral_ia" }, revisao: { status: "automatico" } });
  assert.ok(avisosDaQuestao(ia).some((a) => a.codigo === "ia_sem_revisao"));
});
