"use client";
import { useId, useState, useTransition } from "react";
import { reportarQuestaoAction } from "@/app/(app)/actions";
import { LIMITE_REPORTE_TEXTO, MOTIVOS_REPORTE, ROTULO_MOTIVO } from "@/lib/tipos";
import type { MotivoReporte } from "@/lib/tipos";
import { Spinner } from "./Spinner";

/** Reporte de problema na questão em tela. Aparece para o administrador; o aluno não recebe resposta individual. */
export function ReportarProblema({ simuladoId, posicao }: { simuladoId: string; posicao: number }) {
  const id = useId();
  const [motivo, setMotivo] = useState<MotivoReporte>("gabarito");
  const [texto, setTexto] = useState("");
  const [retorno, setRetorno] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, iniciar] = useTransition();

  const enviar = () =>
    iniciar(async () => {
      const r = await reportarQuestaoAction(simuladoId, posicao, motivo, texto);
      if (r.ok) {
        setRetorno({ ok: true, texto: r.mensagem });
        setTexto("");
      } else {
        setRetorno({ ok: false, texto: r.erro });
      }
    });

  return (
    <details className="reporte">
      <summary>[!] Reportar problema nesta questão</summary>
      <div className="pilha-p" style={{ marginTop: "var(--e3)" }}>
        <p style={{ margin: 0 }}><small>Viu algo errado? Conte aqui. O reporte vai para a revisão e não interrompe seu simulado.</small></p>
        <div className="campo">
          <label htmlFor={`${id}-motivo`}>O que há de errado?</label>
          <select id={`${id}-motivo`} value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoReporte)}>
            {MOTIVOS_REPORTE.map((m) => <option key={m} value={m}>{ROTULO_MOTIVO[m]}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor={`${id}-texto`}>Detalhes {motivo === "outro" ? "" : "(opcional)"}</label>
          <textarea id={`${id}-texto`} value={texto} maxLength={LIMITE_REPORTE_TEXTO} onChange={(e) => setTexto(e.target.value)} aria-describedby={`${id}-ajuda`} />
          <small id={`${id}-ajuda`} className="suave">{texto.length}/{LIMITE_REPORTE_TEXTO}. Se souber, diga qual alternativa ou trecho.</small>
        </div>
        <div className="linha">
          <button type="button" className="btn" onClick={enviar} disabled={enviando} aria-disabled={enviando} data-carregando={enviando}>
            {enviando ? (<><Spinner /> Enviando...</>) : "Enviar reporte"}
          </button>
        </div>
        <div role="status" aria-live="polite">
          {retorno && <div className={retorno.ok ? "aviso aviso-info" : "erro-campo"}>{retorno.texto}</div>}
        </div>
      </div>
    </details>
  );
}
