import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { letraCorreta, paraCliente } from "@concurso/engine";
import type { Edital, ItemCliente, ItemSimulado, Letra, Questao, Relatorio, Resposta, Sessao, Simulado } from "@concurso/engine";
import { exigir } from "../ambiente.ts";
import { LIMITE_REPORTES_DIA, TAMANHO_PAGINA_ADMIN } from "../tipos.ts";
import type { ConcursoResumo, MotivoReporte, RegistroAlteracao, TipoRegistro, QuestaoAdmin, Repositorio, ReporteAdmin, ResolucaoReporte, RespostaEntrada, RespostaSalva, ResultadoGravacao, SimuladoCompleto, SimuladoParaProva, SimuladoResumo, StatusSimulado } from "../tipos.ts";
import type { Database, Json } from "./db-tipos.ts";

type Cliente = SupabaseClient<Database>;
const PAGINA = 1000;

function ok<T>(r: { data: T; error: { message: string } | null }, onde: string): T {
  if (r.error) throw new Error(`Supabase (${onde}): ${r.error.message}`);
  return r.data;
}

/** Busca todas as linhas de uma consulta paginando (o PostgREST limita a 1000 por chamada). */
async function todas<T>(buscar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, onde: string): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const lote = ok(await buscar(de, de + PAGINA - 1), onde) ?? [];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
  }
}

/** Cliente com o token de sessão do Clerk: o RLS do banco enxerga o `sub` do aluno. */
export function clienteDoUsuario(getToken: () => Promise<string | null>): Cliente {
  return createClient<Database>(exigir("NEXT_PUBLIC_SUPABASE_URL"), exigir("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    accessToken: getToken,
  }) as unknown as Cliente;
}

