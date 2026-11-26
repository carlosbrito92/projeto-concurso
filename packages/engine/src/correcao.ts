import type { ItemSimulado, Simulado } from "./simulado.ts";
import type { Letra } from "./types.ts";
import { LETRAS } from "./types.ts";

export interface Resposta {
  questaoId: string;
  letra: Letra | null;
  tempoMs?: number;
  /** O aluno marcou "chutei". */
  chute?: boolean;
}

export interface Pontuacao {
  acerto: number;
  erro: number;
  branco: number;
}
/** FGV e FUMARC: 1 ponto por acerto, sem desconto. Bancas com penalização usam outra configuração. */
export const PONTUACAO_PADRAO: Pontuacao = { acerto: 1, erro: 0, branco: 0 };

/** Pontuação de um edital: acerto vale `pontosPorQuestao` (1), erro `pontosPorErro` (0 = sem desconto; -1 = Quadrix/Cebraspe), branco 0. */
export function pontuacaoDoEdital(prova?: { pontosPorQuestao?: number; pontosPorErro?: number }): Pontuacao {
  return { acerto: prova?.pontosPorQuestao ?? PONTUACAO_PADRAO.acerto, erro: prova?.pontosPorErro ?? PONTUACAO_PADRAO.erro, branco: 0 };
}

export interface ItemCorrigido {
  questaoId: string;
  posicao: number;
  respondida: boolean;
  acertou: boolean;
  letraMarcada: Letra | null;
  letraCorreta: Letra;
  pontos: number;
  pontosMax: number;
  tempoMs: number | null;
  chute: boolean;
}

export interface Correcao {
  itens: ItemCorrigido[];
  acertos: number;
  erros: number;
  brancos: number;
  pontos: number;
  pontosMax: number;
  percentual: number;
}

/** Letra correta NA ORDEM APRESENTADA ao aluno. Só roda no servidor. */
export function letraCorreta(item: ItemSimulado): Letra {
  const orig = item.snapshot.correta;
  if (orig === undefined) throw new Error(`Questão ${item.questaoId} sem gabarito: não deveria estar no simulado.`);
  const pos = item.ordem.indexOf(orig);
  if (pos < 0) throw new Error(`Ordem inválida para ${item.questaoId}.`);
  return LETRAS[pos] as Letra;
}

export function corrigir(simulado: Simulado, respostas: readonly Resposta[], pontuacao: Pontuacao = PONTUACAO_PADRAO): Correcao {
  const porId = new Map<string, Resposta>();
  for (const r of respostas) {
    if (porId.has(r.questaoId)) throw new Error(`Resposta duplicada para ${r.questaoId}.`);
    porId.set(r.questaoId, r);
  }
  const ids = new Set(simulado.itens.map((i) => i.questaoId));
  for (const id of porId.keys()) if (!ids.has(id)) throw new Error(`Resposta para questão fora do simulado: ${id}.`);

  let acertos = 0;
  let erros = 0;
  let brancos = 0;
  let pontos = 0;
  let pontosMax = 0;
  const itens: ItemCorrigido[] = simulado.itens.map((item, i) => {
    const r = porId.get(item.questaoId);
    const correta = letraCorreta(item);
    const marcada = r?.letra ?? null;
    if (marcada !== null && LETRAS.indexOf(marcada) >= item.ordem.length) {
      throw new RangeError(`Alternativa ${marcada} não existe na questão ${item.questaoId}.`);
    }
    const respondida = marcada !== null;
    const acertou = respondida && marcada === correta;
    const p = !respondida ? pontuacao.branco : acertou ? pontuacao.acerto : pontuacao.erro;
    if (!respondida) brancos++;
    else if (acertou) acertos++;
    else erros++;
    pontos += p * item.peso;
    pontosMax += pontuacao.acerto * item.peso;
    return {
      questaoId: item.questaoId,
      posicao: i + 1,
      respondida,
      acertou,
      letraMarcada: marcada,
      letraCorreta: correta,
      pontos: p * item.peso,
      pontosMax: pontuacao.acerto * item.peso,
      tempoMs: r?.tempoMs ?? null,
      chute: r?.chute ?? false,
    };
  });
  return { itens, acertos, erros, brancos, pontos, pontosMax, percentual: pontosMax > 0 ? pontos / pontosMax : 0 };
}
