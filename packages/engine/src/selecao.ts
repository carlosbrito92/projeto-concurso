import { criarRng, embaralhar } from "./rng.ts";
import type { Rng } from "./rng.ts";
import type { Edital, Questao, StatusDireitos, StatusQuestao, StatusRevisao } from "./types.ts";

/** O que torna uma questão apta a chegar ao aluno. Regras do CLAUDE.md, aplicadas no motor. */
export interface PoliticaElegibilidade {
  direitosAceitos: readonly StatusDireitos[];
  statusAceitos: readonly StatusQuestao[];
  revisaoAceita: readonly StatusRevisao[];
  /** Questão com qualquer uma destas pendências está incompleta (imagem/tabela perdidas...). */
  pendenciasProibidas: readonly string[];
}

/** Produção: só o que está liberado juridicamente, ativo e revisado por humano. */
export const POLITICA_PADRAO: PoliticaElegibilidade = {
  direitosAceitos: ["liberada", "nao_aplicavel"],
  statusAceitos: ["ativa"],
  revisaoAceita: ["revisado"],
  pendenciasProibidas: ["imagem", "formatacao", "tabela", "revisar_texto"],
};

/** SÓ para desenvolvimento e testes: ignora direitos/revisão, mantém o resto. Nunca usar em produção. */
export const POLITICA_DESENVOLVIMENTO: PoliticaElegibilidade = {
  direitosAceitos: ["liberada", "nao_aplicavel", "pendente_juridico"],
  statusAceitos: ["ativa", "rascunho", "em_revisao"],
  revisaoAceita: ["automatico", "revisado"],
  pendenciasProibidas: ["imagem", "formatacao", "tabela", "revisar_texto"],
};

export function motivoDeExclusao(q: Questao, p: PoliticaElegibilidade): string | null {
  if (q.anulada) return "anulada";
  if (q.correta === undefined) return "sem_gabarito";
  if (!p.direitosAceitos.includes(q.direitos.status)) return "direitos";
  if (!p.statusAceitos.includes(q.status)) return "status";
  if (!p.revisaoAceita.includes(q.revisao.status)) return "revisao";
  const pend = q.pendencias ?? [];
  if (pend.some((x) => p.pendenciasProibidas.includes(x))) return "pendencia_incompleta";
  return null;
}

/** Chave estável da disciplina da questão (ex.: "D05" ou "D07+D08" quando a prova junta duas do edital). */
export function chaveDisciplina(q: Questao): string {
  const c = q.classificacao;
  if (c.disciplinaIds && c.disciplinaIds.length > 0) return c.disciplinaIds.join("+");
  if (c.disciplinaId) return c.disciplinaId;
  return c.disciplina;
}

/** Peso de cada chave de disciplina segundo o edital (nº de questões; grupos divididos igualmente). */
/**
 * Peso de cada disciplina do edital. Quando o edital só informa o total de um módulo/grupo, o peso dele é dividido entre as
 * disciplinas do grupo; com `disponiveis` (ids que têm questão no banco), a divisão ignora as ausentes, para o módulo
 * manter o peso que tem na prova mesmo quando alguma disciplina dele ainda não tem questão.
 */
export function pesosDoEdital(edital: Edital, disponiveis?: ReadonlySet<string>): Record<string, number> {
  const total = edital.prova.totalQuestoes || 1;
  const porId: Record<string, number> = {};
  for (const d of edital.disciplinas) if (d.questoes !== null) porId[d.id] = d.questoes / total;
  for (const g of edital.grupos ?? []) {
    const presentes = disponiveis ? g.disciplinas.filter((id) => disponiveis.has(id)) : g.disciplinas;
    const base = presentes.length > 0 ? presentes : g.disciplinas;
    for (const id of g.disciplinas) porId[id] = base.includes(id) ? g.questoes / total / base.length : 0;
  }
  return porId;
}

export function pesoDaChave(chave: string, porId: Record<string, number>): number {
  return chave.split("+").reduce((s, id) => s + (porId[id] ?? 0), 0);
}