/** Cliente com a chave secreta: SÓ servidor, para o que o aluno nunca deve tocar (gabarito, banco de questões, correção). */
export function clienteAdmin(): Cliente {
  return createClient<Database>(exigir("NEXT_PUBLIC_SUPABASE_URL"), exigir("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function linhaParaQuestao(
  q: Database["public"]["Tables"]["questao"]["Row"],
  g: { correta: number | null; comentario: string | null; fundamentacao: Json | null } | null,
): Questao {
  const ids = q.disciplina_ids;
  return {
    id: q.id,
    tipo: q.tipo as Questao["tipo"],
    enunciado: q.enunciado,
    textoApoio: q.texto_apoio,
    alternativas: q.alternativas as string[],
    ...(g && g.correta !== null ? { correta: g.correta } : {}),
    anulada: q.anulada,
    peso: q.peso,
    ...(q.grupo_equivalencia ? { grupoEquivalencia: q.grupo_equivalencia } : {}),
    classificacao: {
      disciplina: q.disciplina_nome,
      ...(ids.length === 1 ? { disciplinaId: ids[0] as string } : { disciplinaIds: ids }),
      assunto: q.assunto,
      ...(q.edital_item_id ? { editalItemId: q.edital_item_id } : {}),
      editalItemTrilha: q.edital_item_trilha,
      ...(q.classificacao_status ? { classificacaoStatus: q.classificacao_status as "sugerida" | "confirmada" | "indeterminada" } : {}),
    },
    concurso: { ...(q.banca ? { banca: q.banca } : {}), ...(q.ano ? { ano: q.ano } : {}) },
    origem: { tipo: q.origem_tipo as "prova_real" | "autoral_ia", questaoNumero: q.numero_na_prova, provaSlug: q.prova_slug },
    direitos: { status: q.direitos_status as Questao["direitos"]["status"] },
    revisao: { status: q.revisao_status as Questao["revisao"]["status"] },
    status: q.status as Questao["status"],
    pendencias: q.pendencias,
    gabaritoOficial: q.gabarito_oficial,
    comentario: g?.comentario ?? null,
    fundamentacao: (g?.fundamentacao as Questao["fundamentacao"]) ?? null,
    ...(q.imagens ? { imagens: q.imagens as unknown as NonNullable<Questao["imagens"]> } : {}),
  };
}

export function criarRepoSupabase(getToken: () => Promise<string | null>): Repositorio {
  const u = () => clienteDoUsuario(getToken);
  const a = () => clienteAdmin();

  async function simuladoCompleto(usuarioId: string, id: string): Promise<SimuladoCompleto | null> {
    const adm = a();
    const sim = ok(await adm.from("simulado").select("id,seed,criado_em,status,concurso_slug").eq("id", id).eq("usuario_id", usuarioId).maybeSingle(), "simulado");
    if (!sim) return null;
    const itens = ok(await adm.from("simulado_item").select("posicao,questao_id,peso,ordem").eq("simulado_id", id).order("posicao"), "itens") ?? [];
    const gabs = ok(await adm.from("simulado_gabarito").select("posicao,snapshot").eq("simulado_id", id), "snapshots") ?? [];
    const snap = new Map(gabs.map((g) => [g.posicao, g.snapshot as unknown as Questao]));
    const itensSim: ItemSimulado[] = itens.map((i) => ({ questaoId: i.questao_id, peso: Number(i.peso), ordem: i.ordem, snapshot: snap.get(i.posicao) as Questao }));
    if (itensSim.some((i) => !i.snapshot)) throw new Error(`Simulado ${id} com snapshot ausente`);
    const resp = ok(await adm.from("resposta").select("posicao,letra,tempo_ms,chute").eq("simulado_id", id), "respostas") ?? [];
    const respostas: Resposta[] = resp.flatMap((r) => {
      const item = itens[r.posicao - 1];
      return item ? [{ questaoId: item.questao_id, letra: (r.letra as Letra | null) ?? null, ...(r.tempo_ms !== null ? { tempoMs: r.tempo_ms } : {}), chute: r.chute }] : [];
    });
    return { simulado: { id: sim.id, seed: sim.seed, criadoEm: sim.criado_em, itens: itensSim }, concursoSlug: sim.concurso_slug, status: sim.status as StatusSimulado, respostas };
  }

  return {
    async listarConcursos(): Promise<ConcursoResumo[]> {
      const r = ok(await u().from("concurso").select("slug,orgao,uf,area,banca,cargo,ano,edital,total_questoes").order("ano", { ascending: false }), "concursos") ?? [];
      return r.map((c) => ({ slug: c.slug, area: c.area, uf: c.uf, orgao: c.orgao, banca: c.banca, cargo: c.cargo, ano: c.ano, edital: c.edital, totalQuestoes: c.total_questoes }));
    },

    async obterEdital(slug): Promise<Edital | null> {
      const cli = u();
      const c = ok(await cli.from("concurso").select("slug,banca,ano,cargo,total_questoes,pontos_por_questao,pontos_por_erro,nota_minima,nota_minima_por_modulo").eq("slug", slug).maybeSingle(), "concurso");
      if (!c) return null;
      const [disc, grupos, itens] = await Promise.all([
        cli.from("disciplina").select("id,nome,questoes,peso,numero").eq("concurso_slug", slug).order("numero"),
        cli.from("grupo_edital").select("nome,questoes,disciplinas").eq("concurso_slug", slug),
        todas((de, ate) => cli.from("item_edital").select("id,disciplina_id,numero,texto,pai,ordem").eq("concurso_slug", slug).order("ordem").range(de, ate), "itens do edital"),
      ]);
      const ds = ok(disc, "disciplinas") ?? [];
      return {
        concurso: { slug: c.slug, banca: c.banca, ano: c.ano, cargo: c.cargo },
        prova: {
          totalQuestoes: c.total_questoes,
          pontosPorQuestao: Number(c.pontos_por_questao),
          pontosPorErro: Number(c.pontos_por_erro),
          notaMinimaObjetiva: c.nota_minima === null ? null : Number(c.nota_minima),
          ...(c.nota_minima_por_modulo ? { notaMinimaPorModulo: c.nota_minima_por_modulo as Record<string, number> } : {}),
        },
        disciplinas: ds.map((d) => ({
          id: d.id, nome: d.nome, questoes: d.questoes, peso: d.peso,
          itens: itens.filter((i) => i.disciplina_id === d.id).map((i) => ({ id: i.id, numero: i.numero, texto: i.texto, pai: i.pai })),
        })),
        grupos: (ok(grupos, "grupos") ?? []).map((g) => ({ nome: g.nome, questoes: g.questoes, disciplinas: g.disciplinas })),
      };
    },

    async carregarPool(slug): Promise<Questao[]> {
      const adm = a();
      const qs = await todas((de, ate) => adm.from("questao").select("*").eq("concurso_slug", slug).order("id").range(de, ate), "questões");
      const gs = await todas((de, ate) => adm.from("questao_gabarito").select("*").order("questao_id").range(de, ate), "gabaritos");
      const porId = new Map(gs.map((g) => [g.questao_id, g]));
      return qs.map((q) => linhaParaQuestao(q, porId.get(q.id) ?? null));
    },

    async vistasDoUsuario(_usuarioId, slug) {
      const cli = u(); // RLS: só os simulados do próprio aluno
      const sims = ok(await cli.from("simulado").select("id").eq("concurso_slug", slug), "simulados") ?? [];
      const meus = new Set(sims.map((s) => s.id));
      if (meus.size === 0) return {};
      const itens = await todas((de, ate) => cli.from("simulado_item").select("simulado_id,questao_id,posicao").order("simulado_id").order("posicao").range(de, ate), "itens vistos");
      const v: Record<string, number> = {};
      for (const i of itens) if (meus.has(i.simulado_id)) v[i.questao_id] = (v[i.questao_id] ?? 0) + 1;
      return v;
    },

    async criarSimulado(usuarioId, concursoSlug, simulado: Simulado, meta) {
      const adm = a();
      const itensCliente: ItemCliente[] = paraCliente(simulado).itens;
      try {
        ok(await adm.from("simulado").insert({ id: simulado.id, usuario_id: usuarioId, concurso_slug: concursoSlug, seed: simulado.seed, modo: meta.modo, config: meta.config as Json, criado_em: simulado.criadoEm }).select("id").single(), "criar simulado");
        ok(await adm.from("simulado_item").insert(simulado.itens.map((it, i) => ({ simulado_id: simulado.id, posicao: i + 1, questao_id: it.questaoId, peso: it.peso, ordem: it.ordem, payload: itensCliente[i] as unknown as Json }))).select("posicao"), "criar itens");
        ok(await adm.from("simulado_gabarito").insert(simulado.itens.map((it, i) => ({ simulado_id: simulado.id, posicao: i + 1, letra_correta: letraCorreta(it), snapshot: it.snapshot as unknown as Json }))).select("posicao"), "criar gabaritos");
      } catch (e) {
        await adm.from("simulado").delete().eq("id", simulado.id); // cascata limpa itens/gabaritos parciais
        throw e;
      }
    },

    async listarSimulados(_usuarioId, slug): Promise<SimuladoResumo[]> {
      const cli = u();
      let q = cli.from("simulado").select("id,concurso_slug,status,modo,criado_em,finalizado_em").order("criado_em", { ascending: false }).limit(100);
      if (slug) q = q.eq("concurso_slug", slug);
      const sims = ok(await q, "simulados") ?? [];
      if (sims.length === 0) return [];
      const ids = sims.map((s) => s.id);
      const itens = ok(await cli.from("simulado_item").select("simulado_id").in("simulado_id", ids).limit(10000), "contagem") ?? [];
      const total = new Map<string, number>();
      for (const i of itens) total.set(i.simulado_id, (total.get(i.simulado_id) ?? 0) + 1);
      const rels = ok(await cli.from("relatorio_simulado").select("simulado_id,conteudo").in("simulado_id", ids), "relatórios") ?? [];
      const acertos = new Map(rels.map((r) => [r.simulado_id, ((r.conteudo as { resumo?: { acertos?: number } }).resumo?.acertos ?? null) as number | null]));
      return sims.map((s) => ({ id: s.id, concursoSlug: s.concurso_slug, status: s.status as StatusSimulado, modo: s.modo, criadoEm: s.criado_em, finalizadoEm: s.finalizado_em, total: total.get(s.id) ?? 0, acertos: acertos.get(s.id) ?? null }));
    },

    async obterSimuladoParaProva(_usuarioId, id): Promise<SimuladoParaProva | null> {
      const cli = u();
      const sim = ok(await cli.from("simulado").select("id,concurso_slug,status").eq("id", id).maybeSingle(), "simulado");
      if (!sim) return null; // RLS esconde simulado de outro aluno
      const itens = ok(await cli.from("simulado_item").select("posicao,payload").eq("simulado_id", id).order("posicao"), "itens") ?? [];
      const resp = ok(await cli.from("resposta").select("posicao,letra,tempo_ms,chute").eq("simulado_id", id), "respostas") ?? [];
      const respostas: Record<number, RespostaSalva> = {};
      for (const r of resp) respostas[r.posicao] = { letra: (r.letra as Letra | null) ?? null, tempoMs: r.tempo_ms, chute: r.chute };
      return { id: sim.id, concursoSlug: sim.concurso_slug, status: sim.status as StatusSimulado, itens: itens.map((i) => i.payload as unknown as ItemCliente), respostas };
    },

    async gravarResposta(_usuarioId, id, e: RespostaEntrada): Promise<ResultadoGravacao> {
      const cli = u();
      const sim = ok(await cli.from("simulado").select("status").eq("id", id).maybeSingle(), "simulado");
      if (!sim) return "inexistente";
      if (sim.status !== "em_andamento") return "finalizado";
      const item = ok(await cli.from("simulado_item").select("posicao").eq("simulado_id", id).eq("posicao", e.posicao).maybeSingle(), "item");
      if (!item) return "posicao_invalida";
      // Atualiza primeiro; se não havia linha, insere. (upsert incluiria colunas-chave no UPDATE, que o aluno não tem privilégio de alterar.)
      const campos: { letra: string | null; tempo_ms?: number; chute?: boolean } = { letra: e.letra };
      if (e.tempoMs !== undefined) campos.tempo_ms = Math.round(e.tempoMs);
      if (e.chute !== undefined) campos.chute = e.chute;
      const upd = ok(await cli.from("resposta").update(campos).eq("simulado_id", id).eq("posicao", e.posicao).select("posicao"), "atualizar resposta") ?? [];
      if (upd.length === 0) {
        const ins = await cli.from("resposta").insert({ simulado_id: id, posicao: e.posicao, ...campos });
        if (ins.error) {
          // 42501 = RLS recusou (simulado finalizado no meio do caminho)
          if ((ins.error as { code?: string }).code === "42501") return "finalizado";
          throw new Error(`Supabase (inserir resposta): ${ins.error.message}`);
        }
      }
      return "ok";
    },

    carregarSimuladoCompleto: simuladoCompleto,

    async finalizar(usuarioId, id, correcao, relatorio) {
      const adm = a();
      ok(await adm.from("resposta").upsert(correcao.itens.map((c) => ({ simulado_id: id, posicao: c.posicao, letra: c.letraMarcada, tempo_ms: c.tempoMs === null ? null : Math.round(c.tempoMs), chute: c.chute, acertou: c.acertou, pontos: c.pontos })), { onConflict: "simulado_id,posicao" }).select("posicao"), "gravar correção");
      ok(await adm.from("relatorio_simulado").upsert({ simulado_id: id, conteudo: relatorio as unknown as Json }, { onConflict: "simulado_id" }).select("simulado_id"), "gravar relatório");
      ok(await adm.from("simulado").update({ status: "finalizado", finalizado_em: new Date().toISOString() }).eq("id", id).eq("usuario_id", usuarioId).select("id"), "finalizar");
    },

    async obterRelatorio(_usuarioId, id): Promise<Relatorio | null> {
      const r = ok(await u().from("relatorio_simulado").select("conteudo").eq("simulado_id", id).maybeSingle(), "relatório");
      return r ? (r.conteudo as unknown as Relatorio) : null;
    },

    async sessoesFinalizadas(usuarioId, slug): Promise<Sessao[]> {
      const adm = a();
      const sims = ok(await adm.from("simulado").select("id").eq("usuario_id", usuarioId).eq("concurso_slug", slug).eq("status", "finalizado").order("criado_em"), "finalizados") ?? [];
      const out: Sessao[] = [];
      for (const s of sims) {
        const c = await simuladoCompleto(usuarioId, s.id);
        if (c) out.push({ simulado: c.simulado, respostas: c.respostas });
      }
      return out;
    },

    async reportarQuestao(_usuarioId, simuladoId, posicao, motivo, texto) {
      const cli = u(); // RLS: só enxerga o próprio simulado; a questão vem do item dele, nunca do cliente
      const sim = ok(await cli.from("simulado").select("id").eq("id", simuladoId).maybeSingle(), "simulado");
      if (!sim) return "inexistente";
      const item = ok(await cli.from("simulado_item").select("questao_id").eq("simulado_id", simuladoId).eq("posicao", posicao).maybeSingle(), "item");
      if (!item) return "posicao_invalida";
      const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const rec = await cli.from("reporte_questao").select("id", { count: "exact", head: true }).gte("criado_em", desde);
      if (rec.error) throw new Error(`Supabase (limite de reportes): ${rec.error.message}`);
      if ((rec.count ?? 0) >= LIMITE_REPORTES_DIA) return "limite";
      const ins = await cli.from("reporte_questao").insert({ questao_id: item.questao_id, motivo: motivo satisfies MotivoReporte, texto });
      if (ins.error) {
        if ((ins.error as { code?: string }).code === "23505") return "ja_reportado"; // índice único: já há reporte aberto igual
        throw new Error(`Supabase (reportar questão): ${ins.error.message}`);
      }
      return "ok";
    },

    // ---- Administrador (chave secreta; chamar só depois de exigirAdmin) ----
    async listarReportes(estado): Promise<ReporteAdmin[]> {
      const adm = a();
      let q = adm.from("reporte_questao").select("id,questao_id,motivo,texto,criado_em,resolvido_em,resolucao,justificativa,resolvido_por");
      q = estado === "abertos" ? q.is("resolvido_em", null).order("criado_em", { ascending: true }) : q.not("resolvido_em", "is", null).order("resolvido_em", { ascending: false }).limit(200);
      const rs = ok(await q, "reportes") ?? [];
      const ids = [...new Set(rs.map((r) => r.questao_id))];
      const qs = ids.length ? ok(await adm.from("questao").select("id,concurso_slug,numero_na_prova,banca,ano,disciplina_nome,status,enunciado").in("id", ids), "questões dos reportes") ?? [] : [];
      const porId = new Map(qs.map((x) => [x.id, x]));
      return rs.map((r) => {
        const x = porId.get(r.questao_id);
        return {
          id: r.id, questaoId: r.questao_id, motivo: r.motivo as MotivoReporte, texto: r.texto, criadoEm: r.criado_em, resolvidoEm: r.resolvido_em,
          resolucao: r.resolucao as ResolucaoReporte | null, justificativa: r.justificativa, resolvidoPor: r.resolvido_por,
          questao: x ? { concursoSlug: x.concurso_slug, numeroNaProva: x.numero_na_prova, banca: x.banca, ano: x.ano, disciplina: x.disciplina_nome, status: x.status, enunciado: x.enunciado } : null,
        };
      });
    },

    async contagemReportesAbertos() {
      const r = await a().from("reporte_questao").select("id", { count: "exact", head: true }).is("resolvido_em", null);
      if (r.error) throw new Error(`Supabase (contagem de reportes): ${r.error.message}`);
      return r.count ?? 0;
    },

    async listarQuestoesAdmin(f) {
      const adm = a();
      const rep = ok(await adm.from("reporte_questao").select("questao_id,resolvido_em"), "contagem de reportes") ?? [];
      const abertos = new Map<string, number>();
      const totais = new Map<string, number>();
      for (const r of rep) {
        totais.set(r.questao_id, (totais.get(r.questao_id) ?? 0) + 1);
        if (r.resolvido_em === null) abertos.set(r.questao_id, (abertos.get(r.questao_id) ?? 0) + 1);
      }
      let q = adm.from("questao").select("id,concurso_slug,numero_na_prova,banca,ano,disciplina_nome,assunto,status,direitos_status,revisao_status,anulada,enunciado,alternativas", { count: "exact" });
      if (f.concurso) q = q.eq("concurso_slug", f.concurso);
      if (f.status) q = q.eq("status", f.status);
      if (f.soComReporteAberto) {
        if (abertos.size === 0) return { itens: [], total: 0 };
        q = q.in("id", [...abertos.keys()]);
      }
      const busca = (f.busca ?? "").replace(/[^\p{L}\p{N} ._-]/gu, " ").trim().slice(0, 80);
      if (busca) q = q.or(`id.ilike.%${busca}%,enunciado.ilike.%${busca}%`);
      const de = Math.max(0, f.pagina - 1) * TAMANHO_PAGINA_ADMIN;
      const r = await q.order("id").range(de, de + TAMANHO_PAGINA_ADMIN - 1);
      if (r.error) throw new Error(`Supabase (questões do admin): ${r.error.message}`);
      const linhas = r.data ?? [];
      const gs = linhas.length ? ok(await adm.from("questao_gabarito").select("questao_id,correta").in("questao_id", linhas.map((x) => x.id)), "gabaritos") ?? [] : [];
      const gab = new Map(gs.map((g) => [g.questao_id, g.correta]));
      const itens = linhas.map<QuestaoAdmin>((x) => {
        const c = gab.get(x.id);
        return {
          id: x.id, concursoSlug: x.concurso_slug, numeroNaProva: x.numero_na_prova, banca: x.banca, ano: x.ano, disciplina: x.disciplina_nome, assunto: x.assunto,
          status: x.status, direitos: x.direitos_status, revisao: x.revisao_status, anulada: x.anulada, enunciado: x.enunciado, alternativas: x.alternativas as string[],
          correta: c === null || c === undefined ? null : (("ABCDE"[c] as Letra | undefined) ?? null),
          reportesAbertos: abertos.get(x.id) ?? 0, reportesTotal: totais.get(x.id) ?? 0,
        };
      });
      return { itens, total: r.count ?? itens.length };
    },

    async resolverReporte(id, adminId, resolucao, justificativa) {
      const r = await a().rpc("resolver_reporte", { p_id: id, p_resolucao: resolucao, p_justificativa: justificativa, p_admin: adminId });
      if (r.error) throw new Error(`Supabase (resolver reporte): ${r.error.message}`);
      return r.data ?? 0;
    },

    async listarRegistro(limite): Promise<RegistroAlteracao[]> {
      // Cliente do aluno: a política de leitura e as colunas liberadas (sem questao_id/autor) valem também aqui.
      const r = ok(await u().from("registro_alteracao").select("id,criado_em,tipo,titulo,resumo,concurso_slug").order("id", { ascending: false }).limit(Math.max(1, limite)), "registro de alterações") ?? [];
      return r.map((x) => ({ id: x.id, criadoEm: x.criado_em, tipo: x.tipo as TipoRegistro, titulo: x.titulo, resumo: x.resumo, concursoSlug: x.concurso_slug }));
    },

    async publicarRegistro(adminId, tipo, titulo, resumo) {
      ok(await a().from("registro_alteracao").insert({ tipo, titulo, resumo, autor: adminId }).select("id"), "publicar no registro");
    },
  };
}
