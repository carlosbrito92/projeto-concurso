"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { resolverReporteAction } from "@/app/(app)/admin/actions";
import type { EstadoResolucao } from "@/app/(app)/admin/actions";
import { LIMITE_REPORTE_TEXTO } from "@/lib/tipos";
import { Spinner } from "./Spinner";

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={pending} aria-disabled={pending} data-carregando={pending}>
      {pending ? (<><Spinner /> Salvando...</>) : "Registrar resolução"}
    </button>
  );
}

/** Justificar (mantém a questão) ou retirar (inativa a questão e fecha os reportes abertos dela). A justificativa é obrigatória. */
export function FormResolverReporte({ id }: { id: number }) {
  const [estado, acao] = useActionState<EstadoResolucao, FormData>(resolverReporteAction, { erro: null, feito: false });
  return (
    <form action={acao} className="pilha-p">
      <input type="hidden" name="id" value={id} />
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="rotulo">Decisão</legend>
        <div className="marcador"><input type="radio" id={`r${id}-j`} name="resolucao" value="justificado" defaultChecked /><label htmlFor={`r${id}-j`}>Manter a questão (justificar)</label></div>
        <div className="marcador"><input type="radio" id={`r${id}-r`} name="resolucao" value="questao_retirada" /><label htmlFor={`r${id}-r`}>Retirar a questão (sai dos novos simulados; fecha os outros reportes dela)</label></div>
      </fieldset>
      <div className="campo">
        <label htmlFor={`j${id}`}>Justificativa (obrigatória)</label>
        <textarea id={`j${id}`} name="justificativa" required minLength={3} maxLength={LIMITE_REPORTE_TEXTO} />
      </div>
      {estado.erro && <div className="erro-campo" role="alert">{estado.erro}</div>}
      <div><Enviar /></div>
    </form>
  );
}
