import assert from "node:assert/strict";
import { test } from "node:test";
import { letraCorreta, POLITICA_DESENVOLVIMENTO, POLITICA_PADRAO } from "@concurso/engine";
import { appEnv, modoDemo, politicaQuestoes } from "../src/lib/ambiente.ts";
import { carregarEditalDoRepo, gerarQuestoesDemo } from "../src/lib/demo-dados.ts";
import { criarRepoDemo, CONCURSO_DEMO } from "../src/lib/repo/demo.ts";
import { criarRepoMemoria } from "../src/lib/repo/memoria.ts";
import { criarSimulado, finalizarSimulado, fracosDoRelatorio, panorama, registrarResposta, simuladoParaProva } from "../src/lib/servico.ts";
import { ErroDeNegocio } from "../src/lib/tipos.ts";
import type { Repositorio } from "../src/lib/tipos.ts";

let n = 0;
const ctx = () => ({ agora: () => new Date(Date.UTC(2026, 0, 1, 12, 0, n++)), novoId: () => `sim-${n++}`, aleatorio: () => String(n++) });
const pedido = (extra = {}) => ({ concursoSlug: CONCURSO_DEMO, n: 10, ...extra });

async function responderTudo(repo: Repositorio, usuario: string, id: string, acerta: (pos: number) => boolean) {
  const comp = await repo.carregarSimuladoCompleto(usuario, id);
  assert.ok(comp);
  for (const [i, item] of comp.simulado.itens.entries()) {
    const certa = letraCorreta(item);
    const letra = acerta(i + 1) ? certa : certa === "A" ? "B" : "A";
    assert.equal(await registrarResposta(repo, usuario, id, { posicao: i + 1, letra, tempoMs: 30000 }), "ok");
  }
}

test("cria simulado com a política padrão usando as questões de demonstração (liberadas)", async () => {
  const repo = criarRepoDemo();
  const id = await criarSimulado(repo, "u1", pedido(), POLITICA_PADRAO, ctx());
  const s = await simuladoParaProva(repo, "u1", id);
  assert.equal(s?.itens.length, 10);
  assert.equal(s?.status, "em_andamento");
});

test("o que vai à tela da prova não contém gabarito nem comentário", async () => {
  const repo = criarRepoDemo();
  const id = await criarSimulado(repo, "u1", pedido(), POLITICA_PADRAO, ctx());
  const json = JSON.stringify(await simuladoParaProva(repo, "u1", id));
  assert.ok(!json.includes("Comentário fictício"));
  assert.ok(!/"correta"|"gabarito"|letraCorreta/.test(json));
  assert.ok(json.includes("DEMONSTRAÇÃO"));
});

test("com questões reais pendentes de direitos, o aluno recebe uma mensagem clara (nada vaza)", async () => {
  const { edital } = carregarEditalDoRepo(CONCURSO_DEMO);
  const pendentes = gerarQuestoesDemo(edital).map((q) => ({ ...q, direitos: { status: "pendente_juridico" as const }, status: "rascunho" as const, revisao: { status: "automatico" as const } }));
  const repo = criarRepoMemoria({ concursos: [{ resumo: { slug: CONCURSO_DEMO, area: "seguranca-publica", uf: "MG", orgao: "o", banca: "b", cargo: "c", ano: 2024, edital: "e", totalQuestoes: 70 }, edital, pool: pendentes }] });
  await assert.rejects(criarSimulado(repo, "u1", pedido(), POLITICA_PADRAO, ctx()), (e: unknown) => e instanceof ErroDeNegocio && /Ainda não há questões liberadas/.test(e.message));
  // a política de desenvolvimento (só ambiente de teste) as libera
  assert.ok(await criarSimulado(repo, "u1", pedido(), POLITICA_DESENVOLVIMENTO, ctx()));
});

test("quantidade inválida e concurso inexistente são recusados", async () => {
  const repo = criarRepoDemo();
  await assert.rejects(criarSimulado(repo, "u1", pedido({ n: 7 }), POLITICA_PADRAO, ctx()), ErroDeNegocio);
  await assert.rejects(criarSimulado(repo, "u1", pedido({ concursoSlug: "nao-existe" }), POLITICA_PADRAO, ctx()), /Concurso não encontrado/);
});

test("filtra por disciplina", async () => {
  const repo = criarRepoDemo();
  const id = await criarSimulado(repo, "u1", pedido({ n: 5, disciplina: "D07" }), POLITICA_PADRAO, ctx());
  const s = await simuladoParaProva(repo, "u1", id);
  assert.ok(s?.itens.every((i) => i.disciplina === "Noções de Direito Penal"));
});

test("isolamento: outro usuário não vê, não responde e não finaliza o simulado alheio", async () => {
  const repo = criarRepoDemo();
  const id = await criarSimulado(repo, "u1", pedido(), POLITICA_PADRAO, ctx());
  assert.equal(await simuladoParaProva(repo, "u2", id), null);
  assert.equal(await registrarResposta(repo, "u2", id, { posicao: 1, letra: "A" }), "inexistente");
  await assert.rejects(finalizarSimulado(repo, "u2", id), /não encontrado/);
  assert.deepEqual(await repo.listarSimulados("u2"), []);
});

