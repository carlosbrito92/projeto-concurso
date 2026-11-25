/**
 * Teste de navegador do registro de alterações: aluno lê (/novidades), admin publica (/admin/registro), axe e celular.
 * Modo demonstração. Servidor limpo:  DEMO=1 APP_ENV=dev npx next dev -p 3100
 *   node e2e/registro-demo.cjs <pasta-de-capturas> <pasta-com-axe-core>
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
  let primeira = true;
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
    const titulo = `Entrada de teste ${esquema}`;

    await p.goto(U + '/novidades', { waitUntil: 'networkidle' });
    if (primeira) {
      confere((await p.getByText('Nada registrado ainda').count()) === 1, `${esquema} aluno vê estado vazio com ação`);
      confere((await p.getByRole('link', { name: 'Voltar ao painel' }).count()) === 1, `${esquema} estado vazio tem ação`);
      await axe('novidades vazio');
    }
    confere((await p.locator('nav[aria-label="Principal"]').getByRole('link', { name: 'Novidades' }).count()) === 1, `${esquema} link Novidades no cabeçalho`);
    confere((await p.getByRole('button', { name: 'Publicar entrada' }).count()) === 0, `${esquema} aluno não vê formulário de publicação`);

    await p.goto(U + '/admin/registro', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Publicar entrada' }).click(); // título vazio: o navegador barra
    confere(!(await p.getByText('Entrada publicada').count()), `${esquema} título vazio não publica`);
    await p.getByLabel('Tipo').selectOption('conteudo');
    await p.getByLabel('Título', { exact: true }).fill(titulo);
    await p.getByLabel('Resumo (opcional)').fill('Resumo da entrada.');
    await axe('admin registro (formulário preenchido)');
    await p.getByRole('button', { name: 'Publicar entrada' }).click();
    await p.getByText('Entrada publicada').waitFor();
    confere((await p.locator('li', { hasText: titulo }).count()) === 1, `${esquema} entrada aparece na lista do admin`);
    confere((await p.getByLabel('Título', { exact: true }).inputValue()) === '', `${esquema} formulário limpa após publicar`);
    await p.screenshot({ path: `${S}/shots/reg-${esquema}-1-admin.png`, fullPage: true });

    await p.goto(U + '/novidades', { waitUntil: 'networkidle' });
    const li = p.locator('li', { hasText: titulo });
    confere((await li.count()) === 1 && /\[Conteúdo\]/.test(await li.innerText()) && /Resumo da entrada\./.test(await li.innerText()), `${esquema} aluno vê a entrada com tipo e resumo`);
    await axe('novidades com entradas');
    await p.screenshot({ path: `${S}/shots/reg-${esquema}-2-novidades.png`, fullPage: true });

    const pm = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, colorScheme: esquema })).newPage();
    for (const rota of ['/novidades', '/admin/registro']) {
      await pm.goto(U + rota, { waitUntil: 'networkidle' });
      confere(await pm.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${esquema} ${rota} sem rolagem horizontal (celular)`);
    }
    await pm.screenshot({ path: `${S}/shots/reg-${esquema}-3-celular.png`, fullPage: true });
    primeira = false;
    await ctx.close();
  }
  confere(erros.length === 0, `sem erros de console (${erros.length})`);
  for (const e of erros.slice(0, 5)) console.log('   ', e);
  await b.close();
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
