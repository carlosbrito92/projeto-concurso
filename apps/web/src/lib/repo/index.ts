import "server-only";
import { auth } from "@clerk/nextjs/server";
import { modoDemo } from "../ambiente.ts";
import type { Repositorio } from "../tipos.ts";
import { criarRepoDemo } from "./demo.ts";
import { criarRepoSupabase } from "./supabase.ts";

const g = globalThis as unknown as { __repoDemo?: Repositorio };

/** Demonstração: memória (sobrevive ao hot reload). Caso contrário: Supabase com o token do Clerk do aluno atual. */
export function repoAtual(): Repositorio {
  if (modoDemo()) return (g.__repoDemo ??= criarRepoDemo());
  return criarRepoSupabase(async () => (await auth()).getToken());
}
