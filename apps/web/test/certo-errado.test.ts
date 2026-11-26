import assert from "node:assert/strict";
import { test } from "node:test";
import { letraCorreta, POLITICA_PADRAO } from "@concurso/engine";
import { criarRepoDemo, CONCURSO_DEMO } from "../src/lib/repo/demo.ts";
import { criarSimulado, finalizarSimulado, panorama, registrarResposta, simuladoParaProva } from "../src/lib/servico.ts";
import type { Repositorio } from "../src/lib/tipos.ts";

const CRC = "crc-pr-quadrix-2022";
let n = 0;
const ctx = () => ({ agora: () => new Date(Date.UTC(2026, 0, 1, 12, 0, n++)), novoId: () => `sim-ce-${n++}`, aleatorio: () => String(n++) });

async function novo(repo: Repositorio, usuario: string, slug: string, qtd: number) {
  const id = await criarSimulado(repo, usuario, { concursoSlug: slug, n: qtd }, POLITICA_PADRAO, ctx());
  const comp = await repo.carregarSimuladoCompleto(usuario, id);
  assert.ok(comp);
  return { id, comp };
}

test("itens Certo/Errado: duas alternativas, nunca embaralhadas, e a tela recebe a regra de pontuação", async () => {
  const repo = criarRepoDemo();
  const { id, comp } = await novo(repo, "u1", CRC, 10);
  assert.ok(comp.simulado.itens.every((it) => it.snapshot.tipo === "CertoErrado" && it.snapshot.alternativas.length === 2));
  assert.ok(comp.simulado.itens.every((it) => it.ordem.join() === "0,1"));
  const tela = await simuladoParaProva(repo, "u1", id);
  assert.deepEqual(tela?.pontuacao, { acerto: 1, erro: -1 });
  assert.ok(tela?.itens.every((i) => i.tipo === "CertoErrado" && i.alternativas.map((a) => a.texto).join() === "Certo,Errado"));
  assert.ok(!/gabarito|correta/i.test(JSON.stringify(tela)), "a tela não recebe o gabarito");
  // concurso sem desconto continua como antes
  const outro = await novo(repo, "u1", CONCURSO_DEMO, 5);
  assert.deepEqual((await simuladoParaProva(repo, "u1", outro.id))?.pontuacao, { acerto: 1, erro: 0 });
});

test("nota com desconto: erros custam, em branco não custa, e o relatório mostra a nota", async () => {
  const repo = criarRepoDemo();
  const { id, comp } = await novo(repo, "u1", CRC, 10);
  const itens = comp.simulado.itens;
  // 4 certos, 3 errados, 3 em branco (os em branco ficam sem resposta)
  for (const [i, it] of itens.entries()) {
    const certa = letraCorreta(it);
    if (i < 4) assert.equal(await registrarResposta(repo, "u1", id, { posicao: i + 1, letra: certa }), "ok");
    else if (i < 7) assert.equal(await registrarResposta(repo, "u1", id, { posicao: i + 1, letra: certa === "A" ? "B" : "A" }), "ok");
  }
  const r = await finalizarSimulado(repo, "u1", id);
  assert.deepEqual([r.resumo.acertos, r.resumo.erros, r.resumo.brancos], [4, 3, 3]);
  assert.equal(r.resumo.pontos, 1);
  assert.equal(r.resumo.pontosMax, 10);
  assert.equal(r.resumo.penalidade, -1);
  assert.match(r.insights[0] ?? "", /Nota: 1 de 10 pontos \(4 acertos, 3 erros, 3 em branco\)/);
  // o panorama acumulado usa a mesma regra
  const pan = await panorama(repo, "u1", CRC);
  assert.equal(pan?.resumo.pontos, 1);
});

test("deixar em branco depois de responder volta a valer 0, não erro", async () => {
  const repo = criarRepoDemo();
  const { id, comp } = await novo(repo, "u1", CRC, 5);
  const it0 = comp.simulado.itens[0]!;
  const errada = letraCorreta(it0) === "A" ? "B" : "A";
  await registrarResposta(repo, "u1", id, { posicao: 1, letra: errada });
  assert.equal(await registrarResposta(repo, "u1", id, { posicao: 1, letra: null }), "ok"); // "Deixar em branco"
  const r = await finalizarSimulado(repo, "u1", id);
  assert.deepEqual([r.resumo.acertos, r.resumo.erros, r.resumo.brancos, r.resumo.pontos], [0, 0, 5, 0]);
});

test("sem desconto (múltipla escolha): erro continua valendo 0 e o relatório não fala em nota", async () => {
  const repo = criarRepoDemo();
  const { id, comp } = await novo(repo, "u1", CONCURSO_DEMO, 5);
  for (const [i, it] of comp.simulado.itens.entries()) await registrarResposta(repo, "u1", id, { posicao: i + 1, letra: letraCorreta(it) === "A" ? "B" : "A" });
  const r = await finalizarSimulado(repo, "u1", id);
  assert.equal(r.resumo.pontos, 0);
  assert.equal(r.resumo.penalidade, 0);
  assert.ok(!r.insights.some((t) => /Nota:|desconta/.test(t)));
});

test("a seleção do CRC cobre os três módulos em proporção próxima da prova (40/30/50 de 120)", async () => {
  const repo = criarRepoDemo();
  const { comp } = await novo(repo, "u1", CRC, 30);
  const edital = await repo.obterEdital(CRC);
  const modulo = (did: string) => (edital?.grupos ?? []).find((g) => g.disciplinas.includes(did))?.nome;
  const cont: Record<string, number> = {};
  for (const it of comp.simulado.itens) {
    const m = modulo(it.snapshot.classificacao.disciplinaId as string) ?? "?";
    cont[m] = (cont[m] ?? 0) + 1;
  }
  // 30 questões do banco de demonstração: 10 / 7,5 / 12,5 de cota; Atualidades só tem 1 item no edital (1 questão fictícia),
  // então o excedente do módulo é redistribuído. A proporção exata é testada no motor (pesosDoEdital); aqui: nenhum módulo some nem domina.
  const b = cont["Conhecimentos Básicos"] ?? 0, c = cont["Conhecimentos Complementares"] ?? 0, e = cont["Conhecimentos Específicos"] ?? 0;
  assert.equal(b + c + e, 30);
  assert.ok(b >= 9 && b <= 12, JSON.stringify(cont));
  assert.ok(c >= 4 && c <= 8, JSON.stringify(cont));
  assert.ok(e >= 11 && e <= 14, JSON.stringify(cont));
});
