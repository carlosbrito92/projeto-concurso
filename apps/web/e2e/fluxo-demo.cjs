/**
 * Teste de navegador do fluxo completo, em modo demonstração (sem Clerk, sem banco).
 *
 *   DEMO=1 APP_ENV=dev npx next dev -p 3100        # em um terminal
 *   npm i -D playwright && node e2e/fluxo-demo.cjs <pasta-para-capturas>
 *
 * Percorre: landing, painel, novo simulado, prova (teclado, chute, recarregar), finalização, resultado e painel com histórico,
 * em desktop, celular e modo escuro; confere ausência de rolagem horizontal e de erros de console.
 */
const { chromium } = require('playwright');
const S = process.argv[2] || '.';
require('fs').mkdirSync(S + '/shots', { recursive: true });
(async () => {
  const b = await chromium.launch();
  const erros = [];
  const novo = async (opts) => { const c = await b.newContext(opts); const p = await c.newPage(); p.on('console', m => { if (m.type()==='error') erros.push(m.text().slice(0,160)); }); p.on('pageerror', e => erros.push('pageerror: '+e.message.slice(0,160))); return p; };
  const semRolagemH = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

  // --- landing (desktop claro, mobile, desktop escuro)
  let p = await novo({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await p.goto('http://localhost:3100/', { waitUntil: 'networkidle' });
  console.log('landing h1:', await p.locator('h1').first().innerText());
  await p.screenshot({ path: S+'/shots/01-landing-desktop.png', fullPage: true });
  const pm = await novo({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  await pm.goto('http://localhost:3100/', { waitUntil: 'networkidle' });
  console.log('landing mobile sem rolagem horizontal:', await semRolagemH(pm));
  await pm.screenshot({ path: S+'/shots/02-landing-mobile.png', fullPage: true });
  const pd = await novo({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await pd.goto('http://localhost:3100/', { waitUntil: 'networkidle' });
  await pd.screenshot({ path: S+'/shots/03-landing-escuro.png', fullPage: false });

  // --- painel vazio -> novo simulado
  await p.goto('http://localhost:3100/painel', { waitUntil: 'networkidle' });
  await p.screenshot({ path: S+'/shots/04-painel-vazio.png', fullPage: true });
  console.log('checkbox fracos desabilitado sem histórico:', await p.locator('#fracos').isDisabled());
  await p.selectOption('#n', '5');
  await p.getByRole('button', { name: 'Começar simulado' }).click();
  await p.waitForURL(/\/simulado\/[^/]+$/, { timeout: 20000 });
  console.log('simulado url:', p.url().replace(/.*simulado\//,'/simulado/'));

  // --- prova: teclado, chute, navegação
  await p.waitForSelector('.enunciado');
  await p.screenshot({ path: S+'/shots/05-prova-desktop.png', fullPage: true });
  await p.keyboard.press('b');
  console.log('B marcada:', await p.locator('input[type=radio]:checked').getAttribute('value'));
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('c');
  await p.check('#chute');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('a');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('d');
  await p.waitForTimeout(500);
  const resp = await p.locator('.q-botao[data-respondida=true]').count();
  console.log('respondidas no navegador:', resp, '(esperado 4 de 5)');
  await p.screenshot({ path: S+'/shots/06-prova-meio.png', fullPage: true });
  // recarregar: respostas salvas
  await p.reload({ waitUntil: 'networkidle' });
  console.log('após recarregar, respondidas:', await p.locator('.q-botao[data-respondida=true]').count());
  const pmo = await novo({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  await pmo.goto(p.url(), { waitUntil: 'networkidle' });
  console.log('prova mobile sem rolagem horizontal:', await semRolagemH(pmo));
  await pmo.screenshot({ path: S+'/shots/07-prova-mobile.png', fullPage: true });

  // --- finalizar
  await p.getByRole('button', { name: 'Finalizar simulado' }).click();
  await p.screenshot({ path: S+'/shots/08-confirmar.png', fullPage: false });
  await p.getByRole('button', { name: 'Confirmar e ver resultado' }).click();
  await p.waitForURL(/resultado$/, { timeout: 20000 });
  await p.waitForSelector('#rel-resumo');
  console.log('resultado h2:', await p.locator('#rel-resumo').innerText());
  await p.screenshot({ path: S+'/shots/09-resultado-desktop.png', fullPage: true });
  const pr = await novo({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  await pr.goto(p.url(), { waitUntil: 'networkidle' });
  console.log('resultado mobile sem rolagem horizontal:', await semRolagemH(pr));
  await pr.screenshot({ path: S+'/shots/10-resultado-mobile.png', fullPage: true });

  // --- painel com histórico
  await p.goto('http://localhost:3100/painel', { waitUntil: 'networkidle' });
  console.log('fracos habilitado após histórico:', !(await p.locator('#fracos').isDisabled()));
  await p.screenshot({ path: S+'/shots/11-painel-historico.png', fullPage: true });
  console.log('erros de console:', erros.length ? erros : 'nenhum');
  await b.close();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
