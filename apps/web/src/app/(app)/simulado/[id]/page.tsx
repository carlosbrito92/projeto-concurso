import { notFound, redirect } from "next/navigation";
import { Prova } from "@/components/Prova";
import { usuarioAtualId } from "@/lib/auth";
import { repoAtual } from "@/lib/repo/index";
import { simuladoParaProva } from "@/lib/servico";

export const metadata = { title: "Simulado" };
export const dynamic = "force-dynamic";

export default async function PaginaSimulado({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string }> }) {
  const [{ id }, { erro }] = await Promise.all([params, searchParams]);
  const usuario = await usuarioAtualId();
  const s = await simuladoParaProva(repoAtual(), usuario, id);
  if (!s) notFound();
  if (s.status === "finalizado") redirect(`/simulado/${id}/resultado`);
  return <Prova simulado={s} erroAoFinalizar={erro === "finalizar"} />;
}
