import "server-only";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { modoDemo } from "./ambiente.ts";
import { ehAdminId } from "./admin-regra.ts";
import { USUARIO_DEMO, usuarioAtualId } from "./auth.ts";
import { repoAtual } from "./repo/index.ts";
import type { RepositorioAdmin } from "./tipos.ts";

/** Só para decidir se mostra o link "Admin". Nunca é a proteção: a proteção é `exigirAdmin()` em cada página e ação. */
export async function ehAdminAtual(): Promise<boolean> {
  if (modoDemo()) return true;
  try {
    return ehAdminId((await auth()).userId, process.env.ADMIN_USER_IDS);
  } catch {
    return false;
  }
}

/** Guarda das rotas e ações de administração. Quem não é admin recebe 404 (a área não revela que existe). Devolve o ID do admin. */
export async function exigirAdmin(): Promise<string> {
  const id = await usuarioAtualId(); // sem login: vai para a entrada
  if (modoDemo()) return USUARIO_DEMO;
  if (!ehAdminId(id, process.env.ADMIN_USER_IDS)) notFound();
  return id;
}

/** Único caminho para as operações de administrador: só existe depois de `exigirAdmin()`. */
export async function repoAdmin(): Promise<{ repo: RepositorioAdmin; adminId: string }> {
  const adminId = await exigirAdmin();
  return { repo: repoAtual(), adminId };
}
