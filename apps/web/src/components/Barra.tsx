import { barraTexto, pct } from "@/lib/formatar";

/** Barra [#####-----]. O texto ASCII é decorativo (aria-hidden); o significado vai no aria-label. */
export function Barra({ fracao, rotulo, largura = 20 }: { fracao: number; rotulo: string; largura?: number }) {
  const { cheio, vazio } = barraTexto(fracao, largura);
  return (
    <span role="img" aria-label={`${rotulo}: ${pct(fracao)}`} className="barra-ascii">
      <span aria-hidden="true">
        [<span className="cheio">{cheio}</span>
        <span className="vazio">{vazio}</span>]
      </span>
    </span>
  );
}
