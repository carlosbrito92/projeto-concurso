import { Cabecalho } from "@/components/Cabecalho";
import { Rodape } from "@/components/Rodape";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Cabecalho />
      <main id="conteudo" className="envoltorio secao">{children}</main>
      <Rodape />
    </>
  );
}
