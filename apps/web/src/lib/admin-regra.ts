/** Quem é administrador: lista de IDs do Clerk (`user_...`) em ADMIN_USER_IDS, separados por vírgula. Sem lista = ninguém (falha fechada). */
export function idsAdmin(valor: string | undefined | null): Set<string> {
  return new Set((valor ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{3,100}$/.test(s)));
}

export function ehAdminId(userId: string | null | undefined, valor: string | undefined | null): boolean {
  return !!userId && idsAdmin(valor).has(userId);
}
