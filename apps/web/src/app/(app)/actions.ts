"use server";
import { randomUUID, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { politicaQuestoes } from "@/lib/ambiente";
import { usuarioAtualId } from "@/lib/auth";
import { repoAtual } from "@/lib/repo/index";
import { criarSimulado, finalizarSimulado, registrarResposta, reportarQuestao } from "@/lib/servico";
import { ErroDeNegocio } from "@/lib/tipos";
import type { RespostaEntrada, ResultadoGravacao } from "@/lib/tipos";

export interface EstadoForm {
  erro: string | null;
}

const ID_VALIDO = /^[A-Za-z0-9-]{1,64}$/;

export async function criarSimuladoAction(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const usuario = await usuarioAtualId();
  const slug = String(dados.get("concurso") ?? "");
  const n = Number(dados.get("n"));
  const disciplina = String(dados.get("disciplina") ?? "");
  const fracos = dados.get("fracos") === "on";
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !Number.isInteger(n)) return { erro: "Não entendi o pedido. Recarregue a página e tente de novo." };
  if (disciplina && !/^D[0-9]{2}$/.test(disciplina)) return { erro: "Disciplina inválida." };

  let id: string;
  try {
    id = await criarSimulado(repoAtual(), usuario, { concursoSlug: slug, n, ...(disciplina ? { disciplina } : {}), priorizarFracos: fracos }, politicaQuestoes(), {
      agora: () => new Date(),
      novoId: () => randomUUID(),
      aleatorio: () => randomBytes(6).toString("hex"),
    });
  } catch (e) {
    if (e instanceof ErroDeNegocio) return { erro: e.message };
    console.error("criarSimuladoAction", e);
    return { erro: "Não foi possível montar o simulado agora. Isso costuma ser instabilidade passageira: tente de novo em instantes." };
  }
  redirect(`/simulado/${id}`);
}

export async function registrarRespostaAction(id: string, r: RespostaEntrada): Promise<ResultadoGravacao> {
  if (!ID_VALIDO.test(id)) return "inexistente";
  const usuario = await usuarioAtualId();
  return registrarResposta(repoAtual(), usuario, id, r);
}

export async function finalizarAction(id: string): Promise<void> {
  if (!ID_VALIDO.test(id)) redirect("/painel");
  const usuario = await usuarioAtualId();
  try {
    await finalizarSimulado(repoAtual(), usuario, id);
  } catch (e) {
    console.error("finalizarAction", e);
    redirect(`/simulado/${id}?erro=finalizar`);
  }
  redirect(`/simulado/${id}/resultado`);
}

export type EstadoReporte = { ok: true; mensagem: string } | { ok: false; erro: string };

const MENSAGEM_REPORTE: Record<string, string> = {
  ok: "Reporte enviado. Obrigado: a questão entra na fila de revisão.",
  ja_reportado: "Você já reportou esse problema nesta questão. Ele continua na fila de revisão.",
};

export async function reportarQuestaoAction(simuladoId: string, posicao: number, motivo: string, texto: string): Promise<EstadoReporte> {
  if (!ID_VALIDO.test(simuladoId)) return { ok: false, erro: "Não encontrei esse simulado. Recarregue a página." };
  const usuario = await usuarioAtualId();
  try {
    const r = await reportarQuestao(repoAtual(), usuario, simuladoId, posicao, motivo, texto);
    const msg = MENSAGEM_REPORTE[r];
    if (msg) return { ok: true, mensagem: msg };
    if (r === "limite") return { ok: false, erro: "Você já enviou muitos reportes hoje. Tente de novo amanhã; os que já enviou serão revisados." };
    return { ok: false, erro: "Não encontrei essa questão no seu simulado. Recarregue a página e tente de novo." };
  } catch (e) {
    if (e instanceof ErroDeNegocio) return { ok: false, erro: e.message };
    console.error("reportarQuestaoAction", e);
    return { ok: false, erro: "Não consegui enviar o reporte agora. Seu simulado não foi afetado: tente de novo em instantes." };
  }
}
