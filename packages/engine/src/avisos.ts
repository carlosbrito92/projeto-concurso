import type { Aviso, Questao } from "./types.ts";

/**
 * Avisos que o aluno DEVE ver junto da questão (CLAUDE.md: vigência da legislação).
 * Vêm do motor para que nenhuma tela consiga esquecê-los.
 */
export function avisosDaQuestao(q: Questao): Aviso[] {
  const out: Aviso[] = [];
  const pend = q.pendencias ?? [];
  const ano = q.concurso?.ano;
  const banca = q.concurso?.banca;
  const reviu = q.revisao.status === "revisado" && !!q.fundamentacao?.vigenteEm;

  if (pend.includes("verificar_vigencia") && !reviu) {
    out.push({
      codigo: "vigencia",
      nivel: "atencao",
      texto:
        `Esta questão é de uma prova${ano ? ` de ${ano}` : " antiga"}${banca ? ` (${banca})` : ""}. ` +
        "A legislação pode ter mudado desde então: confira o texto vigente antes de tomar a resposta como certa.",
    });
  }
  if (pend.includes("gabarito_preliminar")) {
    out.push({
      codigo: "gabarito_nao_confirmado",
      nivel: "atencao",
      texto: "O gabarito desta questão não foi confirmado como definitivo; a resposta pode ter mudado após os recursos.",
    });
  }
  if (q.origem.tipo === "autoral_ia" && q.revisao.status !== "revisado") {
    out.push({ codigo: "ia_sem_revisao", nivel: "alerta", texto: "Questão gerada por IA ainda sem revisão humana." });
  }
  if (q.classificacao.classificacaoStatus === "sugerida" && pend.includes("confirmar_assunto")) {
    out.push({ codigo: "assunto_sugerido", nivel: "info", texto: "O assunto desta questão é uma sugestão automática, ainda não confirmada." });
  }
  return out;
}
