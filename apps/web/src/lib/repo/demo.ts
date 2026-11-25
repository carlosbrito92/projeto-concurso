import { carregarEditalDoRepo, gerarQuestoesDemo } from "../demo-dados.ts";
import type { Repositorio } from "../tipos.ts";
import { criarRepoMemoria } from "./memoria.ts";

export const CONCURSO_DEMO = "pc-mg-fgv-2024";
/** Os demais editais REAIS já carregados no projeto (conteúdo público); as questões de todos continuam fictícias. */
const CONCURSOS_REAIS = [CONCURSO_DEMO, "pc-mg-fumarc-2014", "pc-ma-fgv-2012", "pc-am-fgv-2021"];

/**
 * Entradas FICTÍCIAS só para a demonstração exercitar o seletor com várias áreas (usam a estrutura de edital do piloto).
 * Aparecem rotuladas "(demonstração)"; não existem fora do modo demonstração.
 */
const EXTRAS_DEMO = [
  { slug: "demo-tj-analista", area: "justica", uf: "SP", orgao: "Tribunal de Justiça (demonstração)", cargo: "Analista Judiciário (demonstração)", ano: 2025, edital: "01/2025" },
  { slug: "demo-fisco-auditor", area: "fiscal", uf: "BR", orgao: "Secretaria da Receita (demonstração)", cargo: "Auditor Fiscal (demonstração)", ano: 2024, edital: "02/2024" },
  { slug: "demo-prefeitura-assistente", area: "administrativa", uf: "RJ", orgao: "Prefeitura Municipal (demonstração)", cargo: "Assistente Administrativo (demonstração)", ano: 2025, edital: "03/2025" },
  { slug: "demo-saude-tecnico", area: "saude", uf: "MG", orgao: "Secretaria de Saúde (demonstração)", cargo: "Técnico de Enfermagem (demonstração)", ano: 2023, edital: "04/2023" },
  { slug: "demo-ti-analista", area: "tecnologia", uf: "DF", orgao: "Órgão de TI (demonstração)", cargo: "Analista de Sistemas (demonstração)", ano: 2024, edital: "05/2024" },
] as const;

/** Repositório de demonstração: editais REAIS + questões FICTÍCIAS (e entradas rotuladas de outras áreas, só para ver o seletor). */
export function criarRepoDemo(): Repositorio {
  const reais = CONCURSOS_REAIS.map((slug, i) => {
    const { edital, orgao, editalNome, area, uf } = carregarEditalDoRepo(slug);
    return {
      resumo: { slug, area, uf, orgao, banca: edital.concurso.banca, cargo: edital.concurso.cargo, ano: edital.concurso.ano, edital: editalNome, totalQuestoes: edital.prova.totalQuestoes },
      edital,
      pool: gerarQuestoesDemo(edital, 8, i),
    };
  });
  const base = carregarEditalDoRepo(CONCURSO_DEMO).edital;
  const extras = EXTRAS_DEMO.map((x, i) => {
    const edital = { ...base, concurso: { ...base.concurso, slug: x.slug, cargo: x.cargo, banca: "Banca Demo", ano: x.ano } };
    return {
      resumo: { slug: x.slug, area: x.area, uf: x.uf, orgao: x.orgao, banca: "Banca Demo", cargo: x.cargo, ano: x.ano, edital: x.edital, totalQuestoes: edital.prova.totalQuestoes },
      edital,
      pool: gerarQuestoesDemo(edital, 8, CONCURSOS_REAIS.length + i),
    };
  });
  return criarRepoMemoria({ concursos: [...reais, ...extras] });
}
