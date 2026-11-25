"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { criarSimuladoAction } from "@/app/(app)/actions";
import type { EstadoForm } from "@/app/(app)/actions";
import { Spinner } from "./Spinner";

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primario" disabled={pending} aria-disabled={pending} data-carregando={pending}>
      {pending ? (<><Spinner /> Montando o simulado...</>) : "Começar simulado"}
    </button>
  );
}

export function FormNovoSimulado({ concursoSlug, disciplinas, temHistorico }: { concursoSlug: string; disciplinas: Array<{ id: string; nome: string }>; temHistorico: boolean }) {
  const [estado, acao] = useActionState<EstadoForm, FormData>(criarSimuladoAction, { erro: null });
  return (
    <form action={acao} className="pilha" aria-describedby={estado.erro ? "erro-form" : undefined}>
      <input type="hidden" name="concurso" value={concursoSlug} />
      <div className="grade">
        <div className="campo col-6">
          <label htmlFor="n">Quantas questões</label>
          <select id="n" name="n" defaultValue="10">
            {[5, 10, 20, 30, 50].map((n) => <option key={n} value={n}>{n} questões</option>)}
          </select>
        </div>
        <div className="campo col-6">
          <label htmlFor="disciplina">Disciplina</label>
          <select id="disciplina" name="disciplina" defaultValue="">
            <option value="">Todas, na proporção da prova</option>
            {disciplinas.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        </div>
      </div>
      <div className="marcador">
        <input type="checkbox" id="fracos" name="fracos" disabled={!temHistorico} aria-describedby="fracos-ajuda" />
        <div>
          <label htmlFor="fracos"><strong>Priorizar meus pontos fracos</strong></label>
          <div id="fracos-ajuda"><small>{temHistorico ? "Dá mais peso aos assuntos em que você mais errou nos simulados anteriores." : "Disponível depois do seu primeiro simulado finalizado."}</small></div>
        </div>
      </div>
      {estado.erro && <div id="erro-form" className="erro-campo" role="alert">{estado.erro}</div>}
      <div><Enviar /></div>
    </form>
  );
}
