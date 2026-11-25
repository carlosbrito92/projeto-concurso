import Link from "next/link";
import { FormNovoSimulado } from "@/components/FormNovoSimulado";
import { Barra } from "@/components/Barra";
import { Aviso } from "@/components/Aviso";
import { SeletorConcurso } from "@/components/SeletorConcurso";
import { nomeDaArea } from "@/lib/areas";
import { usuarioAtualId } from "@/lib/auth";
import { usandoPoliticaDeTeste } from "@/lib/ambiente";
import { dataCurta, pct, rotuloNivel } from "@/lib/formatar";
import { repoAtual } from "@/lib/repo/index";
import { panorama } from "@/lib/servico";

export const metadata = { title: "Painel" };
export const dynamic = "force-dynamic";

export default async function Painel({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const usuario = await usuarioAtualId();
  const repo = repoAtual();
  const concursos = await repo.listarConcursos();

  if (concursos.length === 0) {
    return (
      <div className="painel pilha-p">
        <h1>Painel</h1>
        <p>Ainda não há concursos cadastrados. Assim que o primeiro edital for publicado, ele aparece aqui.</p>
      </div>
    );
  }
  const atual = concursos.find((x) => x.slug === c) ?? concursos[0]!;
  const [edital, simulados, pan] = await Promise.all([repo.obterEdital(atual.slug), repo.listarSimulados(usuario, atual.slug), panorama(repo, usuario, atual.slug)]);
  const temHistorico = simulados.some((s) => s.status === "finalizado");

  return (
    <div className="pilha">
      <div>
        <h1>Painel</h1>
        {usandoPoliticaDeTeste() && (
          <div style={{ marginTop: "var(--e4)" }}>
            <Aviso aviso={{ nivel: "atencao", texto: "Ambiente de teste: questões ainda não liberadas juridicamente estão visíveis só aqui. Não compartilhe este endereço." }} />
          </div>
        )}
      </div>

      <section className="painel pilha-p" aria-labelledby="sec-concurso">
        <span className="rotulo" style={{ margin: 0 }}>Concurso · {nomeDaArea(atual.area)}</span>
        <h2 id="sec-concurso" className="titulo-sec">{atual.cargo}</h2>
        <p className="suave" style={{ marginBottom: 0 }}>{atual.orgao} ({atual.uf}), banca {atual.banca}, edital {atual.edital}. Prova com {atual.totalQuestoes} questões.</p>
        {concursos.length > 1 && <SeletorConcurso concursos={concursos} atualSlug={atual.slug} abertoInicial={!c} />}
      </section>

      <div className="grade">
        <section className="painel col-7" aria-labelledby="sec-novo">
          <h2 id="sec-novo" className="titulo-sec">Novo simulado</h2>
          <FormNovoSimulado concursoSlug={atual.slug} disciplinas={(edital?.disciplinas ?? []).map((d) => ({ id: d.id, nome: d.nome }))} temHistorico={temHistorico} />
        </section>

        <section className="painel col-5" aria-labelledby="sec-foco">
          <h2 id="sec-foco" className="titulo-sec">Onde focar</h2>
          {!pan ? (
            <div className="pilha-p">
              <p>Faça e finalize um simulado para ver aqui os assuntos do edital em que você mais perde pontos.</p>
              <p className="suave" style={{ marginBottom: 0 }}><small>O relatório melhora a cada simulado: assuntos só são avaliados com 3 ou mais questões.</small></p>
            </div>
          ) : (
            <div className="pilha-p">
              <p style={{ marginBottom: 0 }}>Com base em {pan.resumo.total} questões: <strong>{pct(pan.resumo.percentual)}</strong> de acerto.</p>
              {pan.focos.length === 0 ? <p>Ainda faltam questões por assunto para apontar o foco.</p> : (
                <ol style={{ paddingLeft: "var(--e5)" }}>
                  {pan.focos.slice(0, 5).map((f) => <li key={f.itemId} style={{ marginBottom: "var(--e2)" }}>{f.rotulo}<br /><small>{f.motivo}</small></li>)}
                </ol>
              )}
              <details>
                <summary>Por disciplina</summary>
                <table style={{ marginTop: "var(--e3)" }}>
                  <tbody>
                    {pan.porDisciplina.map((l) => (
                      <tr key={l.chave}><th scope="row" style={{ fontWeight: 400 }}>{l.nome}</th><td><Barra fracao={l.taxa} rotulo={l.nome} largura={8} /></td><td>{rotuloNivel[l.nivel]}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          )}
        </section>
      </div>

      <section className="painel" aria-labelledby="sec-hist">
        <h2 id="sec-hist" className="titulo-sec">Seus simulados</h2>
        {simulados.length === 0 ? (
          <div className="pilha-p">
            <pre className="ascii-bloco" aria-hidden="true">{"[ ]  [ ]  [ ]  [ ]  [ ]\n ?    ?    ?    ?    ?"}</pre>
            <p>Você ainda não fez nenhum simulado neste concurso. Comece por um de 10 questões: leva cerca de 15 minutos e já mostra como o relatório funciona.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th scope="col">Data</th><th scope="col">Questões</th><th scope="col">Acertos</th><th scope="col">Situação</th><th scope="col"><span className="so-leitor">Ação</span></th></tr></thead>
              <tbody>
                {simulados.map((s) => (
                  <tr key={s.id}>
                    <td>{dataCurta(s.criadoEm)}</td>
                    <td>{s.total}</td>
                    <td>{s.acertos === null ? "n/d" : `${s.acertos}/${s.total}`}</td>
                    <td>{s.status === "finalizado" ? "finalizado" : s.status === "em_andamento" ? "em andamento" : "abandonado"}</td>
                    <td>{s.status === "finalizado" ? <Link href={`/simulado/${s.id}/resultado`}>Ver resultado</Link> : s.status === "em_andamento" ? <Link href={`/simulado/${s.id}`}>Continuar</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
