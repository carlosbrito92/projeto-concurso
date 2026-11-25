import type { Relatorio } from "@concurso/engine";
import { duracao, pct, rotuloNivel } from "@/lib/formatar";
import { Aviso } from "./Aviso";
import { Barra } from "./Barra";

function Nivel({ nivel }: { nivel: string }) {
  return <span className={`nivel nivel-${nivel}`}>{rotuloNivel[nivel] ?? nivel}</span>;
}

export function RelatorioView({ r, titulo = "Resultado", mostrarErros = true }: { r: Relatorio; titulo?: string; mostrarErros?: boolean }) {
  const { resumo } = r;
  const assuntosFracos = r.porAssunto.filter((a) => a.nivel === "critico" || a.nivel === "atencao").slice(0, 12);
  return (
    <div className="pilha">
      <section aria-labelledby="rel-resumo" className="painel">
        <h2 id="rel-resumo" className="titulo-sec">{titulo}</h2>
        <dl className="grade" style={{ margin: 0 }}>
          <div className="col-4"><dt className="rotulo">Acertos</dt><dd style={{ margin: 0 }}><span className="num-grande">{resumo.acertos}</span> de {resumo.total}</dd></div>
          <div className="col-4"><dt className="rotulo">Aproveitamento</dt><dd style={{ margin: 0 }}><span className="num-grande">{pct(resumo.percentual)}</span></dd></div>
          <div className="col-4"><dt className="rotulo">Em branco</dt><dd style={{ margin: 0 }}><span className="num-grande">{resumo.brancos}</span></dd></div>
          <div className="col-4"><dt className="rotulo">Tempo médio por questão</dt><dd style={{ margin: 0 }}><span className="num-grande" style={{ fontSize: "var(--t-xl)" }}>{duracao(resumo.tempoMedioMs)}</span></dd></div>
        </dl>
        <ul style={{ marginTop: "var(--e5)", marginBottom: 0 }}>
          {r.insights.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </section>

      {r.avisos.filter((a) => a.codigo !== "assunto_sugerido").map((a) => (
        <Aviso key={a.codigo} aviso={{ nivel: a.nivel, texto: `${a.questoes} questão(ões) neste resultado: ${a.texto}` }} />
      ))}

      <section aria-labelledby="rel-foco" className="painel">
        <h2 id="rel-foco" className="titulo-sec">Onde focar</h2>
        {r.focos.length === 0 ? (
          <p>Ainda não há questões suficientes por assunto ou disciplina para indicar onde focar. Cada simulado novo melhora esta lista.</p>
        ) : (
          <ol>
            {r.focos.map((f) => (
              <li key={f.itemId} style={{ marginBottom: "var(--e3)" }}>
                <strong>{f.rotulo}</strong>
                <br />
                <small>{f.escopo === "assunto" ? "assunto do edital" : "disciplina"} · {f.motivo}</small>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="rel-disc" className="painel">
        <h2 id="rel-disc" className="titulo-sec">Por disciplina</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th scope="col">Disciplina</th><th scope="col">Desempenho</th><th scope="col">Acertos</th><th scope="col">Nível</th><th scope="col">Peso na prova</th></tr>
            </thead>
            <tbody>
              {r.porDisciplina.map((l) => (
                <tr key={l.chave}>
                  <th scope="row" style={{ fontWeight: 400 }}>{l.nome}</th>
                  <td><Barra fracao={l.taxa} rotulo={`Aproveitamento em ${l.nome}`} largura={12} /></td>
                  <td>{l.acertos}/{l.n}</td>
                  <td><Nivel nivel={l.nivel} /></td>
                  <td>{l.peso ? pct(l.peso) : "n/d"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {assuntosFracos.length > 0 && (
        <details className="painel">
          <summary><strong>Assuntos do edital com desempenho abaixo do esperado</strong> ({assuntosFracos.length})</summary>
          <div style={{ overflowX: "auto", marginTop: "var(--e4)" }}>
            <table>
              <thead><tr><th scope="col">Item</th><th scope="col">Assunto</th><th scope="col">Acertos</th><th scope="col">Nível</th></tr></thead>
              <tbody>
                {assuntosFracos.map((a) => (
                  <tr key={a.itemId}><td>{a.numero ?? ""}</td><td>{a.nome}</td><td>{a.acertos}/{a.n}</td><td><Nivel nivel={a.nivel} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {mostrarErros && (
        <section aria-labelledby="rel-erros" className="painel">
          <h2 id="rel-erros" className="titulo-sec">Caderno de erros ({r.cadernoDeErros.length})</h2>
          {r.cadernoDeErros.length === 0 ? (
            <p>Nenhum erro neste simulado.</p>
          ) : (
            <div className="pilha-p">
              {r.cadernoDeErros.map((e) => (
                <details key={e.questaoId}>
                  <summary>
                    <strong>Questão {e.posicao}</strong> · {e.disciplina} · marcou {e.letraMarcada ?? "nenhuma"}, correta {e.letraCorreta}
                  </summary>
                  <div style={{ padding: "var(--e3) var(--e5)" }} className="pilha-p">
                    {e.assuntoTrilha.length > 0 && <small>Assunto do edital: {e.assuntoTrilha.join(" > ")}</small>}
                    {e.comentario ? <p style={{ marginBottom: 0 }}>{e.comentario}</p> : <small>Esta questão ainda não tem comentário.</small>}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
