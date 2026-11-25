"use server";
import { randomUUID, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { politicaQuestoes } from "@/lib/ambiente";
import { usuarioAtualId } from "@/lib/auth";
import { repoAtual } from "@/lib/repo/index";
import { criarSimulado, finalizarSimulado, registrarResposta } from "@/lib/servico";
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
