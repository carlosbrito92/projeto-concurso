import type { Correcao, Edital, Letra, Questao, Relatorio, Resposta, Sessao, Simulado } from "@concurso/engine";
import { LIMITE_REPORTES_DIA } from "../tipos.ts";
import type { ConcursoResumo, FiltroQuestoesAdmin, MotivoReporte, QuestaoAdmin, Repositorio, ReporteAdmin, ResolucaoReporte, RespostaEntrada, RespostaSalva, ResultadoGravacao, SimuladoCompleto, SimuladoParaProva, SimuladoResumo, StatusSimulado } from "../tipos.ts";
import { TAMANHO_PAGINA_ADMIN } from "../tipos.ts";
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

interface RegReporte {
  id: number;
  usuarioId: string;
  questaoId: string;
  concursoSlug: string;
  motivo: MotivoReporte;
  texto: string | null;
  criadoEm: string;
  resolvidoEm: string | null;
  resolucao: ResolucaoReporte | null;
  justificativa: string | null;
  resolvidoPor: string | null;
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
  const reportes: RegReporte[] = [];
  let proximoReporte = 1;
  const questaoPorId = (id: string) => {
    for (const c of dados.concursos) {
      const q = c.pool.find((x) => x.id === id);
      if (q) return { q, slug: c.resumo.slug };
    }
    return null;
  };
  const resumoQuestao = (id: string): ReporteAdmin["questao"] => {
    const f = questaoPorId(id);
    if (!f) return null;
    return { concursoSlug: f.slug, numeroNaProva: f.q.origem.questaoNumero ?? null, banca: f.q.concurso?.banca ?? null, ano: f.q.concurso?.ano ?? null, disciplina: f.q.classificacao.disciplina, status: f.q.status, enunciado: f.q.enunciado };
  };

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

    async reportarQuestao(usuarioId, simuladoId, posicao, motivo, texto) {
      const r = dono(usuarioId, simuladoId);
      if (!r) return "inexistente";
      const item = r.simulado.itens[posicao - 1];
      if (!Number.isInteger(posicao) || !item) return "posicao_invalida";
      const desde = agora().getTime() - 24 * 3600 * 1000;
      if (reportes.filter((x) => x.usuarioId === usuarioId && Date.parse(x.criadoEm) >= desde).length >= LIMITE_REPORTES_DIA) return "limite";
      if (reportes.some((x) => x.usuarioId === usuarioId && x.questaoId === item.questaoId && x.motivo === motivo && x.resolvidoEm === null)) return "ja_reportado";
      reportes.push({ id: proximoReporte++, usuarioId, questaoId: item.questaoId, concursoSlug: r.concursoSlug, motivo, texto, criadoEm: agora().toISOString(), resolvidoEm: null, resolucao: null, justificativa: null, resolvidoPor: null });
      return "ok";
    },

    async listarReportes(estado) {
      return reportes
        .filter((x) => (estado === "abertos") === (x.resolvidoEm === null))
        .map<ReporteAdmin>((x) => ({ id: x.id, questaoId: x.questaoId, motivo: x.motivo, texto: x.texto, criadoEm: x.criadoEm, resolvidoEm: x.resolvidoEm, resolucao: x.resolucao, justificativa: x.justificativa, resolvidoPor: x.resolvidoPor, questao: resumoQuestao(x.questaoId) }))
        .sort((a, b) => (estado === "abertos" ? (a.criadoEm < b.criadoEm ? -1 : 1) : (a.resolvidoEm ?? "") < (b.resolvidoEm ?? "") ? 1 : -1));
    },

    async contagemReportesAbertos() {
      return reportes.filter((x) => x.resolvidoEm === null).length;
    },

    async listarQuestoesAdmin(f: FiltroQuestoesAdmin) {
      const busca = f.busca?.trim().toLowerCase();
      const todas = dados.concursos
        .filter((c) => !f.concurso || c.resumo.slug === f.concurso)
        .flatMap((c) => c.pool.map((q) => ({ q, slug: c.resumo.slug })))
        .filter(({ q }) => !f.status || q.status === f.status)
        .filter(({ q }) => !busca || q.id.toLowerCase().includes(busca) || q.enunciado.toLowerCase().includes(busca))
        .map<QuestaoAdmin>(({ q, slug }) => ({
          id: q.id, concursoSlug: slug, numeroNaProva: q.origem.questaoNumero ?? null, banca: q.concurso?.banca ?? null, ano: q.concurso?.ano ?? null,
          disciplina: q.classificacao.disciplina, assunto: q.classificacao.assunto ?? null, status: q.status, direitos: q.direitos.status, revisao: q.revisao.status,
          anulada: q.anulada, enunciado: q.enunciado, alternativas: q.alternativas, correta: q.correta === undefined ? null : (("ABCDE"[q.correta] as Letra | undefined) ?? null),
          reportesAbertos: reportes.filter((x) => x.questaoId === q.id && x.resolvidoEm === null).length,
          reportesTotal: reportes.filter((x) => x.questaoId === q.id).length,
        }))
        .filter((x) => !f.soComReporteAberto || x.reportesAbertos > 0)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const de = Math.max(0, f.pagina - 1) * TAMANHO_PAGINA_ADMIN;
      return { itens: todas.slice(de, de + TAMANHO_PAGINA_ADMIN), total: todas.length };
    },

    async resolverReporte(id, adminId, resolucao, justificativa) {
      const alvo = reportes.find((x) => x.id === id && x.resolvidoEm === null);
      if (!alvo) return 0;
      const fechar = resolucao === "questao_retirada" ? reportes.filter((x) => x.questaoId === alvo.questaoId && x.resolvidoEm === null) : [alvo];
      if (resolucao === "questao_retirada") {
        const f = questaoPorId(alvo.questaoId);
        if (f) f.q.status = "inativa";
      }
      for (const x of fechar) Object.assign(x, { resolvidoEm: agora().toISOString(), resolucao, justificativa, resolvidoPor: adminId });
      return fechar.length;
    },
  };
}
