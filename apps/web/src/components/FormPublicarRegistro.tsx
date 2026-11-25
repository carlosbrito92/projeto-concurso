"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { publicarRegistroAction } from "@/app/(app)/admin/actions";
import type { EstadoPublicacao } from "@/app/(app)/admin/actions";
import { LIMITE_REGISTRO_RESUMO, LIMITE_REGISTRO_TITULO, ROTULO_TIPO_REGISTRO, TIPOS_PUBLICAVEIS } from "@/lib/tipos";
import { Spinner } from "./Spinner";

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primario" disabled={pending} aria-disabled={pending} data-carregando={pending}>
      {pending ? (<><Spinner /> Publicando...</>) : "Publicar entrada"}
    </button>
  );
}

export function FormPublicarRegistro() {
  const [estado, acao] = useActionState<EstadoPublicacao, FormData>(publicarRegistroAction, { erro: null, publicado: 0 });
  return (
    <form action={acao} className="painel pilha-p" key={estado.publicado} aria-label="Nova entrada">
      <p style={{ margin: 0 }}><small className="suave">Texto para o aluno. Não cole enunciado, gabarito nem justificativas internas. Depois de publicada, a entrada não pode ser editada nem apagada.</small></p>
      <div className="campo">
        <label htmlFor="tipo">Tipo</label>
        <select id="tipo" name="tipo" defaultValue="novidade">
          {TIPOS_PUBLICAVEIS.map((t) => <option key={t} value={t}>{ROTULO_TIPO_REGISTRO[t]}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="titulo">Título</label>
        <input type="text" id="titulo" name="titulo" required minLength={3} maxLength={LIMITE_REGISTRO_TITULO} />
      </div>
      <div className="campo">
        <label htmlFor="resumo">Resumo (opcional)</label>
        <textarea id="resumo" name="resumo" maxLength={LIMITE_REGISTRO_RESUMO} />
      </div>
      {estado.erro && <div className="erro-campo" role="alert">{estado.erro}</div>}
      {estado.publicado > 0 && !estado.erro && <div className="aviso aviso-info" role="status">Entrada publicada. Os alunos já a veem em Novidades.</div>}
      <div><Enviar /></div>
    </form>
  );
}
