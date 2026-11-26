import { avisosDaQuestao } from "./avisos.ts";
import { corrigir, PONTUACAO_PADRAO } from "./correcao.ts";
import type { Correcao, Pontuacao, Resposta } from "./correcao.ts";
import { chaveDisciplina, pesoDaChave, pesosDoEdital } from "./selecao.ts";
import type { Simulado } from "./simulado.ts";
import type { Aviso, Edital, Letra, Questao } from "./types.ts";

export type Nivel = "forte" | "atencao" | "critico" | "indefinido";

export interface Limiares {
  /** Taxa suavizada a partir da qual o domínio é "forte". */
  forte: number;
  /** Abaixo disto é "crítico"; entre os dois, "atenção". */
  atencao: number;
  /** Menos questões que isto = "indefinido" (evidência insuficiente). */
  minimoParaAvaliar: number;
  /** Força da suavização para a média geral (pseudo-questões). */
  suavizacao: number;
}
export const LIMIARES_PADRAO: Limiares = { forte: 0.75, atencao: 0.5, minimoParaAvaliar: 3, suavizacao: 2 };

export interface Linha {
  chave: string;
  nome: string;
  n: number;
  acertos: number;
  brancos: number;
  taxa: number;
  taxaSuavizada: number;
  nivel: Nivel;
  /** Peso da disciplina na prova, segundo o edital (0 se desconhecido). */
  peso: number;
  tempoMedioMs: number | null;
  chutes: number;
}

export interface LinhaAssunto extends Linha {
  itemId: string;
  numero: string | null;
  trilha: string[];
  profundidade: number;
  /** true quando agrega filhos (o assunto-pai de questões classificadas mais abaixo). */
  agregado: boolean;
  disciplinaChave: string;
}

export interface Foco {
  /** "assunto": item do edital com evidência própria. "disciplina": faltou evidência por assunto, o foco sobe de nível. */
  escopo: "assunto" | "disciplina";
  itemId: string;
  rotulo: string;
  disciplina: string;
  prioridade: number;
  n: number;
  taxa: number;
  motivo: string;
}

export interface ErroDoAluno {
  questaoId: string;
  posicao: number;
  disciplina: string;
  assuntoTrilha: string[];
  letraMarcada: Letra | null;
  letraCorreta: Letra;
  comentario: string | null;
}

export interface Relatorio {
  resumo: {
    total: number;
    acertos: number;
    erros: number;
    brancos: number;
    percentual: number;
    pontos: number;
    pontosMax: number;
    /** Pontos por erro (negativo = desconto). 0 quando o edital não desconta. */
    penalidade: number;
    tempoMedioMs: number | null;
    chutes: { total: number; acertos: number };
  };
  porDisciplina: Linha[];
  porAssunto: LinhaAssunto[];
  focos: Foco[];
  cadernoDeErros: ErroDoAluno[];
  avisos: Array<Aviso & { questoes: number }>;
  insights: string[];
}

interface Acum {
  n: number;
  acertos: number;
  brancos: number;
  chutes: number;
  tempo: number;
  comTempo: number;
}
const novo = (): Acum => ({ n: 0, acertos: 0, brancos: 0, chutes: 0, tempo: 0, comTempo: 0 });

function nivelDe(n: number, taxaS: number, l: Limiares): Nivel {
  if (n < l.minimoParaAvaliar) return "indefinido";
  if (taxaS >= l.forte) return "forte";
  if (taxaS >= l.atencao) return "atencao";
  return "critico";
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(".", ","));

export interface OpcoesRelatorio {
  edital?: Edital;
  limiares?: Partial<Limiares>;
  pontuacao?: Pontuacao;
  maxFocos?: number;
}

export interface Sessao {
  simulado: Simulado;
  respostas: readonly Resposta[];
}

/** Relatório de um simulado. */
export function gerarRelatorio(simulado: Simulado, respostas: readonly Resposta[], opc: OpcoesRelatorio = {}): Relatorio {
  return gerarRelatorioAcumulado([{ simulado, respostas }], opc);
}

