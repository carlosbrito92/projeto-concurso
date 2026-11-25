import Link from "next/link";
import { Cabecalho } from "@/components/Cabecalho";
import { Rodape } from "@/components/Rodape";

export default function NaoEncontrado() {
  return (
    <>
      <Cabecalho />
      <main id="conteudo" className="envoltorio secao pilha-p">
        <h1>Página não encontrada</h1>
        <p>O endereço não existe ou o simulado não pertence à sua conta.</p>
        <Link className="btn btn-primario" href="/painel">Ir para o painel</Link>
      </main>
      <Rodape />
    </>
  );
}
