import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { modoDemo } from "@/lib/ambiente";
import { ehAdminAtual } from "@/lib/admin";
import { Marca } from "./Marca";
import { NavLink } from "./NavLink";

export async function Cabecalho() {
  const demo = modoDemo();
  const admin = await ehAdminAtual();
  return (
    <>
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <header className="topo">
      {demo && (
          <div className="faixa-demo" role="note">
            Modo demonstração: dados em memória e questões fictícias. Nada aqui vem de provas reais.
          </div>
        )}
        <div className="envoltorio">
          <Marca />
          <nav className="nav" aria-label="Principal">
            <NavLink href="/painel">Painel</NavLink>
            {admin && <NavLink href="/admin">Admin</NavLink>}
            {demo ? (
              <small>usuário: demo</small>
            ) : (
              <>
                <Show when="signed-in"><UserButton /></Show>
                <Show when="signed-out"><Link href="/sign-in">Entrar</Link></Show>
              </>
            )}
          </nav>
        </div>
      </header>
    </>
  );
}
