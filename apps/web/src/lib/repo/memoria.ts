import type { Correcao, Edital, Letra, Questao, Relatorio, Resposta, Sessao, Simulado } from "@concurso/engine";
import type { ConcursoResumo, Repositorio, RespostaEntrada, RespostaSalva, ResultadoGravacao, SimuladoCompleto, SimuladoParaProva, SimuladoResumo, StatusSimulado } from "../tipos.ts";
import { paraCliente } from "@concurso/engine";

interface Reg {
  usuarioId: string;
  concursoSlug: string;
  modo: string;
  status: StatusSimulado;
  criadoEm: string;
  finalizadoEm: string | null;
  simulado: Simulado;
  respostas: Map<number, RespostaSalva>;
  relatorio: Relatorio | null;
  correcao: Correcao | null;
}

export interface DadosMemoria {
  concursos: Array<{ resumo: ConcursoResumo; edital: Edital; pool: Questao[] }>;
}

/** Repositório em memória: demonstração local e testes. Mesmo contrato do Supabase, incluindo isolamento por usuário. */
export function criarRepoMemoria(dados: DadosMemoria, agora: () => Date = () => new Date()): Repositorio {
  const simulados = new Map<string, Reg>();
  const dono = (usuarioId: string, id: string): Reg | null => {
    const r = simulados.get(id);
    return r && r.usuarioId === usuarioId ? r : null;
  };
  const achar = (slug: string) => dados.concursos.find((c) => c.resumo.slug === slug);

  return {
    async listarConcursos() {
      return dados.concursos.map((c) => c.resumo);
    },
    async obterEdital(slug) {
      return achar(slug)?.edital ?? null;
    },
    async carregarPool(slug) {
      return structuredClone(achar(slug)?.pool ?? []);
    },
    async vistasDoUsuario(usuarioId, slug) {
      const v: Record<string, number> = {};
      for (const r of simulados.values()) {
        if (r.usuarioId !== usuarioId || r.concursoSlug !== slug) continue;
        for (const it of r.simulado.itens) v[it.questaoId] = (v[it.questaoId] ?? 0) + 1;
      }
      return v;
    },
    async criarSimulado(usuarioId, concursoSlug, simulado, meta) {
      simulados.set(simulado.id, {
        usuarioId, concursoSlug, modo: meta.modo, status: "em_andamento", criadoEm: simulado.criadoEm, finalizadoEm: null,
        simulado: structuredClone(simulado), respostas: new Map(), relatorio: null, correcao: null,
      });
    },
    async listarSimulados(usuarioId, slug) {
      return [...simulados.entries()]
        .filter(([, r]) => r.usuarioId === usuarioId && (!slug || r.concursoSlug === slug))
        .map<SimuladoResumo>(([id, r]) => ({
          id, concursoSlug: r.concursoSlug, status: r.status, modo: r.modo, criadoEm: r.criadoEm, finalizadoEm: r.finalizadoEm,
          total: r.simulado.itens.length, acertos: r.relatorio ? r.relatorio.resumo.acertos : null,
        }))
        .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
    },
    async obterSimuladoParaProva(usuarioId, id): Promise<SimuladoParaProva | null> {
      const r = dono(usuarioId, id);
      if (!r) return null;
      return {
        id, concursoSlug: r.concursoSlug, status: r.status,
        itens: paraCliente(r.simulado).itens,
        respostas: Object.fromEntries(r.respostas),
      };
    },
    async gravarResposta(usuarioId, id, e: RespostaEntrada): Promise<ResultadoGravacao> {
      const r = dono(usuarioId, id);
      if (!r) return "inexistente";
      if (r.status !== "em_andamento") return "finalizado";
      if (!Number.isInteger(e.posicao) || e.posicao < 1 || e.posicao > r.simulado.itens.length) return "posicao_invalida";
      const ant = r.respostas.get(e.posicao);
      r.respostas.set(e.posicao, { letra: e.letra, tempoMs: e.tempoMs ?? ant?.tempoMs ?? null, chute: e.chute ?? ant?.chute ?? false });
      return "ok";
    },
    async carregarSimuladoCompleto(usuarioId, id): Promise<SimuladoCompleto | null> {
      const r = dono(usuarioId, id);
      if (!r) return null;
      const respostas: Resposta[] = [];
      for (const [pos, s] of r.respostas) {
        const item = r.simulado.itens[pos - 1];
        if (item) respostas.push({ questaoId: item.questaoId, letra: s.letra as Letra | null, ...(s.tempoMs !== null ? { tempoMs: s.tempoMs } : {}), chute: s.chute });
      }
      return { simulado: structuredClone(r.simulado), concursoSlug: r.concursoSlug, status: r.status, respostas };
    },
    async finalizar(usuarioId, id, correcao, relatorio) {
      const r = dono(usuarioId, id);
      if (!r) throw new Error("simulado inexistente");
      r.status = "finalizado";
      r.finalizadoEm = agora().toISOString();
      r.correcao = correcao;
      r.relatorio = relatorio;
    },
    async obterRelatorio(usuarioId, id) {
      return dono(usuarioId, id)?.relatorio ?? null;
    },
    async sessoesFinalizadas(usuarioId, slug): Promise<Sessao[]> {
      const out: Sessao[] = [];
      for (const [id, r] of simulados) {
        if (r.usuarioId !== usuarioId || r.concursoSlug !== slug || r.status !== "finalizado") continue;
        const c = await this.carregarSimuladoCompleto(usuarioId, id);
        if (c) out.push({ simulado: c.simulado, respostas: c.respostas });
      }
      return out;
    },
  };
}
