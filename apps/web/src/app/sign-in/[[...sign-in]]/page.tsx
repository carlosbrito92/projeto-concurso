import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { modoDemo } from "@/lib/ambiente";
import { destinoSeguro } from "@/lib/destino";
import { Cabecalho } from "@/components/Cabecalho";
import { Rodape } from "@/components/Rodape";

export const metadata = { title: "Entrar" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (modoDemo()) redirect("/painel");
  // Já logado (ex.: voltou do login para esta página): segue para o destino original em vez de ficar em branco.
  const { userId } = await auth();
  if (userId) {
    const q = await searchParams;
    redirect(destinoSeguro(q.redirect_url, (await headers()).get("host")));
  }
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
