import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { modoDemo } from "@/lib/ambiente";
import { Cabecalho } from "@/components/Cabecalho";
import { Rodape } from "@/components/Rodape";

export const metadata = { title: "Entrar" };

export default function Page() {
  if (modoDemo()) redirect("/painel");
  return (
    <>
      <Cabecalho />
      <main id="conteudo" className="envoltorio secao" style={{ display: "flex", justifyContent: "center" }}>
        <SignIn />
      </main>
      <Rodape />
    </>
  );
}
