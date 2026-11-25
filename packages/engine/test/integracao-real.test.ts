/**
 * Roda o motor sobre as 280 questões reais, SE os JSONs existirem na máquina (eles não vão ao Git).
 * Sem os arquivos, o teste é pulado. Usa a política de desenvolvimento só aqui.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { letraCorreta } from "../src/correcao.ts";
import { gerarRelatorio } from "../src/relatorio.ts";
import { pesosDoEdital, POLITICA_DESENVOLVIMENTO, selecionar } from "../src/selecao.ts";
import { montarSimulado, paraCliente } from "../src/simulado.ts";
import type { Edital, Questao } from "../src/types.ts";

const raiz = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const provas = join(raiz, "conteudo", "provas");
const existe = existsSync(provas) && readdirSync(provas).some((d) => existsSync(join(provas, d, "02-json", "questoes.json")));

function carregar(slugProva: string, slugConcurso: string): { qs: Questao[]; ed: Edital } {
  const qs = JSON.parse(readFileSync(join(provas, slugProva, "02-json", "questoes.json"), "utf8")) as Questao[];
  const ed = JSON.parse(readFileSync(join(raiz, "conteudo", "concursos", slugConcurso, "02-json", "edital.json"), "utf8")) as Edital;
  return { qs, ed };
}

test("questões reais: política padrão não libera nada (todas pendentes de direitos)", { skip: !existe }, () => {
  const { qs } = carregar("pc-mg-fgv-2024-investigador-t1", "pc-mg-fgv-2024");
  const r = selecionar(qs, { n: 10, seed: "real" });
  assert.equal(r.questoes.length, 0);
  assert.ok((r.excluidas["direitos"] ?? 0) + (r.excluidas["status"] ?? 0) > 0);
});

test("questões reais PCMG 2024: seleciona 30 por peso do edital, corrige e gera relatório", { skip: !existe }, () => {
  const { qs, ed } = carregar("pc-mg-fgv-2024-investigador-t1", "pc-mg-fgv-2024");
  const sel = selecionar(qs, { n: 30, seed: "real-1", politica: POLITICA_DESENVOLVIMENTO, pesos: pesosDoEdital(ed) });
  assert.equal(sel.questoes.length, 30);
  assert.ok(sel.questoes.every((q) => !q.anulada && q.correta !== undefined));
  const sim = montarSimulado(sel.questoes, { id: "R1", seed: "real-1", criadoEm: "2026-01-01T00:00:00Z" });
  assert.ok(!JSON.stringify(paraCliente(sim)).includes('"correta"'));
  // aluno que acerta metade
  const resp = sim.itens.map((it, i) => ({ questaoId: it.questaoId, letra: i % 2 === 0 ? letraCorreta(it) : null }));
  const rel = gerarRelatorio(sim, resp, { edital: ed });
  assert.equal(rel.resumo.acertos, 15);
  assert.equal(rel.resumo.brancos, 15);
  assert.ok(rel.porDisciplina.length >= 8);
  assert.ok(rel.focos.length > 0 && rel.focos.every((f) => f.rotulo.length > 0));
});

test("questões reais de todas as provas: nenhuma seleção devolve anulada, imagem ou sem gabarito", { skip: !existe }, () => {
  const todas = [
    carregar("pc-mg-fgv-2024-investigador-t1", "pc-mg-fgv-2024"),
    carregar("pc-am-fgv-2021-investigador-t1", "pc-am-fgv-2021"),
    carregar("pc-ma-fgv-2012-investigador-t1", "pc-ma-fgv-2012"),
    carregar("pc-mg-fumarc-2014-investigador-ca", "pc-mg-fumarc-2014"),
  ];
  for (const { qs, ed } of todas) {
    const sel = selecionar(qs, { n: 40, seed: "todas", politica: POLITICA_DESENVOLVIMENTO, pesos: pesosDoEdital(ed) });
    assert.ok(sel.questoes.length > 0);
    assert.ok(sel.questoes.every((q) => !q.anulada && !(q.pendencias ?? []).includes("imagem") && q.correta !== undefined));
  }
});
