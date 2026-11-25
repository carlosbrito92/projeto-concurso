import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { modoDemo } from "./ambiente.ts";

export const USUARIO_DEMO = "demo-user";

/** Id do aluno logado (sub do Clerk). Sem login, manda para a tela de entrada. */
export async function usuarioAtualId(): Promise<string> {
  if (modoDemo()) return USUARIO_DEMO;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
}

export async function usuarioLogado(): Promise<boolean> {
  if (modoDemo()) return true;
  return !!(await auth()).userId;
}
