/**
 * Teste de navegador: aluno reporta problema na prova; administrador resolve; auditoria axe das telas novas.
 * Modo demonstração (sem Clerk/banco). Em outro terminal:  DEMO=1 APP_ENV=dev npx next dev -p 3100
 *   node e2e/reportes-demo.cjs <pasta-de-capturas> <pasta-com-axe-core>   (axe: <pasta>/node_modules/axe-core/axe.min.js)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2] || '.';
const AXE = fs.readFileSync((process.argv[3] || '.') + '/node_modules/axe-core/axe.min.js', 'utf8');
fs.mkdirSync(S + '/shots', { recursive: true });
const U = 'http://localhost:3100';
let falhas = 0;
const confere = (ok, msg) => { console.log((ok ? 'ok   ' : 'FALHA') + ' ' + msg); if (!ok) falhas++; };

(async () => {
  const b = await chromium.launch();
  const erros = [];
  for (const esquema of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: esquema });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') erros.push(m.text().slice(0, 160)); });
    p.on('pageerror', e => erros.push('pageerror: ' + e.message.slice(0, 160)));
    const axe = async (nome) => {
      await p.addScriptTag({ content: AXE });
      const r = await p.evaluate(async () => await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
      confere(r.violations.length === 0, `${esquema} axe ${nome}: ${r.violations.length} violações`);
      for (const v of r.violations) console.log(`     [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0].target.join(' ').slice(0, 80)} | ${(v.nodes[0].failureSummary || '').replace(/\s+/g, ' ').slice(0, 140)}`);
    };

    // --- aluno
    await p.goto(U + '/painel', { waitUntil: 'networkidle' });
    await p.selectOption('#n', '5');
    await p.getByRole('button', { name: 'Começar simulado' }).click();
    await p.waitForURL(/\/simulado\/[^/]+$/);
    await p.waitForSelector('.enunciado');
    await p.locator('details.reporte > summary').click();
    await p.selectOption('select[id$="-motivo"]', 'enunciado');
    await p.locator('textarea').click();
    await p.keyboard.type('abcde a alternativa B esta ambigua');
    confere((await p.locator('input[type=radio]:checked').count()) === 0, `${esquema} digitar A–E no campo de texto não marca alternativas`);
    await axe('prova com reporte aberto');
    await p.screenshot({ path: `${S}/shots/rep-${esquema}-1-aluno.png`, fullPage: true });
    await p.getByRole('button', { name: 'Enviar reporte' }).click();
    await p.getByText('Reporte enviado').waitFor();
    confere(true, `${esquema} aluno recebe confirmação`);
    await p.getByRole('button', { name: 'Enviar reporte' }).click();
    await p.getByText('Você já reportou esse problema').waitFor();
    confere(true, `${esquema} reporte repetido não duplica`);
    // outra questão: o formulário reinicia
    await p.keyboard.press('Escape');
    await p.locator('.q-botao').nth(1).click();
    confere(!(await p.locator('details.reporte').evaluate(e => e.open)), `${esquema} ao trocar de questão o reporte volta fechado`);

    // --- admin
    await p.goto(U + '/admin', { waitUntil: 'networkidle' });
    confere((await p.locator('h1').first().innerText()) === 'Administração', `${esquema} /admin abre`);
    confere(/Reportes abertos \(1\)/.test(await p.locator('nav[aria-label="Administração"]').innerText()), `${esquema} contador de abertos = 1`);
    confere((await p.getByText('abcde a alternativa B esta ambigua').count()) === 1, `${esquema} texto do aluno aparece na fila`);
    await axe('admin fila');
    await p.screenshot({ path: `${S}/shots/rep-${esquema}-2-admin.png`, fullPage: true });
    // sem justificativa: o navegador barra (required)
    await p.getByRole('button', { name: 'Registrar resolução' }).click();
    confere(/\/admin$/.test(p.url()) && (await p.getByText('abcde a alternativa B esta ambigua').count()) === 1, `${esquema} sem justificativa não resolve`);
    const qid = (await p.locator('article h2').first().innerText()).trim().split(' ')[0]; // o repositório de demonstração é compartilhado entre rodadas
    await p.getByLabel('Retirar a questão').check();
    await p.getByLabel('Justificativa (obrigatória)').fill('Enunciado ambíguo: retirada até revisão.');
    await p.getByRole('button', { name: 'Registrar resolução' }).click();
    await p.getByText('Nenhum reporte aberto').waitFor();
    confere(true, `${esquema} retirar fecha o reporte e esvazia a fila`);
    await axe('admin fila vazia');

    await p.goto(U + '/admin/resolvidos', { waitUntil: 'networkidle' });
    const linha = p.locator('tr', { has: p.getByRole('link', { name: qid, exact: true }) });
    confere((await linha.count()) === 1 && /questão retirada/.test(await linha.innerText()) && /Enunciado ambíguo: retirada até revisão\./.test(await linha.innerText()), `${esquema} resolvidos mostra decisão e justificativa (${qid})`);
    await axe('admin resolvidos');

    await p.goto(U + `/admin/questoes?status=inativa&busca=${qid}`, { waitUntil: 'networkidle' });
    confere(/1 questão/.test(await p.locator('[role=status]').first().innerText()), `${esquema} banco: questão retirada aparece como inativa`);
    await p.locator('details > summary').first().click();
    confere((await p.getByText('[gabarito]').count()) === 1, `${esquema} admin vê o gabarito no banco`);
    await axe('admin banco (filtrado)');
    await p.screenshot({ path: `${S}/shots/rep-${esquema}-3-banco.png`, fullPage: true });
    await p.goto(U + '/admin/questoes', { waitUntil: 'networkidle' });
    await axe('admin banco (tudo)');
    confere(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${esquema} banco sem rolagem horizontal (desktop)`);

    // celular
    const pm = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, colorScheme: esquema })).newPage();
    for (const rota of ['/admin', '/admin/questoes', '/admin/resolvidos']) {
      await pm.goto(U + rota, { waitUntil: 'networkidle' });
      confere(await pm.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${esquema} ${rota} sem rolagem horizontal (celular)`);
    }
    await ctx.close();
  }
  confere(erros.length === 0, `sem erros de console (${erros.length})`);
  for (const e of erros.slice(0, 5)) console.log('   ', e);
  await b.close();
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
