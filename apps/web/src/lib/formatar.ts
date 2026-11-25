export const pct = (x: number): string => `${Math.round(x * 100)}%`;

export function duracao(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "sem dados";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}min ${String(s % 60).padStart(2, "0")}s`;
}

export function dataCurta(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(d);
}

/** Barra ASCII: [#####-----] (texto puro, mesmo em terminal). `largura` em caracteres. */
export function barraTexto(fracao: number, largura = 20): { cheio: string; vazio: string } {
  const f = Math.max(0, Math.min(1, Number.isFinite(fracao) ? fracao : 0));
  const n = Math.round(f * largura);
  return { cheio: "#".repeat(n), vazio: "-".repeat(largura - n) };
}

export const rotuloNivel: Record<string, string> = { forte: "forte", atencao: "atenção", critico: "crítico", indefinido: "poucos dados" };
