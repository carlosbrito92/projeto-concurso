import Link from "next/link";
import { repoAdmin } from "@/lib/admin";
import { TAMANHO_PAGINA_ADMIN } from "@/lib/tipos";

export const metadata = { title: "Banco de questões" };
export const dynamic = "force-dynamic";

type Busca = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUS = ["rascunho", "ativa", "inativa", "em_revisao"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<Busca> }) {
  const { repo } = await repoAdmin();
  const sp = await searchParams;
  const concurso = /^[a-z0-9-]{1,80}$/.test(um(sp.concurso)) ? um(sp.concurso) : "";
  const status = (STATUS as readonly string[]).includes(um(sp.status)) ? um(sp.status) : "";
  const busca = um(sp.busca).slice(0, 80);
  const so = um(sp.so) === "1";
  const pagina = Math.max(1, Math.min(10000, Number.parseInt(um(sp.pagina), 10) || 1));
  const { itens, total } = await repo.listarQuestoesAdmin({ ...(concurso ? { concurso } : {}), ...(status ? { status } : {}), ...(busca ? { busca } : {}), soComReporteAberto: so, pagina });
  const paginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA_ADMIN));
  const link = (p: number) => {
    const q = new URLSearchParams();
    if (concurso) q.set("concurso", concurso);
    if (status) q.set("status", status);
    if (busca) q.set("busca", busca);
    if (so) q.set("so", "1");
    q.set("pagina", String(p));
    return `/admin/questoes?${q.toString()}`;
  };

  return (
    <div className="pilha">
      <form method="get" className="painel pilha-p" aria-label="Filtros">
        <div className="grade">
          <div className="campo col-6">
            <label htmlFor="busca">Buscar (código ou trecho do enunciado)</label>
            <input type="search" id="busca" name="busca" defaultValue={busca} maxLength={80} />
          </div>
          <div className="campo col-6">
            <label htmlFor="status">Situação</label>
            <select id="status" name="status" defaultValue={status}>
              <option value="">Todas</option>
              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="marcador">
          <input type="checkbox" id="so" name="so" value="1" defaultChecked={so} />
          <label htmlFor="so">Só questões com reporte aberto</label>
        </div>
        {concurso && <input type="hidden" name="concurso" value={concurso} />}
        <div><button type="submit" className="btn">Filtrar</button></div>
      </form>

      <p className="suave" role="status" style={{ margin: 0 }}>{total} questão(ões). Página {Math.min(pagina, paginas)} de {paginas}.</p>

      {itens.length === 0 ? (
        <section className="painel pilha-p">
          <h2 className="titulo-sec">Nenhuma questão com esses filtros</h2>
          <div><Link className="btn" href="/admin/questoes">Limpar filtros</Link></div>
        </section>
      ) : (
        <ul className="pilha-p" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {itens.map((q) => (
            <li key={q.id} className="painel">
              <details>
                <summary>
                  <strong>{q.id}</strong>
                  {q.numeroNaProva ? ` Q${q.numeroNaProva}` : ""} · {q.disciplina} · {q.status}
                  {q.anulada ? " · ANULADA" : ""}
                  {q.reportesAbertos > 0 ? ` · [!] ${q.reportesAbertos} reporte(s) aberto(s)` : ""}
                  <br />
                  <small className="suave">{q.enunciado.length > 140 ? `${q.enunciado.slice(0, 140).trimEnd()}...` : q.enunciado}</small>
                </summary>
                <div className="pilha-p" style={{ marginTop: "var(--e4)" }}>
                  <small className="suave">{[q.banca, q.ano, q.assunto ? `assunto: ${q.assunto}` : "assunto: não definido", `direitos: ${q.direitos}`, `revisão: ${q.revisao}`, `reportes: ${q.reportesTotal} no total`].filter(Boolean).join(" · ")}</small>
                  <p className="enunciado" style={{ margin: 0 }}>{q.enunciado}</p>
                  <ol type="A" style={{ margin: 0 }}>
                    {q.alternativas.map((t, i) => {
                      const letra = "ABCDE"[i];
                      const certa = q.correta === letra;
                      return <li key={letra}>{t}{certa ? " [gabarito]" : ""}</li>;
                    })}
                  </ol>
                  {q.correta === null && <small className="suave">Sem gabarito definido{q.anulada ? " (questão anulada)" : ""}.</small>}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {paginas > 1 && (
        <nav className="linha" aria-label="Páginas">
          {pagina > 1 && <Link className="btn" href={link(pagina - 1)}>Anterior</Link>}
          {pagina < paginas && <Link className="btn" href={link(pagina + 1)}>Próxima</Link>}
        </nav>
      )}
    </div>
  );
}
