import Link from "next/link";

/** Nome provisório do produto; trocar aqui e no <title>. */
export const NOME_PRODUTO = "concurso/engine";

export function Marca() {
  return (
    <Link href="/" className="marca" aria-label={`${NOME_PRODUTO}, página inicial`}>
      <span className="barra" aria-hidden="true">{"> "}</span>
      {NOME_PRODUTO}
    </Link>
  );
}
