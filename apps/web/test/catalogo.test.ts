import assert from "node:assert/strict";
import { test } from "node:test";
import { nomeDaArea, ordemDaArea } from "../src/lib/areas.ts";
import { agrupar, combina, LIMITE_FILTROS, opcoes, SEM_FILTRO } from "../src/lib/catalogo.ts";
import type { ConcursoResumo } from "../src/lib/tipos.ts";

const c = (slug: string, area: string, extra: Partial<ConcursoResumo> = {}): ConcursoResumo => ({
  slug, area, uf: "MG", orgao: "Órgão " + slug, banca: "FGV", cargo: "Cargo " + slug, ano: 2024, edital: "01/2024", totalQuestoes: 70, ...extra,
});

const LISTA = [
  c("pc-mg-2014", "seguranca-publica", { ano: 2014, orgao: "Polícia Civil de Minas Gerais", cargo: "Investigador de Polícia", banca: "FUMARC" }),
  c("pc-mg-2024", "seguranca-publica", { ano: 2024, orgao: "Polícia Civil de Minas Gerais", cargo: "Investigador de Polícia I" }),
  c("pc-am-2021", "seguranca-publica", { ano: 2021, uf: "AM", orgao: "Polícia Civil do Amazonas", cargo: "Investigador de Polícia – 4ª Classe" }),
  c("tj-sp", "justica", { ano: 2025, uf: "SP", orgao: "Tribunal de Justiça de São Paulo", cargo: "Analista Judiciário", banca: "VUNESP" }),
  c("tecnologia-x", "area-nova-sem-rotulo", { ano: 2023, uf: "DF", orgao: "Órgão de TI", cargo: "Analista de Sistemas" }),
];

test("áreas: rótulo conhecido, derivado do slug e ordem estável", () => {
  assert.equal(nomeDaArea("seguranca-publica"), "Segurança pública");
  assert.equal(nomeDaArea("area-nova-sem-rotulo"), "Area nova sem rotulo");
  assert.equal(nomeDaArea(""), "Outras áreas");
  assert.ok(ordemDaArea("seguranca-publica") < ordemDaArea("justica"));
  assert.ok(ordemDaArea("justica") < ordemDaArea("area-desconhecida"), "desconhecidas depois das conhecidas");
});

test("agrupar: ordem das áreas fixa, desconhecidas no fim, mais recentes primeiro dentro da área", () => {
  const g = agrupar(LISTA);
  assert.deepEqual(g.map((x) => x.nome), ["Segurança pública", "Tribunais e Justiça", "Area nova sem rotulo"]);
  assert.deepEqual(g[0]?.itens.map((x) => x.slug), ["pc-mg-2024", "pc-am-2021", "pc-mg-2014"]);
  assert.equal(g.reduce((n, x) => n + x.itens.length, 0), LISTA.length, "nada se perde");
});

test("agrupar não altera a lista de entrada", () => {
  const copia = structuredClone(LISTA);
  agrupar(LISTA, { ...SEM_FILTRO, busca: "policia" });
  assert.deepEqual(LISTA, copia);
});

test("filtros: área, UF e banca (e combinados)", () => {
  assert.deepEqual(agrupar(LISTA, { ...SEM_FILTRO, area: "justica" }).flatMap((x) => x.itens.map((i) => i.slug)), ["tj-sp"]);
  assert.deepEqual(agrupar(LISTA, { ...SEM_FILTRO, uf: "AM" }).flatMap((x) => x.itens.map((i) => i.slug)), ["pc-am-2021"]);
  assert.deepEqual(agrupar(LISTA, { ...SEM_FILTRO, banca: "FUMARC" }).flatMap((x) => x.itens.map((i) => i.slug)), ["pc-mg-2014"]);
  assert.deepEqual(agrupar(LISTA, { ...SEM_FILTRO, area: "seguranca-publica", uf: "MG" }).flatMap((x) => x.itens.map((i) => i.slug)), ["pc-mg-2024", "pc-mg-2014"]);
  assert.deepEqual(agrupar(LISTA, { ...SEM_FILTRO, area: "justica", uf: "MG" }), [], "sem resultado = lista vazia");
});

test("busca: ignora acento e caixa, exige todos os termos, acha por órgão, cargo, banca, ano, UF e área", () => {
  const slugs = (busca: string) => agrupar(LISTA, { ...SEM_FILTRO, busca }).flatMap((x) => x.itens.map((i) => i.slug));
  assert.deepEqual(slugs("POLICIA"), ["pc-mg-2024", "pc-am-2021", "pc-mg-2014"]);
  assert.deepEqual(slugs("polícia investigador 2021"), ["pc-am-2021"]);
  assert.deepEqual(slugs("sao paulo"), ["tj-sp"]);
  assert.deepEqual(slugs("vunesp"), ["tj-sp"]);
  assert.deepEqual(slugs("justica"), ["tj-sp"], "acha pelo nome da área");
  assert.equal(slugs("   ").length, LISTA.length);
  assert.deepEqual(slugs("zzz"), []);
  assert.equal(combina(LISTA[0]!, { ...SEM_FILTRO, busca: "4ª classe" }), false);
  assert.equal(combina(LISTA[2]!, { ...SEM_FILTRO, busca: "4ª classe" }), true);
});

test("opções dos filtros vêm só do que existe", () => {
  const o = opcoes(LISTA);
  assert.deepEqual(o.areas, ["seguranca-publica", "justica", "area-nova-sem-rotulo"]);
  assert.deepEqual(o.ufs, ["AM", "DF", "MG", "SP"]);
  assert.deepEqual(o.bancas, ["FGV", "FUMARC", "VUNESP"]);
  assert.equal(LIMITE_FILTROS, 8);
});
