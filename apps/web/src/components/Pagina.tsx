import { Cabecalho } from "./Cabecalho";
import { Rodape } from "./Rodape";

export function Pagina({ children, estreita = false }: { children: React.ReactNode; estreita?: boolean }) {
  return (
    <>
      <Cabecalho />
      <main id="conteudo" className="envoltorio secao">
        <div style={estreita ? { maxWidth: "72ch" } : undefined}>{children}</div>
      </main>
      <Rodape />
    </>
  );
}
