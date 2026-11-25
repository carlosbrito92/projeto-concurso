"use client";

/** Erro transitório de ação (ex.: não conseguiu salvar). Não bloqueia; o aluno pode tentar de novo. */
export function Toast({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null;
  return (
    <div className="toast" role="alert">
      {mensagem}
    </div>
  );
}
