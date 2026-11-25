import type { Correcao, Edital, ItemCliente, Letra, Questao, Relatorio, Resposta, Sessao, Simulado } from "@concurso/engine";

export type StatusSimulado = "em_andamento" | "finalizado" | "abandonado";

export interface ConcursoResumo {
  slug: string;
  orgao: string;
  banca: string;
  cargo: string;
  ano: number;
  edital: string;
  totalQuestoes: number;
}

export interface SimuladoResumo {
  id: string;
  concursoSlug: string;
  status: StatusSimulado;
  modo: string;
  criadoEm: string;
  finalizadoEm: string | null;
  total: number;
  acertos: number | null;
}

export interface RespostaSalva {
  letra: Letra | null;
  tempoMs: number | null;
  chute: boolean;
}

/** O que a tela da prova recebe: itens SEM gabarito + respostas já salvas. */
export interface SimuladoParaProva {
  id: string;
  concursoSlug: string;
  status: StatusSimulado;
  itens: ItemCliente[];
  respostas: Record<number, RespostaSalva>;
}

export interface RespostaEntrada {
  posicao: number;
  letra: Letra | null;
  tempoMs?: number;
  chute?: boolean;
}

export interface SimuladoCompleto {
  simulado: Simulado;
  concursoSlug: string;
  status: StatusSimulado;
  respostas: Resposta[];
}

export type ResultadoGravacao = "ok" | "finalizado" | "inexistente" | "posicao_invalida";

/**
 * Acesso a dados. Todas as funções rodam NO SERVIDOR e recebem o usuário já autenticado.
 * Implementações: memória (demo/testes) e Supabase (RLS do aluno + chave de servidor para o que é do servidor).
 */
export interface Repositorio {
  listarConcursos(): Promise<ConcursoResumo[]>;
  obterEdital(slug: string): Promise<Edital | null>;
  /** Servidor: banco de questões COM gabarito. Nunca devolver ao navegador. */
  carregarPool(slug: string): Promise<Questao[]>;
  vistasDoUsuario(usuarioId: string, slug: string): Promise<Record<string, number>>;
  criarSimulado(usuarioId: string, concursoSlug: string, simulado: Simulado, meta: { modo: string; config: Record<string, unknown> }): Promise<void>;
  listarSimulados(usuarioId: string, slug?: string): Promise<SimuladoResumo[]>;
  obterSimuladoParaProva(usuarioId: string, id: string): Promise<SimuladoParaProva | null>;
  gravarResposta(usuarioId: string, id: string, r: RespostaEntrada): Promise<ResultadoGravacao>;
  /** Servidor: simulado com snapshots (gabarito) para corrigir. */
  carregarSimuladoCompleto(usuarioId: string, id: string): Promise<SimuladoCompleto | null>;
  finalizar(usuarioId: string, id: string, correcao: Correcao, relatorio: Relatorio): Promise<void>;
  obterRelatorio(usuarioId: string, id: string): Promise<Relatorio | null>;
  sessoesFinalizadas(usuarioId: string, slug: string): Promise<Sessao[]>;
}

/** Erro cuja mensagem pode ser mostrada ao aluno. */
export class ErroDeNegocio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeNegocio";
  }
}
