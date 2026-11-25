"use client";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { nomeDaArea } from "@/lib/areas";
import { agrupar, LIMITE_FILTROS, opcoes, SEM_FILTRO } from "@/lib/catalogo";
import type { FiltroCatalogo } from "@/lib/catalogo";
import type { ConcursoResumo } from "@/lib/tipos";

/**
 * Catálogo de concursos agrupado por área. Escala para muitas áreas e concursos: a lista é sempre agrupada;
 * acima de LIMITE_FILTROS entram busca e filtros por área, UF e banca. Cada linha é um link (funciona sem JavaScript).
 */
export function SeletorConcurso({ concursos, atualSlug, abertoInicial }: { concursos: ConcursoResumo[]; atualSlug: string; abertoInicial: boolean }) {
  const id = useId();
  const [f, setF] = useState<FiltroCatalogo>(SEM_FILTRO);
  const comFiltros = concursos.length > LIMITE_FILTROS;
  const grupos = useMemo(() => agrupar(concursos, f), [concursos, f]);
  const op = useMemo(() => opcoes(concursos), [concursos]);
  const exibidos = grupos.reduce((n, g) => n + g.itens.length, 0);
  const filtrando = f.busca.trim() !== "" || f.area !== "" || f.uf !== "" || f.banca !== "";
  const muda = (campo: keyof FiltroCatalogo) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [campo]: e.target.value }));

  return (
    <details className="catalogo" open={abertoInicial}>
      <summary>Trocar concurso ({concursos.length} disponíveis)</summary>
      <div className="pilha-p" style={{ marginTop: "var(--e4)" }}>
        {comFiltros && (
          <form role="search" aria-label="Filtrar concursos" onSubmit={(e) => e.preventDefault()} className="grade">
            <div className="campo col-12">
              <label htmlFor={`${id}-busca`}>Buscar (órgão, cargo, banca, ano)</label>
              <input type="search" id={`${id}-busca`} value={f.busca} onChange={muda("busca")} autoComplete="off" />
            </div>
            <div className="campo col-4">
              <label htmlFor={`${id}-area`}>Área</label>
              <select id={`${id}-area`} value={f.area} onChange={muda("area")}>
                <option value="">Todas</option>
                {op.areas.map((a) => <option key={a} value={a}>{nomeDaArea(a)}</option>)}
              </select>
            </div>
            <div className="campo col-4">
              <label htmlFor={`${id}-uf`}>UF</label>
              <select id={`${id}-uf`} value={f.uf} onChange={muda("uf")}>
                <option value="">Todas</option>
                {op.ufs.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="campo col-4">
              <label htmlFor={`${id}-banca`}>Banca</label>
              <select id={`${id}-banca`} value={f.banca} onChange={muda("banca")}>
                <option value="">Todas</option>
                {op.bancas.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </form>
        )}

        <p role="status" aria-live="polite" className="suave" style={{ margin: 0 }}>
          {filtrando ? `${exibidos} de ${concursos.length} concursos` : `${concursos.length} concursos em ${grupos.length} ${grupos.length === 1 ? "área" : "áreas"}`}
        </p>

        {grupos.length === 0 ? (
          <div className="pilha-p">
            <p style={{ margin: 0 }}>Nenhum concurso com esses filtros.</p>
            <div><button type="button" className="btn" onClick={() => setF(SEM_FILTRO)}>Limpar filtros</button></div>
          </div>
        ) : (
          grupos.map((g) => (
            <section key={g.area} aria-labelledby={`${id}-g-${g.area}`} className="pilha-p">
              <h3 id={`${id}-g-${g.area}`} className="titulo-sec" style={{ fontSize: "var(--t-base)" }}>
                {g.nome} <small>({g.itens.length})</small>
              </h3>
              <ul className="catalogo-lista">
                {g.itens.map((c) => {
                  const ativo = c.slug === atualSlug;
                  return (
                    <li key={c.slug}>
                      <Link href={`/painel?c=${c.slug}`} className="catalogo-item" aria-current={ativo ? "page" : undefined}>
                        <span aria-hidden="true" className="catalogo-marca">{ativo ? "(x)" : "( )"}</span>
                        <span>
                          <strong>{c.cargo}</strong>
                          <br />
                          <small>{c.orgao} · {c.banca} · {c.ano} · {c.uf}</small>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </details>
  );
}
