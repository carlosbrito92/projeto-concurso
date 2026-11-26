/** Tipos do motor. Espelham schemas/questao.schema.json (v3) e schemas/edital.schema.json (v1), só o que o motor usa. */

export type Letra = "A" | "B" | "C" | "D" | "E";
export const LETRAS: readonly Letra[] = ["A", "B", "C", "D", "E"];

export type StatusDireitos = "pendente_juridico" | "liberada" | "nao_aplicavel";
export type StatusQuestao = "rascunho" | "ativa" | "inativa" | "em_revisao";
export type StatusRevisao = "automatico" | "revisado" | "rejeitado";

export interface Classificacao {
  disciplina: string;
  disciplinaId?: string;
  disciplinaIds?: string[];
  assunto: string | null;
  editalItem?: string | null;
  editalItemId?: string;
  editalItemTrilha?: string[];
  classificacaoStatus?: "sugerida" | "confirmada" | "indeterminada";
}

export interface Questao {
  id: string;
  tipo: "MultiplaEscolha" | "CertoErrado" | "AfirmacoesCombinadas" | "VerdadeiroFalso";
  enunciado: string;
  textoApoio?: string | null;
  alternativas: string[];
  /** Índice (base 0) da alternativa correta. Ausente quando anulada. */
  correta?: number;
  gabaritoCertoErrado?: boolean;
  anulada: boolean;
  peso?: number;
  grupoEquivalencia?: string;
  classificacao: Classificacao;
  concurso?: { banca?: string; ano?: number; orgao?: string; cargo?: string };
  origem: { tipo: "prova_real" | "autoral_ia"; questaoNumero?: number | null; provaSlug?: string | null };
  direitos: { status: StatusDireitos };
  revisao: { status: StatusRevisao };
  status: StatusQuestao;
  pendencias?: string[];
  gabaritoOficial?: boolean;
  comentario?: string | null;
  fundamentacao?: { fonte: string; vigenteEm?: string | null } | null;
  imagens?: ReadonlyArray<{ pagina: number; bbox: string }>;
}

export interface ItemEdital {
  id: string;
  numero: string;
  texto: string;
  pai: string | null;
}

export interface DisciplinaEdital {
  id: string;
  nome: string;
  questoes: number | null;
  peso: number | null;
  itens: ItemEdital[];
}

export interface Edital {
  concurso: { slug: string; banca: string; ano: number; cargo: string };
  prova: {
    totalQuestoes: number;
    /** Pontos por acerto (padrão 1). */
    pontosPorQuestao?: number;
    /** Pontos por erro: negativo = desconto (ex.: -1 na Quadrix). Ausente = 0 (erro não desconta). */
    pontosPorErro?: number;
    notaMinimaObjetiva?: number | null;
    /** Nota mínima por módulo (basicos, complementares, especificos), quando o edital exige. */
    notaMinimaPorModulo?: Record<string, number>;
  };
  disciplinas: DisciplinaEdital[];
  grupos?: Array<{ nome: string; questoes: number; disciplinas: string[] }>;
}

export interface Aviso {
  codigo: string;
  nivel: "info" | "atencao" | "alerta";
  texto: string;
}
