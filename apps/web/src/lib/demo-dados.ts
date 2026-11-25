import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Edital, ItemEdital, Questao } from "@concurso/engine";
import { criarRng } from "@concurso/engine";

/** Sobe pastas até achar `conteudo/` (funciona do app e dos testes). */
export function raizDoRepo(inicio = process.cwd()): string {
  let dir = resolve(inicio);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "conteudo", "concursos"))) return dir;
    const pai = dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error("Pasta conteudo/ não encontrada a partir de " + inicio);
}

interface EditalJson {
  concurso: { slug: string; banca: string; ano: number; cargo: string; orgao: string; edital: string };
  prova: { totalQuestoes: number };
  disciplinas: Array<{ id: string; nome: string; questoes: number | null; peso: number | null; itens: Array<{ id: string; numero: string; texto: string; pai: string | null }> }>;
  grupos?: Array<{ nome: string; questoes: number; disciplinas: string[] }>;
}

export function carregarEditalDoRepo(slug: string): { edital: Edital; orgao: string; editalNome: string } {
  const j = JSON.parse(readFileSync(join(raizDoRepo(), "conteudo", "concursos", slug, "02-json", "edital.json"), "utf8")) as EditalJson;
  const edital: Edital = {
    concurso: { slug: j.concurso.slug, banca: j.concurso.banca, ano: j.concurso.ano, cargo: j.concurso.cargo },
    prova: { totalQuestoes: j.prova.totalQuestoes },
    disciplinas: j.disciplinas.map((d) => ({ id: d.id, nome: d.nome, questoes: d.questoes, peso: d.peso, itens: d.itens.map<ItemEdital>((i) => ({ id: i.id, numero: i.numero, texto: i.texto, pai: i.pai })) })),
    ...(j.grupos ? { grupos: j.grupos } : {}),
  };
  return { edital, orgao: j.concurso.orgao, editalNome: j.concurso.edital };
}

/**
 * Questões FICTÍCIAS para demonstração e testes: nenhuma vem de prova real.
 * Cada uma cita o item do edital sobre o qual "trata" e é marcada [DEMONSTRAÇÃO].
 * Parte delas simula prova antiga (aviso de vigência) para exercitar a interface.
 */
export function gerarQuestoesDemo(edital: Edital, porDisciplina = 8): Questao[] {
  const rng = criarRng(`demo:${edital.concurso.slug}`);
  const out: Questao[] = [];
  let seq = 0;
  for (const d of edital.disciplinas) {
    const porId = new Map(d.itens.map((i) => [i.id, i]));
    const passo = Math.max(1, Math.floor(d.itens.length / porDisciplina));
    for (let k = 0; k < porDisciplina && k * passo < d.itens.length; k++) {
      const item = d.itens[k * passo] as ItemEdital;
      const trilha: string[] = [];
      for (let atual: string | null = item.id, g = 0; atual && g < 12; g++) {
        trilha.unshift(atual);
        atual = porId.get(atual)?.pai ?? null;
      }
      seq += 1;
      const correta = Math.floor(rng() * 5);
      const antiga = seq % 4 === 0;
      out.push({
        id: `Q99${String(seq).padStart(4, "0")}`,
        tipo: "MultiplaEscolha",
        enunciado: `[DEMONSTRAÇÃO] Questão fictícia sobre o item «${item.texto.replace(/[.;:]+$/, "")}». Assinale a alternativa que o sistema considera correta.`,
        alternativas: ["primeira", "segunda", "terceira", "quarta", "quinta"].map((n) => `Alternativa fictícia ${n}.`),
        correta,
        anulada: false,
        classificacao: { disciplina: d.nome, disciplinaId: d.id, assunto: item.texto.replace(/[.;:]+$/, ""), editalItem: item.numero, editalItemId: item.id, editalItemTrilha: trilha, classificacaoStatus: "confirmada" },
        concurso: { banca: edital.concurso.banca, ano: antiga ? 2012 : edital.concurso.ano },
        origem: { tipo: "autoral_ia" },
        direitos: { status: "nao_aplicavel" },
        revisao: { status: "revisado" },
        status: "ativa",
        pendencias: antiga ? ["verificar_vigencia"] : [],
        comentario: `Comentário fictício: a resposta é a alternativa ${"ABCDE"[correta]}. Em questões reais, aqui entra a explicação com a fonte vigente.`,
      });
    }
  }
  return out;
}
