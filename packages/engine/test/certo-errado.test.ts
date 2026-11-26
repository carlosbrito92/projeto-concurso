import assert from "node:assert/strict";
import { test } from "node:test";
import { corrigir, letraCorreta, pontuacaoDoEdital, PONTUACAO_PADRAO } from "../src/correcao.ts";
import type { Resposta } from "../src/correcao.ts";
import { gerarRelatorio } from "../src/relatorio.ts";
import { montarSimulado, paraCliente, podeEmbaralhar } from "../src/simulado.ts";
import { questao } from "./fixtures.ts";

/** Item Certo/Errado: "Certo" = índice 0, "Errado" = índice 1 (mesmo modelo de dados da múltipla escolha). */
const ce = (id: string, certo: boolean) => questao({ id, tipo: "CertoErrado", alternativas: ["Certo", "Errado"], correta: certo ? 0 : 1, gabaritoCertoErrado: certo });
const itens = () => [ce("C1", true), ce("C2", false), ce("C3", true), ce("C4", false), ce("C5", true), ce("C6", false)];
const sim = () => montarSimulado(itens(), { id: "S", seed: "x", criadoEm: "t" });

test("Certo/Errado nunca embaralha: A = Certo, B = Errado, sempre", () => {
  assert.equal(podeEmbaralhar(ce("X", true)), false);
  for (let k = 0; k < 20; k++) {
    const s = montarSimulado(itens(), { id: "S", seed: `s${k}`, criadoEm: "t", embaralharAlternativas: true });
    for (const it of s.itens) assert.deepEqual(it.ordem, [0, 1]);
    assert.deepEqual(s.itens.map((it) => letraCorreta(it)), ["A", "B", "A", "B", "A", "B"]);
  }
});

test("o navegador recebe o tipo do item e só as duas alternativas (sem gabarito)", () => {
  const cli = paraCliente(sim());
  assert.ok(cli.itens.every((i) => i.tipo === "CertoErrado" && i.alternativas.length === 2));
  assert.deepEqual(cli.itens[0]?.alternativas.map((a) => [a.letra, a.texto]), [["A", "Certo"], ["B", "Errado"]]);
  assert.ok(!/gabarito|correta/i.test(JSON.stringify(cli)));
});

test("pontuação do edital: sem desconto por padrão; -1 por erro quando o edital manda", () => {
  assert.deepEqual(pontuacaoDoEdital(), PONTUACAO_PADRAO);
  assert.deepEqual(pontuacaoDoEdital({}), PONTUACAO_PADRAO);
  assert.deepEqual(pontuacaoDoEdital({ pontosPorQuestao: 1, pontosPorErro: -1 }), { acerto: 1, erro: -1, branco: 0 });
  assert.deepEqual(pontuacaoDoEdital({ pontosPorQuestao: 2, pontosPorErro: -2 }), { acerto: 2, erro: -2, branco: 0 });
});

test("correção com desconto: acerto +1, erro -1, branco 0 (a nota pode ficar negativa)", () => {
  const s = sim();
  const marcar = (f: (i: number, certa: string) => "A" | "B" | null): Resposta[] => s.itens.map((it, i) => ({ questaoId: it.questaoId, letra: f(i, letraCorreta(it)) }));
  const pont = pontuacaoDoEdital({ pontosPorErro: -1 });
  // 3 acertos, 2 erros, 1 branco
  const c = corrigir(s, marcar((i, certa) => (i < 3 ? (certa as "A" | "B") : i < 5 ? (certa === "A" ? "B" : "A") : null)), pont);
  assert.deepEqual([c.acertos, c.erros, c.brancos], [3, 2, 1]);
  assert.equal(c.pontos, 1);
  assert.equal(c.pontosMax, 6);
  // tudo errado: nota negativa
  const ruim = corrigir(s, marcar((_, certa) => (certa === "A" ? "B" : "A")), pont);
  assert.equal(ruim.pontos, -6);
  // tudo em branco: zero (não punido)
  assert.equal(corrigir(s, [], pont).pontos, 0);
  // sem desconto, o erro não custa nada
  assert.equal(corrigir(s, marcar((_, certa) => (certa === "A" ? "B" : "A"))).pontos, 0);
});

test("relatório com desconto mostra a nota e explica o custo de errar; sem desconto fica como antes", () => {
  const s = sim();
  const resp: Resposta[] = s.itens.map((it, i) => ({ questaoId: it.questaoId, letra: i < 3 ? (letraCorreta(it) as "A" | "B") : i < 5 ? (letraCorreta(it) === "A" ? "B" : "A") : null, chute: i === 4 }));
  const pont = pontuacaoDoEdital({ pontosPorErro: -1 });
  const r = gerarRelatorio(s, resp, { pontuacao: pont });
  assert.equal(r.resumo.penalidade, -1);
  assert.equal(r.resumo.pontos, 1);
  assert.match(r.insights[0] ?? "", /Nota: 1 de 6 pontos \(3 acertos, 2 erros, 1 em branco\)/);
  assert.ok(r.insights.some((t) => /cada erro desconta 1 ponto/.test(t) && /passa de 50%/.test(t)), "explica o ponto de equilíbrio do chute");
  assert.ok(r.insights.some((t) => /chutou 1 item\(ns\): 0 certo\(s\) e 1 errado\(s\), saldo de -1 ponto/.test(t)));
  const sem = gerarRelatorio(s, resp);
  assert.equal(sem.resumo.penalidade, 0);
  assert.match(sem.insights[0] ?? "", /Você acertou 3 de 6/);
  assert.ok(!sem.insights.some((t) => /desconta/.test(t)));
});

test("ponto de equilíbrio do chute acompanha a pontuação (acerto 2, erro -1: 33%)", () => {
  const s = sim();
  const r = gerarRelatorio(s, [], { pontuacao: { acerto: 2, erro: -1, branco: 0 } });
  assert.ok(r.insights.some((t) => /passa de 33%/.test(t)));
});
