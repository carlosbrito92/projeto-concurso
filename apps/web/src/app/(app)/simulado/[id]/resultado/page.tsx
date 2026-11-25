import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RelatorioView } from "@/components/RelatorioView";
import { usuarioAtualId } from "@/lib/auth";
import { repoAtual } from "@/lib/repo/index";
import { relatorioDoSimulado, simuladoParaProva } from "@/lib/servico";

export const metadata = { title: "Resultado do simulado" };
export const dynamic = "force-dynamic";

export default async function Resultado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usuario = await usuarioAtualId();
  const repo = repoAtual();
  const rel = await relatorioDoSimulado(repo, usuario, id);
  if (!rel) {
    const s = await simuladoParaProva(repo, usuario, id);
    if (!s) notFound();
    redirect(`/simulado/${id}`);
  }
  return (
    <div className="pilha">
      <div className="linha entre">
        <h1>Resultado do simulado</h1>
        <div className="linha">
          <Link className="btn btn-primario" href="/painel">Fazer outro simulado</Link>
        </div>
      </div>
      <RelatorioView r={rel} titulo="Resumo" />
    </div>
  );
}
