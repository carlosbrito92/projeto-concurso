/**
 * Teste de navegador do formato Certo/Errado com nota por desconto (concurso do CRC-PR, itens fictícios na demonstração).
 *   DEMO=1 APP_ENV=dev npx next dev -p 3100
 *   node e2e/certo-errado-demo.cjs <pasta-de-capturas> <pasta-com-axe-core>
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
    const marcado = async () => (await p.locator('input[type=radio]:checked').count()) ? await p.locator('input[type=radio]:checked').getAttribute('value') : null;

    await p.goto(U + '/painel?c=crc-pr-quadrix-2022', { waitUntil: 'networkidle' });
    confere(/Analista Contábil/.test(await p.locator('#sec-concurso').innerText()) && /Conselhos profissionais/i.test(await p.locator('#sec-concurso').locator('xpath=..').innerText()), `${esquema} painel do CRC mostra a área e o cargo`);
    await p.selectOption('#n', '5');
    await p.getByRole('button', { name: 'Começar simulado' }).click();
    await p.waitForURL(/\/simulado\/[^/]+$/);
    await p.waitForSelector('.enunciado');

    confere(/cada erro desconta 1 ponto/.test(await p.locator('.aviso').first().innerText()), `${esquema} aviso do desconto por erro na prova`);
    const rotulos = (await p.locator('.alt .texto-alt').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    confere(rotulos.length === 2 && rotulos[0].startsWith('C) Certo') && rotulos[1].startsWith('E) Errado'), `${esquema} duas opções: ${rotulos.join(' | ')}`);
    confere((await p.getByRole('button', { name: 'Deixar em branco' }).isDisabled()), `${esquema} "Deixar em branco" desabilitado sem resposta`);

    await p.keyboard.press('a');
    confere((await marcado()) === null, `${esquema} tecla A não faz nada em Certo/Errado`);
    await p.keyboard.press('c');
    confere((await marcado()) === 'A', `${esquema} tecla C marca Certo`);
    await p.keyboard.press('e');
    confere((await marcado()) === 'B', `${esquema} tecla E marca Errado`);
    await axe('prova Certo/Errado');
    await p.screenshot({ path: `${S}/shots/ce-${esquema}-1-prova.png`, fullPage: true });
    await p.getByRole('button', { name: 'Deixar em branco' }).click();
    confere((await marcado()) === null, `${esquema} "Deixar em branco" limpa a resposta`);
    confere(await p.getByRole('button', { name: 'Deixar em branco' }).isDisabled(), `${esquema} e volta a desabilitar`);

    // reload: a resposta em branco persiste como em branco
    await p.reload({ waitUntil: 'networkidle' });
    confere((await marcado()) === null, `${esquema} depois de recarregar continua em branco`);

    // 1: Certo, 2: Errado, 3: Certo, 4 e 5 em branco
    await p.keyboard.press('c'); await p.keyboard.press('ArrowRight');
    await p.keyboard.press('e'); await p.keyboard.press('ArrowRight');
    await p.keyboard.press('c'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
    await p.getByRole('button', { name: 'Finalizar simulado' }).click();
    confere(/2 questão\(ões\) em branco\. Em branco não pontua nem desconta/.test(await p.locator('[role=alertdialog]').innerText()), `${esquema} confirmação explica que em branco não desconta`);
    await p.getByRole('button', { name: 'Confirmar e ver resultado' }).click();
    await p.waitForURL(/resultado$/);

    const resumo = (await p.locator('#rel-resumo').locator('xpath=..').innerText()).replace(/\s+/g, ' ');
    confere(/Nota/i.test(resumo) && /Erros \(desconto de 1 cada\)/i.test(resumo) && /Em branco/i.test(resumo), `${esquema} resultado mostra Nota, Erros com desconto e Em branco`);
    confere(!/Aproveitamento/i.test(resumo), `${esquema} resultado não mostra "Aproveitamento" quando há desconto`);
    confere(/Nota: -?\d+ de 5 pontos \(\d acertos?, \d erros?, 2 em branco\)/.test(resumo), `${esquema} insight com a nota: ${(resumo.match(/Nota: [^.]*\./) || [''])[0]}`);
    confere(/cada erro desconta 1 ponto/.test(resumo), `${esquema} explica quando vale arriscar`);
    await axe('resultado com desconto');
    await p.screenshot({ path: `${S}/shots/ce-${esquema}-2-resultado.png`, fullPage: true });

    const pm = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, colorScheme: esquema })).newPage();
    await pm.goto(U + '/painel?c=crc-pr-quadrix-2022', { waitUntil: 'networkidle' });
    await pm.selectOption('#n', '5');
    await pm.getByRole('button', { name: 'Começar simulado' }).click();
    await pm.waitForURL(/\/simulado\/[^/]+$/);
    await pm.waitForSelector('.enunciado');
    confere(await pm.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${esquema} prova Certo/Errado sem rolagem horizontal (celular)`);
    await pm.screenshot({ path: `${S}/shots/ce-${esquema}-3-celular.png`, fullPage: true });
    await ctx.close();
  }
  confere(erros.length === 0, `sem erros de console (${erros.length})`);
  for (const e of erros.slice(0, 5)) console.log('   ', e);
  await b.close();
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
