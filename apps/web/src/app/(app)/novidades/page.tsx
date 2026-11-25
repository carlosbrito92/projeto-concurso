import Link from "next/link";
import { usuarioAtualId } from "@/lib/auth";
import { repoAtual } from "@/lib/repo/index";
import { ListaRegistro } from "@/components/ListaRegistro";

export const metadata = { title: "Novidades" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await usuarioAtualId(); // sem login: vai para a entrada
  const itens = await repoAtual().listarRegistro(100);
  return (
    <div className="pilha">
      <div>
        <h1>Registro de alterações</h1>
        <p className="suave" style={{ marginBottom: 0 }}>O que muda no produto e no conteúdo. Somente leitura: uma entrada publicada não é editada nem apagada.</p>
      </div>
      {itens.length === 0 ? (
        <section className="painel pilha-p">
          <h2 className="titulo-sec">Nada registrado ainda</h2>
          <p>Quando houver novidades, correções ou questões retiradas, elas aparecem aqui.</p>
          <div><Link className="btn" href="/painel">Voltar ao painel</Link></div>
        </section>
      ) : (
        <ListaRegistro itens={itens} />
      )}
    </div>
  );
}
