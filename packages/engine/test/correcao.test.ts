import assert from "node:assert/strict";
import { test } from "node:test";
import { corrigir, letraCorreta } from "../src/correcao.ts";
import type { Resposta } from "../src/correcao.ts";
import { montarSimulado } from "../src/simulado.ts";
import type { Letra } from "../src/types.ts";
import { pool } from "./fixtures.ts";

const sim = () => montarSimulado(pool().slice(0, 6), { id: "S", seed: "c", criadoEm: "t" });

test("a letra correta acompanha o embaralhamento", () => {
  const s = sim();
  for (const it of s.itens) {
    const L = letraCorreta(it);
    const pos = "ABCDE".indexOf(L);
    assert.equal(it.ordem[pos], it.snapshot.correta, "a alternativa na posição da letra é a original correta");
  }
});

test("corrige acerto, erro e branco; percentual", () => {
  const s = sim();
  const resp: Resposta[] = s.itens.map((it, i) => ({ questaoId: it.questaoId, letra: i < 3 ? letraCorreta(it) : i === 3 ? (letraCorreta(it) === "A" ? "B" : "A") : null }));
  const c = corrigir(s, resp);
  assert.deepEqual([c.acertos, c.erros, c.brancos], [3, 1, 2]);
  assert.equal(c.percentual, 0.5);
  assert.equal(c.itens[5]?.respondida, false);
});

test("pontuação com penalização (estilo Cebraspe): erro tira ponto", () => {
  const s = sim();
  const resp: Resposta[] = s.itens.map((it, i) => ({ questaoId: it.questaoId, letra: i === 0 ? letraCorreta(it) : letraCorreta(it) === "A" ? "B" : "A" }));
  const c = corrigir(s, resp, { acerto: 1, erro: -1, branco: 0 });
  assert.equal(c.pontos, 1 - 5);
  assert.equal(c.pontosMax, 6);
});

test("rejeita resposta duplicada, questão fora do simulado e alternativa inexistente", () => {
  const s = sim();
  const id = s.itens[0]!.questaoId;
  assert.throws(() => corrigir(s, [{ questaoId: id, letra: "A" }, { questaoId: id, letra: "B" }]), /duplicada/);
  assert.throws(() => corrigir(s, [{ questaoId: "nao-existe", letra: "A" }]), /fora do simulado/);
  const so4 = montarSimulado([{ ...pool()[0]!, alternativas: ["a", "b", "c", "d"], correta: 1 }], { id: "q4", seed: "q", criadoEm: "t" });
  assert.throws(() => corrigir(so4, [{ questaoId: so4.itens[0]!.questaoId, letra: "E" as Letra }]), /não existe/);
});

test("peso da questão entra na pontuação", () => {
  const q = { ...pool()[0]!, peso: 3 };
  const s = montarSimulado([q], { id: "p", seed: "p", criadoEm: "t" });
  const c = corrigir(s, [{ questaoId: q.id, letra: letraCorreta(s.itens[0]!) }]);
  assert.equal(c.pontos, 3);
  assert.equal(c.pontosMax, 3);
});
