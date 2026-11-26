/**
 * Teste de navegador do seletor de concursos categorizado (modo demonstração: 4 editais reais + 5 entradas rotuladas de outras áreas).
 *   DEMO=1 APP_ENV=dev npx next dev -p 3100
 *   node e2e/seletor-demo.cjs <pasta-de-capturas> <pasta-com-axe-core>
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
    const status = async () => (await p.locator('.catalogo [role=status]').innerText()).trim();

    // sem escolha prévia: o catálogo abre
    await p.goto(U + '/painel', { waitUntil: 'networkidle' });
    confere(await p.locator('details.catalogo').evaluate(e => e.open), `${esquema} sem escolha prévia o catálogo já vem aberto`);
    const titulos = (await p.locator('.catalogo h3').allInnerTexts()).map(t => t.replace(/\s*\(\d+\)\s*$/, '').trim());
    confere(JSON.stringify(titulos) === JSON.stringify(['Segurança pública', 'Tribunais e Justiça', 'Fiscal e tributária', 'Administração pública', 'Tecnologia da informação', 'Conselhos profissionais', 'Saúde']), `${esquema} áreas agrupadas na ordem da taxonomia: ${titulos.join(' | ')}`);
    confere((await p.locator('.catalogo-item').count()) === 10, `${esquema} 10 concursos listados`);
    confere(/10 concursos em 7 áreas/.test(await status()), `${esquema} resumo: ${await status()}`);
    confere((await p.getByRole('search', { name: 'Filtrar concursos' }).count()) === 1, `${esquema} acima de 8 concursos aparecem busca e filtros`);
    confere(/\(x\)/.test(await p.locator('.catalogo-item[aria-current=page]').innerText()), `${esquema} o selecionado vem marcado (x)`);
    await axe('painel com catálogo aberto');
    await p.screenshot({ path: `${S}/shots/sel-${esquema}-1-aberto.png`, fullPage: true });

    // busca e filtros
    await p.getByLabel('Buscar (órgão, cargo, banca, ano)').fill('policia fgv');
    confere((await p.locator('.catalogo-item').count()) === 3 && /3 de 10/.test(await status()), `${esquema} busca "policia fgv" (sem acento) acha 3: ${await status()}`);
    await p.getByLabel('Buscar (órgão, cargo, banca, ano)').fill('');
    await p.getByLabel('Área', { exact: true }).selectOption('justica');
    confere((await p.locator('.catalogo-item').count()) === 1, `${esquema} filtro de área = Tribunais e Justiça`);
    await p.getByLabel('Área', { exact: true }).selectOption('');
    await p.getByLabel('Banca', { exact: true }).selectOption('FUMARC');
    confere((await p.locator('.catalogo-item').count()) === 1, `${esquema} filtro de banca = FUMARC`);
    await p.getByLabel('UF', { exact: true }).selectOption('SP');
    confere((await p.getByText('Nenhum concurso com esses filtros').count()) === 1, `${esquema} combinação sem resultado mostra estado vazio com ação`);
    await axe('catálogo sem resultado');
    await p.getByRole('button', { name: 'Limpar filtros' }).click();
    confere((await p.locator('.catalogo-item').count()) === 10, `${esquema} limpar filtros volta aos 10`);

    await p.getByLabel('UF', { exact: true }).selectOption('PR');
    confere((await p.locator('.catalogo-item').count()) === 1 && /Analista Contábil/.test(await p.locator('.catalogo-item').first().innerText()), `${esquema} filtro de UF = PR acha o concurso do CRC`);
    await p.getByLabel('UF', { exact: true }).selectOption('');
    await p.getByLabel('Banca', { exact: true }).selectOption('Quadrix');
    confere((await p.locator('.catalogo-item').count()) === 1, `${esquema} filtro de banca = Quadrix`);
    await p.getByLabel('Banca', { exact: true }).selectOption('');

    // trocar para outra área e criar simulado lá
    await p.getByRole('link', { name: /Analista Judiciário \(demonstração\)/ }).click();
    await p.waitForURL(/c=demo-tj-analista/);
    confere((await p.locator('#sec-concurso').innerText()) === 'Analista Judiciário (demonstração)', `${esquema} painel passa para o concurso escolhido`);
    confere(!(await p.locator('details.catalogo').evaluate(e => e.open)), `${esquema} depois de escolher o catálogo recolhe`);
    await p.locator('details.catalogo > summary').click();
    confere(/\(x\)/.test(await p.locator('.catalogo-item[aria-current=page]').innerText()) && /Analista Judiciário/.test(await p.locator('.catalogo-item[aria-current=page]').innerText()), `${esquema} o novo selecionado é o marcado`);
    await p.locator('details.catalogo > summary').click();
    await p.selectOption('#n', '5');
    await p.getByRole('button', { name: 'Começar simulado' }).click();
    await p.waitForURL(/\/simulado\/[^/]+$/);
    await p.waitForSelector('.enunciado');
    confere(true, `${esquema} simulado criado no concurso de outra área`);

    // celular
    const pm = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, colorScheme: esquema })).newPage();
    await pm.goto(U + '/painel', { waitUntil: 'networkidle' });
    confere(await pm.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${esquema} painel com catálogo aberto sem rolagem horizontal (celular)`);
    await pm.screenshot({ path: `${S}/shots/sel-${esquema}-2-celular.png`, fullPage: true });
    await ctx.close();
  }
  confere(erros.length === 0, `sem erros de console (${erros.length})`);
  for (const e of erros.slice(0, 5)) console.log('   ', e);
  await b.close();
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
