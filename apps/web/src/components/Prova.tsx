"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Letra } from "@concurso/engine";
import { finalizarAction, registrarRespostaAction } from "@/app/(app)/actions";
import type { SimuladoParaProva } from "@/lib/tipos";
import { Aviso } from "./Aviso";
import { Barra } from "./Barra";
import { ReportarProblema } from "./ReportarProblema";
import { Spinner } from "./Spinner";
import { Toast } from "./Toast";

interface Estado {
  letra: Letra | null;
  chute: boolean;
}

export function Prova({ simulado, erroAoFinalizar }: { simulado: SimuladoParaProva; erroAoFinalizar: boolean }) {
  const router = useRouter();
  const total = simulado.itens.length;
  const [idx, setIdx] = useState(0);
  const [respostas, setRespostas] = useState<Record<number, Estado>>(() =>
    Object.fromEntries(Object.entries(simulado.respostas).map(([p, r]) => [Number(p), { letra: r.letra, chute: r.chute }])),
  );
  const [aviso, setAviso] = useState<string | null>(erroAoFinalizar ? "Não foi possível finalizar agora. Suas respostas estão salvas: tente finalizar de novo." : null);
  const [confirmando, setConfirmando] = useState(false);
  const [finalizando, iniciarFinalizar] = useTransition();

  // tempo por questão (ms), acumulado enquanto a questão está aberta
  const acumulado = useRef<Record<number, number>>(Object.fromEntries(Object.entries(simulado.respostas).map(([p, r]) => [Number(p), r.tempoMs ?? 0])));
  const inicio = useRef<number>(typeof performance !== "undefined" ? performance.now() : 0);
  const naoSalvas = useRef<Set<number>>(new Set());
  const estadoRef = useRef(respostas);
  estadoRef.current = respostas;

  const posicao = idx + 1;
  const item = simulado.itens[idx];

  const tempoDe = useCallback((pos: number, corrente: boolean) => {
    const base = acumulado.current[pos] ?? 0;
    return Math.round(base + (corrente ? performance.now() - inicio.current : 0));
  }, []);

  const salvar = useCallback(
    async (pos: number, e: Estado, tempoMs: number) => {
      try {
        const r = await registrarRespostaAction(simulado.id, { posicao: pos, letra: e.letra, chute: e.chute, tempoMs });
        if (r === "finalizado") {
          router.push(`/simulado/${simulado.id}/resultado`);
          return;
        }
        if (r !== "ok") throw new Error(r);
        naoSalvas.current.delete(pos);
      } catch {
        naoSalvas.current.add(pos);
        setAviso("Não consegui salvar sua última resposta. Verifique a conexão: ela será reenviada quando você trocar de questão ou finalizar.");
      }
    },
    [router, simulado.id],
  );

  const reenviarPendentes = useCallback(async () => {
    for (const pos of [...naoSalvas.current]) {
      const e = estadoRef.current[pos];
      if (e) await salvar(pos, e, tempoDe(pos, false));
    }
  }, [salvar, tempoDe]);

  const fecharQuestao = useCallback(() => {
    acumulado.current[posicao] = tempoDe(posicao, true);
    inicio.current = performance.now();
  }, [posicao, tempoDe]);

  const irPara = useCallback(
    (novo: number) => {
      if (novo < 0 || novo >= total || novo === idx) return;
      fecharQuestao();
      const e = estadoRef.current[posicao];
      if (e && e.letra) void salvar(posicao, e, acumulado.current[posicao] ?? 0); // persiste o tempo gasto
      void reenviarPendentes();
      setIdx(novo);
      inicio.current = performance.now();
    },
    [total, idx, fecharQuestao, posicao, salvar, reenviarPendentes],
  );

  const marcar = useCallback(
    (letra: Letra) => {
      const novo: Estado = { letra, chute: respostas[posicao]?.chute ?? false };
      setRespostas((r) => ({ ...r, [posicao]: novo }));
      setAviso(null);
      void salvar(posicao, novo, tempoDe(posicao, true));
    },
    [posicao, respostas, salvar, tempoDe],
  );

  const alternarChute = useCallback(
    (v: boolean) => {
      const atual = respostas[posicao] ?? { letra: null, chute: false };
      const novo = { ...atual, chute: v };
      setRespostas((r) => ({ ...r, [posicao]: novo }));
      if (atual.letra) void salvar(posicao, novo, tempoDe(posicao, true));
    },
    [posicao, respostas, salvar, tempoDe],
  );

  // atalhos: A-E marca; setas navegam
  useEffect(() => {
    const aoTeclar = (ev: KeyboardEvent) => {
      const alvo = ev.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "SELECT" || alvo.tagName === "TEXTAREA" || (alvo.tagName === "INPUT" && (alvo as HTMLInputElement).type === "text"))) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const k = ev.key.toUpperCase();
      if (item && k.length === 1 && "ABCDE".includes(k) && "ABCDE".indexOf(k) < item.alternativas.length) {
        ev.preventDefault();
        marcar(k as Letra);
      } else if (ev.key === "ArrowRight") irPara(idx + 1);
      else if (ev.key === "ArrowLeft") irPara(idx - 1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [item, marcar, irPara, idx]);

  const respondidas = useMemo(() => Object.values(respostas).filter((r) => r.letra).length, [respostas]);
  if (!item) return null;

  const finalizar = () => {
    fecharQuestao();
    iniciarFinalizar(async () => {
      const e = estadoRef.current[posicao];
      if (e && e.letra) await salvar(posicao, e, acumulado.current[posicao] ?? 0);
      await reenviarPendentes();
      if (naoSalvas.current.size > 0) {
        setAviso("Ainda há respostas que não foram enviadas. Verifique a conexão e tente finalizar de novo.");
        setConfirmando(false);
        return;
      }
      await finalizarAction(simulado.id);
    });
  };

  const atual = respostas[posicao];
  return (
    <div className="pilha">
      <div className="linha entre">
        <h1 style={{ fontSize: "var(--t-xl)" }}>Questão {posicao} de {total}</h1>
        <div role="status" aria-live="polite">
          <Barra fracao={respondidas / total} rotulo="Questões respondidas" largura={16} /> <span>{respondidas}/{total} respondidas</span>
        </div>
      </div>

      <div className="prova-layout">
        <article className="pilha" aria-labelledby="enunciado-q" key={item.questaoId}>
          <small className="suave">{item.disciplina}</small>
          {item.avisos.filter((a) => a.codigo !== "assunto_sugerido").map((a) => <Aviso key={a.codigo} aviso={a} />)}
          {item.textoApoio && (
            <details open>
              <summary><strong>Texto de apoio</strong></summary>
              <div className="texto-apoio" style={{ marginTop: "var(--e3)" }}>{item.textoApoio}</div>
            </details>
          )}
          <p id="enunciado-q" className="enunciado" style={{ marginBottom: 0 }}>{item.enunciado}</p>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="so-leitor">Alternativas da questão {posicao}</legend>
            <ul className="alternativas">
              {item.alternativas.map((alt) => (
                <li key={alt.letra}>
                  <label className="alt">
                    <input type="radio" name={`q${posicao}`} value={alt.letra} checked={atual?.letra === alt.letra} onChange={() => marcar(alt.letra)} />
                    <span className="marca-alt" aria-hidden="true" />
                    <span className="so-leitor">Alternativa {alt.letra}: </span>
                    <span className="texto-alt"><strong aria-hidden="true">{alt.letra}) </strong>{alt.texto}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <div className="marcador">
            <input type="checkbox" id="chute" checked={atual?.chute ?? false} onChange={(e) => alternarChute(e.target.checked)} />
            <div>
              <label htmlFor="chute">Marcar como chute</label>
              <div><small>Ajuda o relatório a separar o que você sabe do que acertou por sorte.</small></div>
            </div>
          </div>

          <div className="linha">
            <button type="button" className="btn" onClick={() => irPara(idx - 1)} disabled={idx === 0} aria-disabled={idx === 0}>Anterior</button>
            <button type="button" className="btn" onClick={() => irPara(idx + 1)} disabled={idx === total - 1} aria-disabled={idx === total - 1}>Próxima</button>
          </div>
          <small className="suave">Atalhos: teclas A a E marcam a alternativa; setas esquerda e direita trocam de questão.</small>
          <ReportarProblema key={item.questaoId} simuladoId={simulado.id} posicao={posicao} />
        </article>

        <aside className="navegador painel pilha-p" aria-label="Navegação entre questões">
          <span className="rotulo">Questões</span>
          <div className="navegador-grade">
            {simulado.itens.map((_, i) => {
              const p = i + 1;
              const r = respostas[p];
              return (
                <button key={p} type="button" className="q-botao" onClick={() => irPara(i)} aria-current={i === idx ? "true" : undefined} data-respondida={r?.letra ? "true" : "false"} data-chute={r?.chute ? "true" : "false"}
                  aria-label={`Questão ${p}${r?.letra ? `, respondida ${r.letra}` : ", em branco"}${r?.chute ? ", marcada como chute" : ""}`}>
                  {p}
                </button>
              );
            })}
          </div>
          <small className="suave">Preenchido: respondida. Com ? : marcada como chute.</small>
          <hr style={{ margin: "var(--e3) 0" }} />
          {!confirmando ? (
            <button type="button" className="btn btn-primario" onClick={() => setConfirmando(true)}>Finalizar simulado</button>
          ) : (
            <div className="pilha-p" role="alertdialog" aria-labelledby="conf-titulo">
              <strong id="conf-titulo">Finalizar agora?</strong>
              <p style={{ marginBottom: 0 }}>
                {respondidas === total ? "Todas as questões foram respondidas." : `Você deixou ${total - respondidas} questão(ões) em branco. Elas contam como erro.`} Depois de finalizar não dá para alterar as respostas.
              </p>
              <button type="button" className="btn btn-primario" onClick={finalizar} disabled={finalizando} aria-disabled={finalizando} data-carregando={finalizando}>
                {finalizando ? (<><Spinner /> Corrigindo...</>) : "Confirmar e ver resultado"}
              </button>
              <button type="button" className="btn btn-fantasma" onClick={() => setConfirmando(false)} disabled={finalizando}>Voltar à prova</button>
            </div>
          )}
        </aside>
      </div>
      <Toast mensagem={aviso} />
    </div>
  );
}
