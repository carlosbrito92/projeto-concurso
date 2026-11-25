import type { Edital, Questao } from "../src/types.ts";

/** Questões 100% sintéticas (nenhum texto de prova real). */
export function questao(over: Partial<Questao> & { id: string }): Questao {
  const base: Questao = {
    id: over.id,
    tipo: "MultiplaEscolha",
    enunciado: `Enunciado sintético ${over.id}.`,
    alternativas: ["Alfa", "Beta", "Gama", "Delta", "Epsilon"].map((t) => `${t} ${over.id}`),
    correta: 2,
    anulada: false,
    classificacao: { disciplina: "Disciplina Um", disciplinaId: "D01", assunto: "Assunto", editalItemId: "D01:1", editalItemTrilha: ["D01:1"] },
    concurso: { banca: "BANCA", ano: 2024 },
    origem: { tipo: "prova_real" },
    direitos: { status: "liberada" },
    revisao: { status: "revisado" },
    status: "ativa",
    pendencias: [],
  };
  return { ...base, ...over };
}

/** 3 disciplinas; D01 com 2 assuntos (D01:1, D01:2), D02 com 2 (D02:1, D02:2), D03 com 1. */
export function pool(): Questao[] {
  const out: Questao[] = [];
  const mk = (disc: string, nome: string, item: string, qtd: number, pai?: string) => {
    for (let i = 0; i < qtd; i++) {
      out.push(
        questao({
          id: `Q-${item.replace(":", "")}-${i}`,
          correta: i % 5,
          classificacao: {
            disciplina: nome,
            disciplinaId: disc,
            assunto: `Assunto ${item}`,
            editalItemId: item,
            editalItemTrilha: pai ? [pai, item] : [item],
          },
        }),
      );
    }
  };
  mk("D01", "Disciplina Um", "D01:1", 6);
  mk("D01", "Disciplina Um", "D01:2", 6);
  mk("D02", "Disciplina Dois", "D02:1", 6);
  mk("D02", "Disciplina Dois", "D02:2", 6);
  mk("D03", "Disciplina Três", "D03:1", 6);
  return out;
}

export function edital(): Edital {
  const item = (id: string, numero: string, pai: string | null = null) => ({ id, numero, texto: `Item ${id}.`, pai });
  return {
    concurso: { slug: "sintetico", banca: "BANCA", ano: 2024, cargo: "Cargo" },
    prova: { totalQuestoes: 10 },
    disciplinas: [
      { id: "D01", nome: "Disciplina Um", questoes: 5, peso: 0.5, itens: [item("D01:1", "1"), item("D01:2", "2")] },
      { id: "D02", nome: "Disciplina Dois", questoes: 3, peso: 0.3, itens: [item("D02:1", "1"), item("D02:2", "2")] },
      { id: "D03", nome: "Disciplina Três", questoes: 2, peso: 0.2, itens: [item("D03:1", "1")] },
    ],
  };
}
