import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { letraCorreta, paraCliente } from "@concurso/engine";
import type { Edital, ItemCliente, ItemSimulado, Letra, Questao, Relatorio, Resposta, Sessao, Simulado } from "@concurso/engine";
import { exigir } from "../ambiente.ts";
import type { ConcursoResumo, Repositorio, RespostaEntrada, RespostaSalva, ResultadoGravacao, SimuladoCompleto, SimuladoParaProva, SimuladoResumo, StatusSimulado } from "../tipos.ts";
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
      const r = ok(await u().from("concurso").select("slug,orgao,banca,cargo,ano,edital,total_questoes").order("ano", { ascending: false }), "concursos") ?? [];
      return r.map((c) => ({ slug: c.slug, orgao: c.orgao, banca: c.banca, cargo: c.cargo, ano: c.ano, edital: c.edital, totalQuestoes: c.total_questoes }));
    },

    async obterEdital(slug): Promise<Edital | null> {
      const cli = u();
      const c = ok(await cli.from("concurso").select("slug,banca,ano,cargo,total_questoes").eq("slug", slug).maybeSingle(), "concurso");
      if (!c) return null;
      const [disc, grupos, itens] = await Promise.all([
        cli.from("disciplina").select("id,nome,questoes,peso,numero").eq("concurso_slug", slug).order("numero"),
        cli.from("grupo_edital").select("nome,questoes,disciplinas").eq("concurso_slug", slug),
        todas((de, ate) => cli.from("item_edital").select("id,disciplina_id,numero,texto,pai,ordem").eq("concurso_slug", slug).order("ordem").range(de, ate), "itens do edital"),
      ]);
      const ds = ok(disc, "disciplinas") ?? [];
      return {
        concurso: { slug: c.slug, banca: c.banca, ano: c.ano, cargo: c.cargo },
        prova: { totalQuestoes: c.total_questoes },
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
  };
}