test("responde, finaliza, corrige no servidor e gera relatório; depois não aceita mais respostas", async () => {
  const repo = criarRepoDemo();
  const id = await criarSimulado(repo, "u1", pedido(), POLITICA_PADRAO, ctx());
  await responderTudo(repo, "u1", id, (pos) => pos <= 6);
  const rel = await finalizarSimulado(repo, "u1", id);
  assert.equal(rel.resumo.acertos, 6);
  assert.equal(rel.resumo.erros, 4);
  assert.ok(rel.cadernoDeErros.length === 4 && rel.cadernoDeErros.every((e) => /^[A-E]$/.test(e.letraCorreta)));
  assert.equal(await registrarResposta(repo, "u1", id, { posicao: 1, letra: "C" }), "finalizado");
  const outra = await finalizarSimulado(repo, "u1", id);
  assert.deepEqual(outra, rel, "finalizar de novo é idempotente");
  assert.equal((await repo.listarSimulados("u1"))[0]?.acertos, 6);
});

test("posição inválida, letra inválida e tempo absurdo são tratados", async () => {
  const repo = criarRepoDemo();
  const id = await criarSimulado(repo, "u1", pedido(), POLITICA_PADRAO, ctx());
  assert.equal(await registrarResposta(repo, "u1", id, { posicao: 99, letra: "A" }), "posicao_invalida");
  assert.equal(await registrarResposta(repo, "u1", id, { posicao: 0, letra: "A" }), "posicao_invalida");
  assert.equal(await registrarResposta(repo, "u1", id, { posicao: 1, letra: "Z" as never }), "posicao_invalida");
  assert.equal(await registrarResposta(repo, "u1", id, { posicao: 1, letra: "A", tempoMs: -5 }), "ok");
  const s = await simuladoParaProva(repo, "u1", id);
  assert.equal(s?.respostas[1]?.tempoMs, null, "tempo negativo é descartado");
});

test("panorama acumula simulados e o reforço aponta os itens fracos", async () => {
  const repo = criarRepoDemo();
  assert.equal(await panorama(repo, "u1", CONCURSO_DEMO), null);
  for (let k = 0; k < 2; k++) {
    const id = await criarSimulado(repo, "u1", pedido({ n: 20 }), POLITICA_PADRAO, ctx());
    await responderTudo(repo, "u1", id, () => false);
    await finalizarSimulado(repo, "u1", id);
  }
  const p = await panorama(repo, "u1", CONCURSO_DEMO);
  assert.ok(p && p.resumo.total === 40 && p.resumo.acertos === 0);
  const foco = fracosDoRelatorio(p);
  assert.ok(Object.keys(foco).length > 0 && Object.values(foco).every((v) => v > 0.5 && v <= 1));
  const id3 = await criarSimulado(repo, "u1", pedido({ n: 10, priorizarFracos: true }), POLITICA_PADRAO, ctx());
  assert.ok(await simuladoParaProva(repo, "u1", id3));
});

test("não repete questões já vistas enquanto houver outras", async () => {
  const repo = criarRepoDemo();
  const a = await simuladoParaProva(repo, "u1", await criarSimulado(repo, "u1", pedido({ n: 20 }), POLITICA_PADRAO, ctx()));
  const b = await simuladoParaProva(repo, "u1", await criarSimulado(repo, "u1", pedido({ n: 20 }), POLITICA_PADRAO, ctx()));
  const ida = new Set(a?.itens.map((i) => i.questaoId));
  const repetidas = (b?.itens ?? []).filter((i) => ida.has(i.questaoId)).length;
  assert.ok(repetidas <= 2, `repetiu ${repetidas} de 20 com o banco ainda tendo questões novas`);
});

test("travas de ambiente: DEMO e política de teste são proibidas em produção", () => {
  const guarda = { ...process.env };
  const env = process.env as Record<string, string | undefined>;
  try {
    process.env.DEMO = "1"; process.env.APP_ENV = "producao";
    assert.throws(() => modoDemo(), /proibido/);
    process.env.APP_ENV = "teste";
    assert.throws(() => modoDemo(), /proibido/);
    process.env.APP_ENV = "dev"; env.NODE_ENV = "development";
    assert.equal(modoDemo(), true);
    delete process.env.DEMO;
    process.env.POLITICA_QUESTOES = "desenvolvimento"; process.env.APP_ENV = "producao";
    assert.throws(() => politicaQuestoes(), /proibida em produção/);
    process.env.APP_ENV = "teste";
    assert.equal(politicaQuestoes(), POLITICA_DESENVOLVIMENTO);
    delete process.env.POLITICA_QUESTOES;
    assert.equal(politicaQuestoes(), POLITICA_PADRAO);
    delete process.env.APP_ENV;
    env.NODE_ENV = "production";
    assert.equal(appEnv(), "producao");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in guarda)) delete process.env[k];
    Object.assign(process.env, guarda);
  }
});
