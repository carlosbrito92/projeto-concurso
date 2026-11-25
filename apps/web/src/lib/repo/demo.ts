import { carregarEditalDoRepo, gerarQuestoesDemo } from "../demo-dados.ts";
import type { Repositorio } from "../tipos.ts";
import { criarRepoMemoria } from "./memoria.ts";

export const CONCURSO_DEMO = "pc-mg-fgv-2024";

/** Repositório de demonstração: edital REAL (público) + questões FICTÍCIAS. */
export function criarRepoDemo(): Repositorio {
  const { edital, orgao, editalNome } = carregarEditalDoRepo(CONCURSO_DEMO);
  return criarRepoMemoria({
    concursos: [
      {
        resumo: { slug: CONCURSO_DEMO, orgao, banca: edital.concurso.banca, cargo: edital.concurso.cargo, ano: edital.concurso.ano, edital: editalNome, totalQuestoes: edital.prova.totalQuestoes },
        edital,
        pool: gerarQuestoesDemo(edital),
      },
    ],
  });
}
