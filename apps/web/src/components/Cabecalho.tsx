import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { modoDemo } from "@/lib/ambiente";
import { Marca } from "./Marca";
import { NavLink } from "./NavLink";

export function Cabecalho() {
  const demo = modoDemo();
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
            {demo ? (
              <small>usuário: demo</small>
            ) : (
              <>
                <SignedIn><UserButton /></SignedIn>
                <SignedOut><Link href="/sign-in">Entrar</Link></SignedOut>
              </>
            )}
          </nav>
        </div>
      </header>
    </>
  );
}
