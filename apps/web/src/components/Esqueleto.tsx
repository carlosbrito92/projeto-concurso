/** Esqueleto ASCII para páginas (skeleton > spinner em página inteira). */
export function Esqueleto({ linhas = 4, titulo = true }: { linhas?: number; titulo?: boolean }) {
  const bloco = (n: number) => "░".repeat(n);
  return (
    <div role="status" aria-live="polite" className="pilha-p">
      <span className="so-leitor">Carregando...</span>
      {titulo && <div className="esqueleto" aria-hidden="true">{bloco(28)}</div>}
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="esqueleto" aria-hidden="true">{bloco(60 - ((i * 13) % 25))}</div>
      ))}
    </div>
  );
}