/**
 * Relatório sobre VÁRIOS simulados do mesmo aluno. É assim que a evidência por assunto se forma:
 * um simulado de 30 questões raramente tem 3 do mesmo item do edital, o histórico tem.
 */
export function gerarRelatorioAcumulado(sessoes: readonly Sessao[], opc: OpcoesRelatorio = {}): Relatorio {
  const lim: Limiares = { ...LIMIARES_PADRAO, ...opc.limiares };
  const itensSessao = sessoes.map((s) => ({ s, cor: corrigir(s.simulado, s.respostas, opc.pontuacao ?? PONTUACAO_PADRAO) }));
  const cor: Correcao = {
    itens: itensSessao.flatMap((x) => x.cor.itens),
    acertos: itensSessao.reduce((a, x) => a + x.cor.acertos, 0),
    erros: itensSessao.reduce((a, x) => a + x.cor.erros, 0),
    brancos: itensSessao.reduce((a, x) => a + x.cor.brancos, 0),
    pontos: itensSessao.reduce((a, x) => a + x.cor.pontos, 0),
    pontosMax: itensSessao.reduce((a, x) => a + x.cor.pontosMax, 0),
    percentual: 0,
  };
  cor.percentual = cor.pontosMax > 0 ? cor.pontos / cor.pontosMax : 0;
  const snapshots = itensSessao.flatMap((x) => x.s.simulado.itens.map((i) => i.snapshot));
  const pesos = opc.edital ? pesosDoEdital(opc.edital) : {};
  const textoItem = new Map<string, { numero: string; texto: string }>();
  for (const d of opc.edital?.disciplinas ?? []) for (const i of d.itens) textoItem.set(i.id, { numero: i.numero, texto: i.texto });

  const geralN = cor.itens.length;
  const p0 = geralN > 0 ? cor.acertos / geralN : 0;
  const suav = (a: number, n: number) => (a + lim.suavizacao * p0) / (n + lim.suavizacao);

  const disc = new Map<string, Acum & { nome: string }>();
  const nos = new Map<string, Acum & { nome: string; numero: string | null; trilha: string[]; disc: string; folha: boolean }>();
  const tempos: number[] = [];
  const contAvisos = new Map<string, Aviso & { questoes: number }>();
  const erros: ErroDoAluno[] = [];
  const nomeDoNo = (id: string, fallback: string | null) => {
    const t = textoItem.get(id);
    return t ? t.texto.replace(/[.;:]+$/, "").trim() : (fallback ?? id);
  };

  cor.itens.forEach((ci, i) => {
    const q = snapshots[i] as Questao;
    const chave = chaveDisciplina(q);
    const d = disc.get(chave) ?? { ...novo(), nome: q.classificacao.disciplina };
    disc.set(chave, d);
    const trilha = q.classificacao.editalItemTrilha ?? (q.classificacao.editalItemId ? [q.classificacao.editalItemId] : []);
    const alvos: Array<Acum> = [d];
    trilha.forEach((id, idx) => {
      const ultimo = idx === trilha.length - 1;
      const no = nos.get(id) ?? {
        ...novo(),
        nome: nomeDoNo(id, ultimo ? q.classificacao.assunto : null),
        numero: textoItem.get(id)?.numero ?? (ultimo ? (q.classificacao.editalItem ?? null) : null),
        trilha: trilha.slice(0, idx + 1),
        disc: chave,
        folha: false,
      };
      if (ultimo) no.folha = true;
      nos.set(id, no);
      alvos.push(no);
    });
    for (const a of alvos) {
      a.n += 1;
      if (ci.acertou) a.acertos += 1;
      if (!ci.respondida) a.brancos += 1;
      if (ci.chute) a.chutes += 1;
      if (ci.tempoMs !== null) {
        a.tempo += ci.tempoMs;
        a.comTempo += 1;
      }
    }
    if (ci.tempoMs !== null) tempos.push(ci.tempoMs);
    for (const av of avisosDaQuestao(q)) {
      const k = contAvisos.get(av.codigo);
      if (k) k.questoes += 1;
      else contAvisos.set(av.codigo, { ...av, questoes: 1 });
    }
    if (!ci.acertou) {
      erros.push({
        questaoId: ci.questaoId,
        posicao: ci.posicao,
        disciplina: q.classificacao.disciplina,
        assuntoTrilha: trilha.map((id) => nomeDoNo(id, null)),
        letraMarcada: ci.letraMarcada,
        letraCorreta: ci.letraCorreta,
        comentario: q.comentario ?? null,
      });
    }
  });

  const linha = (chave: string, nome: string, a: Acum): Linha => ({
    chave,
    nome,
    n: a.n,
    acertos: a.acertos,
    brancos: a.brancos,
    taxa: a.n ? a.acertos / a.n : 0,
    taxaSuavizada: suav(a.acertos, a.n),
    nivel: nivelDe(a.n, suav(a.acertos, a.n), lim),
    peso: pesoDaChave(chave, pesos),
    tempoMedioMs: a.comTempo ? a.tempo / a.comTempo : null,
    chutes: a.chutes,
  });

  const porDisciplina = [...disc.entries()].map(([k, a]) => linha(k, a.nome, a)).sort((x, y) => x.taxaSuavizada - y.taxaSuavizada);
  const porAssunto: LinhaAssunto[] = [...nos.entries()]
    .map(([id, a]) => ({
      ...linha(id, a.nome, a),
      peso: pesoDaChave(a.disc, pesos),
      itemId: id,
      numero: a.numero,
      trilha: a.trilha,
      profundidade: a.trilha.length,
      agregado: !a.folha,
      disciplinaChave: a.disc,
    }))
    .sort((x, y) => x.taxaSuavizada - y.taxaSuavizada || y.n - x.n);

  // focos: onde estudar. Peso da disciplina × quanto falta × confiança na medida (n pequeno vale menos).
  const nomeDisc = (k: string) => disc.get(k)?.nome ?? k;
  const cand = porAssunto
    .filter((a) => (a.nivel === "critico" || a.nivel === "atencao") && a.n >= lim.minimoParaAvaliar)
    .map((a) => ({ a, prioridade: (a.peso || 1 / Math.max(disc.size, 1)) * (1 - a.taxaSuavizada) * (a.n / (a.n + 2)) }))
    .sort((x, y) => y.prioridade - x.prioridade);
  const candidatosFoco: Foco[] = [];
  for (const { a, prioridade } of cand) {
    const filhoIgual = cand.some(({ a: b }) => b.itemId !== a.itemId && b.trilha.includes(a.itemId) && b.n === a.n);
    if (filhoIgual) continue;
    candidatosFoco.push({
      escopo: "assunto",
      itemId: a.itemId,
      rotulo: a.numero ? `${a.numero} ${a.nome}` : a.nome,
      disciplina: nomeDisc(a.disciplinaChave),
      prioridade: Math.round(prioridade * 1000) / 1000,
      n: a.n,
      taxa: a.taxa,
      motivo: `${a.acertos} de ${a.n} (${pct(a.taxa)}) em ${nomeDisc(a.disciplinaChave)}${a.peso ? `, disciplina com ${pct(a.peso)} da prova` : ""}.`,
    });
  }
  // Disciplina fraca sem nenhum assunto com evidência própria: o foco sobe para a disciplina.
  const cobertas = new Set(candidatosFoco.map((f) => porAssunto.find((x) => x.itemId === f.itemId)?.disciplinaChave));
  for (const l of porDisciplina) {
    if ((l.nivel !== "critico" && l.nivel !== "atencao") || cobertas.has(l.chave)) continue;
    candidatosFoco.push({
      escopo: "disciplina",
      itemId: l.chave,
      rotulo: l.nome,
      disciplina: l.nome,
      prioridade: Math.round((l.peso || 1 / Math.max(disc.size, 1)) * (1 - l.taxaSuavizada) * (l.n / (l.n + 2)) * 1000) / 1000,
      n: l.n,
      taxa: l.taxa,
      motivo: `${l.acertos} de ${l.n} (${pct(l.taxa)}); poucas questões por assunto para apontar o item exato${l.peso ? `, disciplina com ${pct(l.peso)} da prova` : ""}.`,
    });
  }
  const focos = candidatosFoco.sort((x, y) => y.prioridade - x.prioridade).slice(0, opc.maxFocos ?? 5);

  const insights: string[] = [];
  const pont = opc.pontuacao ?? PONTUACAO_PADRAO;
  const penalidade = pont.erro < 0 ? pont.erro : 0;
  if (penalidade < 0) {
    // Com desconto, a nota é acertos menos erros: a porcentagem de acertos esconde o custo de errar.
    insights.push(`Nota: ${fmt(cor.pontos)} de ${fmt(cor.pontosMax)} pontos (${cor.acertos} ${cor.acertos === 1 ? "acerto" : "acertos"}, ${cor.erros} ${cor.erros === 1 ? "erro" : "erros"}, ${cor.brancos} em branco).`);
    const compensa = Math.round((Math.abs(penalidade) / (pont.acerto + Math.abs(penalidade))) * 100);
    insights.push(`Neste concurso cada erro desconta ${fmt(Math.abs(penalidade))} ponto(s) e o item em branco não pontua: só vale arriscar quando você acha que a chance de acertar passa de ${compensa}%.`);
  } else {
    insights.push(`Você acertou ${cor.acertos} de ${geralN} (${pct(cor.percentual)})${cor.brancos ? `, com ${cor.brancos} em branco` : ""}.`);
  }
  const avaliadas = porDisciplina.filter((l) => l.nivel !== "indefinido");
  for (const f of focos.slice(0, 3)) insights.push(`Prioridade: ${f.rotulo}: ${f.motivo}`);
  if (focos.length === 0 && cor.acertos < geralN) {
    insights.push(
      `Ainda não há ${lim.minimoParaAvaliar} questões ou mais por disciplina para apontar onde focar (este simulado tem ${geralN} questões em ${disc.size} disciplina(s)). ` +
        "Faça outros simulados ou um simulado de uma disciplina só; enquanto isso, use o caderno de erros.",
    );
  }
  const melhor = avaliadas.filter((l) => l.nivel === "forte").at(-1);
  if (melhor) insights.push(`Ponto forte: ${melhor.nome} (${melhor.acertos}/${melhor.n}).`);
  const chutes = cor.itens.filter((i) => i.chute);
  if (chutes.length) {
    const ok = chutes.filter((i) => i.acertou).length;
    insights.push(
      penalidade < 0
        ? `Você chutou ${chutes.length} item(ns): ${ok} certo(s) e ${chutes.length - ok} errado(s), saldo de ${fmt(ok * pont.acerto + (chutes.length - ok) * penalidade)} ponto(s); acerto por sorte não indica domínio.`
        : `Você chutou ${chutes.length} questão(ões) e acertou ${ok}: acerto por sorte não indica domínio.`,
    );
  }
  if (porDisciplina.some((l) => l.nivel === "indefinido")) {
    insights.push(`Há disciplinas com menos de ${lim.minimoParaAvaliar} questões neste simulado: o resultado delas é só indicativo.`);
  }
  for (const av of contAvisos.values()) {
    if (av.codigo === "vigencia") insights.push(`${av.questoes} questão(ões) vêm de prova antiga: confira a legislação vigente antes de concluir o que errou.`);
  }

  return {
    resumo: {
      total: geralN,
      acertos: cor.acertos,
      erros: cor.erros,
      brancos: cor.brancos,
      percentual: cor.percentual,
      pontos: cor.pontos,
      pontosMax: cor.pontosMax,
      penalidade,
      tempoMedioMs: tempos.length ? tempos.reduce((s, x) => s + x, 0) / tempos.length : null,
      chutes: { total: chutes.length, acertos: chutes.filter((i) => i.acertou).length },
    },
    porDisciplina,
    porAssunto,
    focos,
    cadernoDeErros: erros,
    avisos: [...contAvisos.values()],
    insights,
  };
}
