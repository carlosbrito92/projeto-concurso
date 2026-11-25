import { nomeDaArea, ordemDaArea } from "./areas.ts";
import type { ConcursoResumo } from "./tipos.ts";

export interface FiltroCatalogo {
  busca: string;
  area: string;
  uf: string;
  banca: string;
}
export const SEM_FILTRO: FiltroCatalogo = { busca: "", area: "", uf: "", banca: "" };

/** A partir deste total o seletor mostra busca e filtros (antes disso a lista agrupada basta). */
export const LIMITE_FILTROS = 8;

export interface GrupoCatalogo {
  area: string;
  nome: string;
  itens: ConcursoResumo[];
}

const normalizar = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function combina(c: ConcursoResumo, f: FiltroCatalogo): boolean {
  if (f.area && c.area !== f.area) return false;
  if (f.uf && c.uf !== f.uf) return false;
  if (f.banca && c.banca !== f.banca) return false;
  const termos = normalizar(f.busca).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return true;
  const alvo = normalizar(`${c.orgao} ${c.cargo} ${c.banca} ${c.uf} ${c.ano} ${c.edital} ${nomeDaArea(c.area)}`);
  return termos.every((t) => alvo.includes(t));
}

/** Concursos agrupados por área (ordem fixa da taxonomia); dentro de cada área, mais recentes primeiro. */
export function agrupar(lista: readonly ConcursoResumo[], f: FiltroCatalogo = SEM_FILTRO): GrupoCatalogo[] {
  const por = new Map<string, ConcursoResumo[]>();
  for (const c of lista) {
    if (!combina(c, f)) continue;
    por.set(c.area, [...(por.get(c.area) ?? []), c]);
  }
  return [...por.entries()]
    .map(([area, itens]) => ({
      area,
      nome: nomeDaArea(area),
      itens: [...itens].sort((a, b) => b.ano - a.ano || a.orgao.localeCompare(b.orgao, "pt-BR") || a.cargo.localeCompare(b.cargo, "pt-BR")),
    }))
    .sort((a, b) => ordemDaArea(a.area) - ordemDaArea(b.area) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Valores disponíveis para os filtros (só o que existe no catálogo). */
export function opcoes(lista: readonly ConcursoResumo[]) {
  const unicos = (f: (c: ConcursoResumo) => string) => [...new Set(lista.map(f))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    areas: [...new Set(lista.map((c) => c.area))].sort((a, b) => ordemDaArea(a) - ordemDaArea(b) || nomeDaArea(a).localeCompare(nomeDaArea(b), "pt-BR")),
    ufs: unicos((c) => c.uf),
    bancas: unicos((c) => c.banca),
  };
}
