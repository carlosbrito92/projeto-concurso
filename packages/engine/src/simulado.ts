import { avisosDaQuestao } from "./avisos.ts";
import { criarRng, embaralhar } from "./rng.ts";
import type { Aviso, Letra, Questao } from "./types.ts";
import { LETRAS } from "./types.ts";

export interface ItemSimulado {
  questaoId: string;
  peso: number;
  /** ordem[posição apresentada] = índice original da alternativa. */
  ordem: number[];
  /** Cópia imutável da questão no momento da geração (editar a questão depois não muda o histórico do aluno). */
  snapshot: Questao;
}

export interface Simulado {
  id: string;
  seed: string;
  criadoEm: string;
  itens: ItemSimulado[];
}

export interface OpcoesSimulado {
  id: string;
  seed: string | number;
  /** ISO 8601 informado por quem chama: o motor não lê relógio. */
  criadoEm: string;
  embaralharAlternativas?: boolean;
  embaralharQuestoes?: boolean;
}

const PLACEHOLDER_IMAGEM = "[alternativa em imagem]";
const REFERE_OUTRAS = /\b(todas as (?:anteriores|alternativas|opções)|nenhuma das (?:anteriores|alternativas|opções)|as duas anteriores|ambas|anterior(?:es)?)\b/i;
const ROMANOS = /\b(?:VI|IV|V|III|II|I)\b/;
const NUMERICA = /^[\s\d.,%R$€:/-]+$/;

/** Há alternativas cuja ordem faz parte do sentido (combinações I/II, "todas as anteriores", números, imagens)? */
export function podeEmbaralhar(q: Questao): boolean {
  if (q.tipo === "AfirmacoesCombinadas" || q.tipo === "VerdadeiroFalso" || q.tipo === "CertoErrado") return false;
  const alts = q.alternativas;
  if (alts.some((a) => a === PLACEHOLDER_IMAGEM)) return false;
  if (alts.some((a) => REFERE_OUTRAS.test(a))) return false;
  if (alts.filter((a) => a.length <= 90 && ROMANOS.test(a) && !/[a-zà-ú]{4,}\s+[a-zà-ú]{4,}\s+[a-zà-ú]{4,}/.test(a)).length >= 2) return false;
  if (alts.every((a) => NUMERICA.test(a.trim()))) return false;
  return true;
}

export function montarSimulado(questoes: readonly Questao[], opc: OpcoesSimulado): Simulado {
  const rng = criarRng(`${opc.seed}:simulado`);
  const base = opc.embaralharQuestoes ? embaralhar(questoes, rng) : questoes.slice();
  const itens: ItemSimulado[] = base.map((q) => {
    const identidade = q.alternativas.map((_, i) => i);
    const ordem = opc.embaralharAlternativas !== false && podeEmbaralhar(q) ? embaralhar(identidade, rng) : identidade;
    return { questaoId: q.id, peso: q.peso ?? 1, ordem, snapshot: structuredClone(q) };
  });
  return { id: opc.id, seed: String(opc.seed), criadoEm: opc.criadoEm, itens };
}

/** O que o navegador recebe: sem gabarito, sem comentário, sem classificação detalhada. */
export interface ItemCliente {
  posicao: number;
  questaoId: string;
  /** Formato do item: a tela de Certo/Errado é diferente da de múltipla escolha. */
  tipo: Questao["tipo"];
  disciplina: string;
  enunciado: string;
  textoApoio?: string;
  alternativas: Array<{ letra: Letra; texto: string }>;
  temImagem: boolean;
  peso: number;
  avisos: Aviso[];
}

export function paraCliente(s: Simulado): { id: string; itens: ItemCliente[] } {
  return {
    id: s.id,
    itens: s.itens.map((it, i) => {
      const q = it.snapshot;
      const item: ItemCliente = {
        posicao: i + 1,
        questaoId: q.id,
        tipo: q.tipo,
        disciplina: q.classificacao.disciplina,
        enunciado: q.enunciado,
        alternativas: it.ordem.map((orig, pos) => ({ letra: LETRAS[pos] as Letra, texto: q.alternativas[orig] as string })),
        temImagem: (q.imagens?.length ?? 0) > 0,
        peso: it.peso,
        avisos: avisosDaQuestao(q),
      };
      if (q.textoApoio) item.textoApoio = q.textoApoio;
      return item;
    }),
  };
}
