import Link from "next/link";

export function Rodape() {
  return (
    <footer className="rodape">
      <div className="envoltorio linha entre">
        <span>As questões de provas antigas podem citar lei que mudou. Confira sempre a fonte vigente.</span>
        <nav className="nav" aria-label="Documentos">
          <Link href="/termos">Termos de uso</Link>
          <Link href="/privacidade">Privacidade</Link>
        </nav>
      </div>
    </footer>
  );
}
