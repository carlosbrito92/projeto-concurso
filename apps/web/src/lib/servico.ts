import { chaveDisciplina, corrigir, gerarRelatorio, gerarRelatorioAcumulado, montarSimulado, pesosDoEdital, selecionar } from "@concurso/engine";
import type { PoliticaElegibilidade, Relatorio } from "@concurso/engine";
import { ErroDeNegocio } from "./tipos.ts";
import type { Repositorio, RespostaEntrada, ResultadoGravacao, SimuladoParaProva } from "./tipos.ts";

export const TAMANHOS_PERMITIDOS = [5, 10, 20, 30, 50] as const;

export interface PedidoSimulado {
  concursoSlug: string;
  n: number;
  /** Chave de disciplina (ex.: "D07+D08"); vazio = todas. */
  disciplina?: string;
  priorizarFracos?: boolean;
}

/** Reforço: o que o aluno já errou vira "fraqueza" por item do edital (0 domina, 1 fraco), via relatório acumulado. */
export function fracosDoRelatorio(r: Relatorio): Record<string, number> {
  const foco: Record<string, number> = {};
  for (const a of r.porAssunto) {
    if (a.nivel === "critico" || a.nivel === "atencao") foco[a.itemId] = Math.round((1 - a.taxaSuavizada) * 1000) / 1000;
  }
  return foco;
}

export async function criarSimulado(
  repo: Repositorio,
  usuarioId: string,
  pedido: PedidoSimulado,
  politica: PoliticaElegibilidade,
  contexto: { agora: () => Date; novoId: () => string; aleatorio: () => string },
): Promise<string> {
  if (!(TAMANHOS_PERMITIDOS as readonly number[]).includes(pedido.n)) throw new ErroDeNegocio("Escolha uma quantidade de questões válida.");
  const edital = await repo.obterEdital(pedido.concursoSlug);
  if (!edital) throw new ErroDeNegocio("Concurso não encontrado.");

  const [pool, vistas, sessoes] = await Promise.all([
    repo.carregarPool(pedido.concursoSlug),
    repo.vistasDoUsuario(usuarioId, pedido.concursoSlug),
    pedido.priorizarFracos ? repo.sessoesFinalizadas(usuarioId, pedido.concursoSlug) : Promise.resolve([]),
  ]);
  const foco = sessoes.length > 0 ? fracosDoRelatorio(gerarRelatorioAcumulado(sessoes, { edital })) : undefined;

  // O aluno escolhe uma disciplina do edital (ex.: D07); a prova pode tê-la agrupada (ex.: "D07+D08"): vale toda chave que a contenha.
  const chaves = pedido.disciplina ? [...new Set(pool.map(chaveDisciplina).filter((k) => k.split("+").includes(pedido.disciplina as string)))] : undefined;

  const seed = `${usuarioId}:${contexto.agora().toISOString()}:${contexto.aleatorio()}`;
  const sel = selecionar(pool, {
    n: pedido.n,
    seed,
    politica,
    pesos: pesosDoEdital(edital),
    vistas,
    ...(foco ? { foco } : {}),
    ...(chaves ? { disciplinas: chaves } : {}),
  });
  if (sel.questoes.length === 0) {
    throw new ErroDeNegocio(
      "Ainda não há questões liberadas para este concurso. Estamos validando o conteúdo; volte em breve.",
    );
  }
  const simulado = montarSimulado(sel.questoes, {
    id: contexto.novoId(),
    seed,
    criadoEm: contexto.agora().toISOString(),
    embaralharAlternativas: true,
    embaralharQuestoes: false,
  });
  await repo.criarSimulado(usuarioId, pedido.concursoSlug, simulado, {
    modo: pedido.disciplina ? "disciplina" : "misto",
    config: { n: pedido.n, disciplina: pedido.disciplina ?? null, priorizarFracos: !!pedido.priorizarFracos, avisos: sel.avisos },
  });
  return simulado.id;
}

export async function simuladoParaProva(repo: Repositorio, usuarioId: string, id: string): Promise<SimuladoParaProva | null> {
  return repo.obterSimuladoParaProva(usuarioId, id);
}

export async function registrarResposta(repo: Repositorio, usuarioId: string, id: string, r: RespostaEntrada): Promise<ResultadoGravacao> {
  if (r.letra !== null && !["A", "B", "C", "D", "E"].includes(r.letra)) return "posicao_invalida";
  if (r.tempoMs !== undefined && (!Number.isFinite(r.tempoMs) || r.tempoMs < 0 || r.tempoMs > 6 * 60 * 60 * 1000)) {
    return repo.gravarResposta(usuarioId, id, { posicao: r.posicao, letra: r.letra, chute: r.chute ?? false });
  }
  return repo.gravarResposta(usuarioId, id, r);
}

/** Corrige no servidor e grava resultado + relatório. Idempotente: finalizar de novo devolve o que já existe. */
export async function finalizarSimulado(repo: Repositorio, usuarioId: string, id: string): Promise<Relatorio> {
  const existente = await repo.obterRelatorio(usuarioId, id);
  if (existente) return existente;
  const completo = await repo.carregarSimuladoCompleto(usuarioId, id);
  if (!completo) throw new ErroDeNegocio("Simulado não encontrado.");
  const edital = await repo.obterEdital(completo.concursoSlug);
  const opc = edital ? { edital } : {};
  const correcao = corrigir(completo.simulado, completo.respostas);
  const relatorio = gerarRelatorio(completo.simulado, completo.respostas, opc);
  await repo.finalizar(usuarioId, id, correcao, relatorio);
  return relatorio;
}

export async function relatorioDoSimulado(repo: Repositorio, usuarioId: string, id: string): Promise<Relatorio | null> {
  return repo.obterRelatorio(usuarioId, id);
}

/** Panorama do aluno em um concurso: relatório acumulado de todos os simulados finalizados (null se não há nenhum). */
export async function panorama(repo: Repositorio, usuarioId: string, slug: string): Promise<Relatorio | null> {
  const sessoes = await repo.sessoesFinalizadas(usuarioId, slug);
  if (sessoes.length === 0) return null;
  const edital = await repo.obterEdital(slug);
  return gerarRelatorioAcumulado(sessoes, edital ? { edital } : {});
}