export interface OpcoesSelecao {
  n: number;
  seed: string | number;
  politica?: PoliticaElegibilidade;
  /** Restringe a estas chaves de disciplina. */
  disciplinas?: readonly string[];
  /** Cotas fixas por chave de disciplina; o restante é distribuído por peso. */
  cotas?: Readonly<Record<string, number>>;
  /** Pesos por chave de disciplina (ex.: pesosDoEdital). Sem isso, todas valem igual. */
  pesos?: Readonly<Record<string, number>>;
  /** Questões a nunca repetir nesta seleção. */
  excluirIds?: Iterable<string>;
  /** Quantas vezes o aluno já viu cada questão (penaliza repetição, não proíbe). */
  vistas?: Readonly<Record<string, number>>;
  /** Fraqueza do aluno por item do edital (0 = domina, 1 = fraco): puxa mais questões desses assuntos. */
  foco?: Readonly<Record<string, number>>;
}

export interface ResultadoSelecao {
  questoes: Questao[];
  cotas: Record<string, number>;
  excluidas: Record<string, number>;
  avisos: string[];
}

/** Maior resto: reparte `n` inteiros em proporção aos pesos, de forma determinística. */
export function repartir(n: number, pesos: Record<string, number>): Record<string, number> {
  const chaves = Object.keys(pesos).sort();
  const soma = chaves.reduce((s, k) => s + (pesos[k] as number), 0);
  const out: Record<string, number> = {};
  if (chaves.length === 0 || n <= 0) return out;
  const base = chaves.map((k) => {
    const exato = soma > 0 ? (n * (pesos[k] as number)) / soma : n / chaves.length;
    return { k, piso: Math.floor(exato), resto: exato - Math.floor(exato) };
  });
  let falta = n - base.reduce((s, b) => s + b.piso, 0);
  const ordem = base.slice().sort((a, b) => b.resto - a.resto || (a.k < b.k ? -1 : 1));
  for (const b of ordem) {
    if (falta > 0) {
      b.piso += 1;
      falta -= 1;
    }
  }
  for (const b of base) out[b.k] = b.piso;
  return out;
}

function fraqueza(q: Questao, foco: Readonly<Record<string, number>> | undefined): number {
  if (!foco) return 0;
  const ids = q.classificacao.editalItemTrilha ?? (q.classificacao.editalItemId ? [q.classificacao.editalItemId] : []);
  return ids.reduce((m, id) => Math.max(m, foco[id] ?? 0), 0);
}

function escolher(
  candidatas: Questao[],
  k: number,
  rng: Rng,
  usadosGrupos: Set<string>,
  opc: OpcoesSelecao,
): Questao[] {
  const porAssunto = new Map<string, Questao[]>();
  for (const q of candidatas) {
    const chave = q.classificacao.editalItemId ?? "sem-assunto";
    const l = porAssunto.get(chave);
    if (l) l.push(q);
    else porAssunto.set(chave, [q]);
  }
  const escolhidas: Questao[] = [];
  const contagem = new Map<string, number>();
  while (escolhidas.length < k) {
    let melhorAssunto: string | null = null;
    let melhorPrioridade = Infinity;
    for (const chave of embaralhar([...porAssunto.keys()].sort(), rng)) {
      const livres = (porAssunto.get(chave) as Questao[]).filter((q) => !q.grupoEquivalencia || !usadosGrupos.has(q.grupoEquivalencia));
      if (livres.length === 0) continue;
      const f = Math.max(...livres.map((q) => fraqueza(q, opc.foco)));
      // Assunto em que só restam questões que o aluno já viu fica por último (só entra se não houver alternativa).
      const temNova = livres.some((q) => !(opc.vistas?.[q.id]));
      const prioridade = (contagem.get(chave) ?? 0) - 2 * f + (temNova ? 0 : 1000);
      if (prioridade < melhorPrioridade) {
        melhorPrioridade = prioridade;
        melhorAssunto = chave;
      }
    }
    if (melhorAssunto === null) break;
    const livres = (porAssunto.get(melhorAssunto) as Questao[]).filter((q) => !q.grupoEquivalencia || !usadosGrupos.has(q.grupoEquivalencia));
    let melhor: Questao | null = null;
    let melhorScore = -Infinity;
    for (const q of embaralhar(livres, rng)) {
      const score = -3 * (opc.vistas?.[q.id] ?? 0) + rng() * 0.5;
      if (score > melhorScore) {
        melhorScore = score;
        melhor = q;
      }
    }
    if (!melhor) break;
    escolhidas.push(melhor);
    if (melhor.grupoEquivalencia) usadosGrupos.add(melhor.grupoEquivalencia);
    contagem.set(melhorAssunto, (contagem.get(melhorAssunto) ?? 0) + 1);
    porAssunto.set(melhorAssunto, (porAssunto.get(melhorAssunto) as Questao[]).filter((q) => q !== melhor));
  }
  return escolhidas;
}

