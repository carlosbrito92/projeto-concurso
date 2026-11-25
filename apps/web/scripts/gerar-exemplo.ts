/**
 * Gera src/lib/exemplo-relatorio.json: o relatório de exemplo mostrado na landing.
 * Usa o motor real sobre o edital real e questões FICTÍCIAS; um aluno simulado, com semente fixa (saída reproduzível).
 * Uso: node scripts/gerar-exemplo.ts
 */
import { writeFileSync } from "node:fs";
import { criarRng, gerarRelatorioAcumulado, letraCorreta, LETRAS, montarSimulado, pesosDoEdital, selecionar, POLITICA_PADRAO } from "@concurso/engine";
import type { Resposta, Sessao } from "@concurso/engine";
import { carregarEditalDoRepo, gerarQuestoesDemo } from "../src/lib/demo-dados.ts";

const { edital } = carregarEditalDoRepo("pc-mg-fgv-2024");
const pool = gerarQuestoesDemo(edital);
// probabilidade de acerto do aluno fictício por disciplina
const p: Record<string, number> = { D01: 0.9, D02: 0.55, D03: 0.8, D04: 0.4, D05: 0.7, D06: 0.5, D07: 0.3, D08: 0.25, D09: 0.3, D10: 0.6, D11: 0.2, D12: 0.5 };
const rng = criarRng("exemplo-landing");
const usadas = new Set<string>();
const sessoes: Sessao[] = [];
for (let k = 0; k < 3; k++) {
  const sel = selecionar(pool, { n: 20, seed: `exemplo${k}`, politica: POLITICA_PADRAO, pesos: pesosDoEdital(edital), excluirIds: usadas });
  sel.questoes.forEach((q) => usadas.add(q.id));
  const sim = montarSimulado(sel.questoes, { id: `ex${k}`, seed: `exemplo${k}`, criadoEm: "2026-01-01T12:00:00Z" });
  const respostas: Resposta[] = sim.itens.map((it) => {
    const certa = letraCorreta(it);
    const acerta = rng() < (p[it.snapshot.classificacao.disciplinaId as string] ?? 0.5);
    const outras = LETRAS.slice(0, it.ordem.length).filter((x) => x !== certa);
    return { questaoId: it.questaoId, letra: acerta ? certa : (outras[Math.floor(rng() * outras.length)] as typeof certa), tempoMs: 45000 + Math.floor(rng() * 70000), chute: rng() < 0.08 };
  });
  sessoes.push({ simulado: sim, respostas });
}
const r = gerarRelatorioAcumulado(sessoes, { edital });
// o exemplo mostra o panorama; o caderno de erros (com comentários fictícios) não entra
const saida = { ...r, cadernoDeErros: [], avisos: [] };
writeFileSync(new URL("../src/lib/exemplo-relatorio.json", import.meta.url), JSON.stringify(saida, null, 1) + "\n");
console.log(`exemplo gerado: ${r.resumo.total} questões, ${r.resumo.acertos} acertos, ${r.focos.length} focos`);
