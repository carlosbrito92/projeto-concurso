import { POLITICA_DESENVOLVIMENTO, POLITICA_PADRAO } from "@concurso/engine";
import type { PoliticaElegibilidade } from "@concurso/engine";

/** dev = máquina do desenvolvedor; teste = deploy privado para testers; producao = aluno pagante. */
export type AppEnv = "dev" | "teste" | "producao";

export function appEnv(): AppEnv {
  const v = process.env.APP_ENV;
  if (v === "dev" || v === "teste" || v === "producao") return v;
  return process.env.NODE_ENV === "production" ? "producao" : "dev";
}

/**
 * Modo demonstração: dados em memória, questões fictícias, sem login. Só existe em desenvolvimento.
 * Se alguém ligar DEMO em produção/teste, o app se recusa a funcionar (falha ruidosa, nunca silenciosa).
 */
export function modoDemo(): boolean {
  if (process.env.DEMO !== "1") return false;
  if (appEnv() !== "dev" || process.env.NODE_ENV === "production") {
    throw new Error("DEMO=1 é proibido fora de desenvolvimento (APP_ENV deve ser 'dev' e NODE_ENV não pode ser 'production').");
  }
  return true;
}

/**
 * Política de elegibilidade das questões servidas ao aluno.
 * Produção: SEMPRE a padrão (liberada juridicamente + ativa + revisada).
 * Teste: pode usar a de desenvolvimento, mas só por escolha explícita (POLITICA_QUESTOES=desenvolvimento) num ambiente privado.
 */
export function politicaQuestoes(): PoliticaElegibilidade {
  const pedida = process.env.POLITICA_QUESTOES;
  if (pedida === "desenvolvimento") {
    if (appEnv() === "producao") {
      throw new Error("POLITICA_QUESTOES=desenvolvimento é proibida em produção: questões pendentes de direitos não podem ir ao aluno.");
    }
    return POLITICA_DESENVOLVIMENTO;
  }
  return POLITICA_PADRAO;
}

export function usandoPoliticaDeTeste(): boolean {
  return politicaQuestoes() === POLITICA_DESENVOLVIMENTO;
}

/** Variável obrigatória: falha com mensagem clara em vez de `undefined` silencioso. */
export function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome} (veja apps/web/.env.example).`);
  return v;
}
