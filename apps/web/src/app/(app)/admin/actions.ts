"use server";
import { revalidatePath } from "next/cache";
import { repoAdmin } from "@/lib/admin";
import { publicarRegistro, resolverReporte } from "@/lib/servico";
import { ErroDeNegocio } from "@/lib/tipos";

export type EstadoResolucao = { erro: string | null; feito: boolean };

export async function resolverReporteAction(_anterior: EstadoResolucao, dados: FormData): Promise<EstadoResolucao> {
  const { repo, adminId } = await repoAdmin(); // 404 para quem não é admin
  try {
    const n = await resolverReporte(repo, adminId, Number(dados.get("id")), String(dados.get("resolucao") ?? ""), String(dados.get("justificativa") ?? ""));
    revalidatePath("/admin", "layout");
    return n === 0 ? { erro: "Esse reporte já tinha sido resolvido. A lista foi atualizada.", feito: true } : { erro: null, feito: true };
  } catch (e) {
    if (e instanceof ErroDeNegocio) return { erro: e.message, feito: false };
    console.error("resolverReporteAction", e);
    return { erro: "Não consegui salvar a resolução. Nada foi alterado: tente de novo.", feito: false };
  }
}

export type EstadoPublicacao = { erro: string | null; publicado: number };

export async function publicarRegistroAction(anterior: EstadoPublicacao, dados: FormData): Promise<EstadoPublicacao> {
  const { repo, adminId } = await repoAdmin(); // 404 para quem não é admin
  try {
    await publicarRegistro(repo, adminId, String(dados.get("tipo") ?? ""), String(dados.get("titulo") ?? ""), String(dados.get("resumo") ?? ""));
    revalidatePath("/novidades");
    revalidatePath("/admin/registro");
    return { erro: null, publicado: anterior.publicado + 1 };
  } catch (e) {
    if (e instanceof ErroDeNegocio) return { erro: e.message, publicado: anterior.publicado };
    console.error("publicarRegistroAction", e);
    return { erro: "Não consegui publicar agora. Nada foi registrado: tente de novo.", publicado: anterior.publicado };
  }
}