/**
 * Seleciona `n` questões: respeita a política de elegibilidade, reparte por disciplina (cota fixa ou peso do edital),
 * faz rodízio entre assuntos do edital, evita grupos de equivalência repetidos e favorece assuntos fracos do aluno.
 * Determinística: mesma semente e mesmo conjunto, mesmo resultado (independe da ordem do `pool`).
 */
export function selecionar(pool: readonly Questao[], opc: OpcoesSelecao): ResultadoSelecao {
  const politica = opc.politica ?? POLITICA_PADRAO;
  const rng = criarRng(opc.seed);
  const excluir = new Set(opc.excluirIds ?? []);
  const excluidas: Record<string, number> = {};
  const avisos: string[] = [];
  const elegiveis: Questao[] = [];
  for (const q of [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const motivo = excluir.has(q.id) ? "excluida_pelo_pedido" : motivoDeExclusao(q, politica);
    if (motivo) {
      excluidas[motivo] = (excluidas[motivo] ?? 0) + 1;
      continue;
    }
    if (opc.disciplinas && !opc.disciplinas.includes(chaveDisciplina(q))) {
      excluidas["fora_das_disciplinas"] = (excluidas["fora_das_disciplinas"] ?? 0) + 1;
      continue;
    }
    elegiveis.push(q);
  }

  const porDisc = new Map<string, Questao[]>();
  for (const q of elegiveis) {
    const k = chaveDisciplina(q);
    const l = porDisc.get(k);
    if (l) l.push(q);
    else porDisc.set(k, [q]);
  }
  if (elegiveis.length === 0) {
    avisos.push(
      "Nenhuma questão elegível pela política atual" +
        (Object.keys(excluidas).length ? ` (excluídas: ${Object.entries(excluidas).map(([m, c]) => `${m}=${c}`).join(", ")}).` : "."),
    );
    return { questoes: [], cotas: {}, excluidas, avisos };
  }

  // 1) cotas fixas; 2) restante por peso; 3) limita à oferta e redistribui o que sobrar
  const cotas: Record<string, number> = {};
  let restante = opc.n;
  for (const [k, v] of Object.entries(opc.cotas ?? {})) {
    if (!porDisc.has(k)) continue;
    const c = Math.min(v, restante, (porDisc.get(k) as Questao[]).length);
    cotas[k] = c;
    restante -= c;
  }
  const livres = [...porDisc.keys()].filter((k) => !(k in cotas));
  const oferta = (k: string) => (porDisc.get(k) as Questao[]).length;
  let ativos = livres.slice();
  while (restante > 0 && ativos.length > 0) {
    const pesos: Record<string, number> = {};
    for (const k of ativos) pesos[k] = opc.pesos ? Math.max(opc.pesos[k] ?? 0, 1e-6) : 1;
    const parte = repartir(restante, pesos);
    let usou = 0;
    const cheios: string[] = [];
    for (const k of ativos) {
      const quer = (cotas[k] ?? 0) + (parte[k] ?? 0);
      const pode = Math.min(quer, oferta(k));
      usou += pode - (cotas[k] ?? 0);
      cotas[k] = pode;
      if (pode >= oferta(k)) cheios.push(k);
    }
    restante -= usou;
    if (usou === 0) break;
    ativos = ativos.filter((k) => !cheios.includes(k));
  }

  const usadosGrupos = new Set<string>();
  const escolhidas: Questao[] = [];
  const aplicadas: Record<string, number> = {};
  for (const k of [...porDisc.keys()].sort()) {
    const q = escolher(porDisc.get(k) as Questao[], cotas[k] ?? 0, rng, usadosGrupos, opc);
    aplicadas[k] = q.length;
    escolhidas.push(...q);
  }
  if (escolhidas.length < opc.n) {
    avisos.push(`Só foi possível montar ${escolhidas.length} de ${opc.n} questões com a política e os filtros atuais.`);
  }
  return { questoes: escolhidas, cotas: aplicadas, excluidas, avisos };
}
