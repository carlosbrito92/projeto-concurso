/**
 * Destino pós-login seguro (evita open redirect).
 * Aceita só caminho relativo ("/painel") ou URL absoluta do próprio host; qualquer outra coisa vira o padrão.
 */
export function destinoSeguro(valor: string | string[] | undefined, host: string | null, padrao = "/painel"): string {
  const v = Array.isArray(valor) ? valor[0] : valor;
  if (!v) return padrao;
  try {
    if (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\")) return v;
    const u = new URL(v);
    if ((u.protocol === "https:" || u.protocol === "http:") && host && u.host === host) return `${u.pathname}${u.search}${u.hash}` || padrao;
  } catch {
    /* URL inválida: cai no padrão */
  }
  return padrao;
}
