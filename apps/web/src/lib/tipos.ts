import type { Correcao, Edital, ItemCliente, Letra, Questao, Relatorio, Resposta, Sessao, Simulado } from "@concurso/engine";

export type StatusSimulado = "em_andamento" | "finalizado" | "abandonado";

export interface ConcursoResumo {
  slug: string;
  /** Identificador da área (ver lib/areas.ts). */
  area: string;
  uf: string;
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

export const MOTIVOS_REPORTE = ["gabarito", "enunciado", "assunto", "vigencia", "imagem", "outro"] as const;
export type MotivoReporte = (typeof MOTIVOS_REPORTE)[number];
export const ROTULO_MOTIVO: Record<MotivoReporte, string> = {
  gabarito: "O gabarito parece errado",
  enunciado: "Erro ou ambiguidade no enunciado ou nas alternativas",
  assunto: "O assunto (item do edital) parece errado",
  vigencia: "A lei citada mudou ou não está vigente",
  imagem: "Imagem ou tabela ausente ou ilegível",
  outro: "Outro problema",
};
export const LIMITE_REPORTE_TEXTO = 2000;
/** Máximo de reportes por aluno nas últimas 24 horas (barra abuso sem atrapalhar uso normal). */
export const LIMITE_REPORTES_DIA = 20;

export type ResultadoReporte = "ok" | "ja_reportado" | "limite" | "inexistente" | "posicao_invalida";

export type ResolucaoReporte = "justificado" | "questao_retirada";
export const ROTULO_RESOLUCAO: Record<ResolucaoReporte, string> = { justificado: "justificado (questão mantida)", questao_retirada: "questão retirada" };

/** Visão do administrador. Não inclui quem reportou: o conteúdo do reporte basta para decidir. */
export interface ReporteAdmin {
  id: number;
  questaoId: string;
  motivo: MotivoReporte;
  texto: string | null;
  criadoEm: string;
  resolvidoEm: string | null;
  resolucao: ResolucaoReporte | null;
  justificativa: string | null;
  resolvidoPor: string | null;
  questao: { concursoSlug: string; numeroNaProva: number | null; banca: string | null; ano: number | null; disciplina: string; status: string; enunciado: string } | null;
}

export interface QuestaoAdmin {
  id: string;
  concursoSlug: string;
  numeroNaProva: number | null;
  banca: string | null;
  ano: number | null;
  disciplina: string;
  assunto: string | null;
  status: string;
  direitos: string;
  revisao: string;
  anulada: boolean;
  enunciado: string;
  alternativas: string[];
  /** Letra do gabarito (o administrador vê). */
  correta: Letra | null;
  reportesAbertos: number;
  reportesTotal: number;
}

export interface FiltroQuestoesAdmin {
  concurso?: string;
  status?: string;
  busca?: string;
  soComReporteAberto?: boolean;
  pagina: number;
}
export const TAMANHO_PAGINA_ADMIN = 25;

export const TIPOS_REGISTRO = ["novidade", "conteudo", "correcao", "questao_retirada"] as const;
export type TipoRegistro = (typeof TIPOS_REGISTRO)[number];
export const ROTULO_TIPO_REGISTRO: Record<TipoRegistro, string> = { novidade: "Novidade", conteudo: "Conteúdo", correcao: "Correção", questao_retirada: "Questão retirada" };
/** "questao_retirada" é sempre automático (gerado ao retirar uma questão); o administrador publica os demais. */
export const TIPOS_PUBLICAVEIS = ["novidade", "conteudo", "correcao"] as const;
export const LIMITE_REGISTRO_TITULO = 120;
export const LIMITE_REGISTRO_RESUMO = 1000;

/** Entrada do registro de alterações: texto voltado ao aluno, somente leitura e imutável depois de publicada. */
export interface RegistroAlteracao {
  id: number;
  criadoEm: string;
  tipo: TipoRegistro;
  titulo: string;
  resumo: string | null;
  concursoSlug: string | null;
}

/** Operações do administrador. Só chamar depois de `exigirAdmin()` (ver lib/admin.ts). */
export interface RepositorioAdmin {
  listarReportes(estado: "abertos" | "resolvidos"): Promise<ReporteAdmin[]>;
  listarQuestoesAdmin(f: FiltroQuestoesAdmin): Promise<{ itens: QuestaoAdmin[]; total: number }>;
  /** Devolve quantos reportes foram fechados (0 = já estava resolvido). Retirar a questão fecha todos os reportes abertos dela. */
  resolverReporte(id: number, adminId: string, resolucao: ResolucaoReporte, justificativa: string): Promise<number>;
  contagemReportesAbertos(): Promise<number>;
  /** Registro de alterações (mais recentes primeiro). O aluno lê o mesmo registro, pela política de leitura. */
  listarRegistro(limite: number): Promise<RegistroAlteracao[]>;
  /** Só inclusão: entradas nunca são editadas nem apagadas. */
  publicarRegistro(adminId: string, tipo: TipoRegistro, titulo: string, resumo: string | null): Promise<void>;
}

/**
 * Acesso a dados. Todas as funções rodam NO SERVIDOR e recebem o usuário já autenticado.
 * Implementações: memória (demo/testes) e Supabase (RLS do aluno + chave de servidor para o que é do servidor).
 */
export interface Repositorio extends RepositorioAdmin {
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
  /** O aluno reporta problema numa questão DO PRÓPRIO simulado (a questão é derivada do simulado, nunca informada pelo cliente). */
  reportarQuestao(usuarioId: string, simuladoId: string, posicao: number, motivo: MotivoReporte, texto: string | null): Promise<ResultadoReporte>;
}

/** Erro cuja mensagem pode ser mostrada ao aluno. */
export class ErroDeNegocio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeNegocio";
  }
}
