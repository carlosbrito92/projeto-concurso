# CLAUDE.md — Concurso Engine

Plataforma **comercial** em que o concurseiro gera provas de estudo, responde, e recebe um relatório estatístico de acertos e erros com indicação de onde focar. Acesso de qualquer dispositivo (web responsiva).

> Princípio de projeto: **o ativo principal não é a questão, é o conhecimento estruturado e citável.** A questão é uma representação temporária dele. Toda questão aponta para uma fonte verificável.

## Estado atual

Piloto: **Polícia Civil de Minas Gerais × FGV**, Edital nº 04/2024, cargo **Investigador de Polícia I** (slug `pc-mg-fgv-2024`). Prova de 70 questões objetivas A–E, 1 ponto cada, mínimo de 35 acertos (edital item 4.1.5 a 4.1.7).

Feito no piloto:
- `01-md/edital-04-2024.md`: edital completo em Markdown, com `<!-- p.N -->` por página (N = página do PDF).
- `02-json/edital.json`: estrutura do Anexo I (12 disciplinas, 339 itens, pesos pelo nº de questões), validada por `schemas/edital.schema.json`.

- `conteudo/concursos/<slug>/`: edital → `edital.json` para os 4 concursos: `pc-mg-fgv-2024`, `pc-mg-fumarc-2014`, `pc-ma-fgv-2012`, `pc-am-fgv-2021` (só o cargo de Investigador). Formatos variam: hierárquico (MG), numeração corrida (MA) e parágrafos sem numeração (AM; itens `sintetica`). O parser é guiado pelo bloco `anexo` do `meta.json` do concurso.
- `conteudo/provas/`: quatro provas reais extraídas para `questoes.json` (schema v3), todas com gabarito conferido contra o PDF **e contagem por disciplina conferida contra o edital** (por disciplina e por grupo):
  - `pc-mg-fgv-2024-investigador-t1`: 70 questões, gabarito definitivo, Q59 anulada.
  - `pc-am-fgv-2021-investigador-t1`: 80 questões objetivas (+ 1 discursiva fora do banco), definitivo, Q24 anulada.
  - `pc-ma-fgv-2012-investigador-t1`: 70 questões, **gabarito PRELIMINAR**, prova de 2012.
  - `pc-mg-fumarc-2014-investigador-ca`: 60 questões, 4 alternativas, banca **FUMARC** (não entra no perfil da FGV), "gabarito oficial" não confirmado como definitivo, prova de 2014.
  O texto das questões fica **fora do Git** (regra abaixo); o repo versiona só código, `meta.json`, `relatorio.md` e os editais.

Pendente: páginas com possível tabela (29, 30, 53, 55, 56, 57) ainda precisam de revisão manual no MD. `packages/engine` (TypeScript, 38 testes): seleção por peso do edital e rodízio de assuntos, simulado com snapshot, correção, relatório (disciplina, assunto com agregação hierárquica, foco, caderno de erros, acumulado entre simulados) e avisos de vigência. Ver `packages/engine/README.md`.
- `supabase/migrations`: esquema do banco (conteúdo + dados do aluno) com RLS; `supabase/tests/test_rls.py` (44 testes de segurança, validados por mutação); `pipeline/seed_banco.py` (carga idempotente com trava de host). Ver `supabase/README.md`. **Aplicado** num projeto Supabase real (`concurso-engine`, `sa-east-1`, plano gratuito; 5 migrações; advisors sem alerta de risco; esquema idêntico ao do banco de teste, conferido por `supabase/tests/fingerprint.sql`). **Conteúdo carregado** (4 concursos, 280 questões como `rascunho`/`pendente_juridico`, via `seed_banco.py --apply --rest`); o identificador do projeto não fica no repositório (variáveis de ambiente).
- `apps/web` (Next.js 15 + Clerk + Supabase, modo demonstração local): painel, simulado (teclado, chute, tempo, salvamento a cada resposta), correção no servidor, resultado e panorama acumulado, avisos de vigência, landing com relatório de exemplo, Termos e Privacidade (minutas). 27 testes + 3 testes de navegador (`fluxo-demo`, `reportes-demo`, `registro-demo`) + axe sem violações. Ver `apps/web/README.md`. Nome do produto provisório: `concurso/engine`.
- Perfis de banca gerados (`conteudo/bancas/fgv.json`, `fumarc.json`). Próximas fontes: texto das leis citadas nos Anexos I (ver `ctresb/leis`, a avaliar), mais provas por banca e classificação de cada questão em um item do edital.

Comandos (a partir da raiz):
```bash
# prova de 2 colunas + gabarito (conteudo/provas/<slug>/, com meta.json: disciplinas, títulos, cabeçalho/página do gabarito)
# opções: --inicio "texto da 1ª pág. de questões" --topo N --rodape N (faixa de cabeçalho/rodapé a descartar)
python3 -I pipeline/prova_para_md.py conteudo/provas/<slug>/00-origem/<prova>.pdf conteudo/provas/<slug>/01-md/<prova>.md
python3 -I pipeline/prova_para_json.py conteudo/provas/<slug>
# edital
python3 -I pipeline/pdf_para_md.py conteudo/concursos/<slug>/00-origem/<edital>.pdf conteudo/concursos/<slug>/01-md/<edital>.md
python3 -I pipeline/edital_para_json.py conteudo/concursos/<slug>
```

## Pendências do autor (fora do alcance do Claude)

- [ ] **CI no GitHub Actions** — a configurar pelo autor, em casa, com acesso às permissões do repositório (o ambiente do Claude não consegue criar workflows). Escopo previsto: `npm ci && npm run typecheck && npm test` em `packages/engine`; `pip install -r pipeline/requirements.txt` e rodar os scripts do pipeline em modo de validação sobre fixtures sintéticas (as provas reais não estão no Git); lint/validação das migrações SQL. Até lá, os testes só rodam localmente.

- [ ] **Termos de uso e Política de privacidade**: as páginas existem como minuta com campos `[ENTRE COLCHETES]` (controlador, CNPJ, contato, foro, planos, provedores). Preencher e passar por advogado antes de qualquer lançamento.
- [ ] **Nome do produto** (hoje provisório, em `components/Marca.tsx`).
- [ ] **Decisão sobre as questões do tester**: com a política padrão nenhuma questão real é servida (todas `pendente_juridico`). Para um tester num deploy privado: `APP_ENV=teste` + `POLITICA_QUESTOES=desenvolvimento` e carregar o conteúdo com `seed_banco.py`. Em produção só com questões liberadas.
- [ ] **Webhook do Clerk `user.deleted` → `apagar_dados_usuario`** (LGPD): a função existe no banco; falta a rota que a chama.
- [x] **Deploy privado na Vercel** (projeto `concurso-engine`, raiz `apps/web`, `APP_ENV=teste` + `POLITICA_QUESTOES=desenvolvimento`, `noindex`). Conteúdo carregado no Supabase com `seed_banco.py --apply --rest` (280 questões como `rascunho`/`pendente_juridico`). **Falta:** restringir o cadastro no Clerk (`sign_up_mode: restricted`) quando o email do tester for conhecido; decidir sobre a proteção "Vercel Authentication" (hoje ligada, o tester precisaria de conta Vercel); revogar/rotacionar `SUPABASE_SECRET_KEY` e `CLERK_SECRET_KEY` ao fim dos testes. Deploys só disparam com mudança dentro de `apps/web` (commit vazio é cancelado).
- [ ] CI deve incluir também `apps/web`: `npm run typecheck`, `npm test` e `npm run build`.

## Reportes e administração

- O aluno reporta problema numa questão durante a prova (`reporte_questao`; a questão é derivada do simulado dele, nunca enviada pelo cliente). Limite de 20 por dia e um reporte aberto por (aluno, questão, motivo).
- `/admin` (só IDs em `ADMIN_USER_IDS`; 404 para os demais; guarda em `exigirAdmin()` em toda página e ação): fila de reportes, banco de questões (leitura, com gabarito) e resolvidos. O admin **não edita o texto** da questão: ou mantém com justificativa, ou **retira** (`status = 'inativa'`, fecha os outros reportes abertos dela). Correção de texto segue pelo pipeline/Git.
- Resolver é a função `resolver_reporte` (só `service_role`). O aluno vê que o reporte foi tratado, mas não a justificativa.
- ID de questão nunca é apagado nem renumerado: o histórico dos simulados é snapshot.
- **Registro de alterações** (`registro_alteracao`, página `/novidades`): somente leitura para o aluno; só o servidor inclui; imutável (gatilho barra UPDATE/DELETE/TRUNCATE). O aluno lê só `id, criado_em, tipo, titulo, resumo, concurso_slug` (nunca autor nem questão). O admin publica em `/admin/registro` (`novidade`, `conteudo`, `correcao`); `questao_retirada` é automático (gerado por `resolver_reporte`, sem a justificativa interna). Texto de aluno: nunca enunciado, gabarito nem justificativa.
- Próximo (combinado): `conhecimento` (`KNOW###`) com fonte e vigência para explicar o gabarito.

## Stack

| Camada | Escolha | Observação |
|---|---|---|
| Web | Next.js (App Router) + TypeScript | `apps/web` |
| Auth | **Clerk** | IDs de usuário são **texto** (`user_...`), nunca `uuid` |
| Banco | Supabase (Postgres + RLS) | `supabase/migrations` |
| Deploy | Vercel | |
| Motor | TypeScript puro, sem DOM | `packages/engine`; roda no servidor e no cliente |
| Pipeline de conteúdo | Python ≥ 3.10 + `jsonschema` | `pipeline/`, roda na máquina do autor/CI |

**Clerk + Supabase:** usar a integração de *third-party auth* (JWT do Clerk validado pelo Supabase). As políticas RLS comparam `auth.jwt()->>'sub'` com a coluna `usuario_id text`. Não usar a service role no cliente, nunca.

## Fluxo de conteúdo (o coração do projeto)

```
PDF (edital / prova / lei)  ──►  .md  ──►  .json (schema)  ──►  Postgres
   00-origem/                  01-md/        02-json/            seed
```

Cada concurso vive em `conteudo/concursos/<slug>/` (ex.: `pc-<uf>-fgv-<ano>`), copiando `_modelo/`.

1. **PDF → MD.** Limpeza fiel, sem resumir. Preservar numeração de itens do edital, tabelas e páginas (`<!-- p.12 -->`). Registrar o que não foi legível; nunca preencher o que não leu.
2. **MD → JSON.** Extrair (a) a **estrutura do edital** (disciplina → assunto → item) e (b) **conhecimentos atômicos** e **questões**, sempre contra `schemas/*.schema.json`.
3. **JSON → banco.** Script de `seed` idempotente. O JSON no Git é a fonte da verdade auditável; o banco é cópia servida.

Regras do pipeline:
- **PDFs não vão para o Git** (`00-origem/` é ignorado). Fica registrado só o `sha256`, o nome e a página em `manifest.json`.
- Todo JSON tem `schemaVersion`. Mudou o schema, sobe a versão e migra.
- Cada script de build **valida e sai com código ≠ 0** se algo estiver inconsistente (ids únicos, referências existentes, gabarito coerente com as afirmações).
- Rastreabilidade ponta a ponta: `questão → conhecimento → fonte (arquivo, página, trecho literal)`.
- **Nunca inventar** lei, artigo, súmula, prazo ou data. Sem fonte, o campo é `null` e o item fica `status: "rascunho"`.
- Trecho literal de fonte: curto (≤ 25 palavras). Lei e jurisprudência são fonte preferencial (texto público).

## Classificação por assunto (item do edital)

Cada questão aponta para um item do edital do seu concurso (`classificacao.editalItemId`, ex.: `D09:5.5.2`; `editalItemTrilha` traz a cadeia até a raiz). Fonte da verdade: `conteudo/provas/<slug>/02-json/classificacao.json` (só ids, versionado) e `classificacao-manual.json` (decisões por revisão assistida, só ids, versionado, tem prioridade). Comando: `python3 -I pipeline/classificar_questoes.py conteudo/provas/<slug>` e depois `prova_para_json.py`.
- **Estados:** `sugerida` (IA), `indeterminada` (assunto `null`, candidatos registrados) e `confirmada` (**só humano define; o script nunca sobrescreve**). Nenhuma classificação feita por IA conta como confirmada.
- **Métodos:** `tfidf-lexical-v1` (TF-IDF por disciplina) e `manual-ia-v1` (leitura da questão contra os itens do edital). A pendência `confirmar_assunto` some só com a confirmação humana.
- **Precisão medida por amostragem manual** (não por gabarito oficial, que não existe): o léxico acerta cerca de 65–70% das que consigo julgar; erra mais em Português, em casos narrativos e em itens genéricos. Por isso as de Português, Raciocínio e as indeterminadas foram revisadas à mão, mas isso também é sugestão.
- **Granularidade:** depende do edital. Amazonas (itens por frase) e Maranhão (Informática com 3 itens) classificam grosso; MG-2024 e MG-2014 (hierárquicos) classificam fino.
- O `revisao-classificacao.csv` (ignorado pelo Git, contém texto) existe só para a revisão humana.

## Dois tipos de questão

| `origem.tipo` | O que é | Cuidado |
|---|---|---|
| `prova_real` | Questão de prova anterior (FGV etc.) | Direito autoral. Nasce com `direitos.status = "pendente_juridico"` e **não é publicada** até virar `liberada`. |
| `autoral_ia` | Gerada por IA a partir de conhecimentos do edital | Nasce `revisao.status = "automatico"`. Só vai ao aluno após validação (abaixo). |

Questão de IA só é publicada se: tem `fundamentacao` com fonte real e vigente; o gabarito foi conferido contra a fonte; um humano revisou (`revisao.status = "revisado"`). **A IA não pode ser a única verificadora do gabarito.**

**Repositório e direito autoral:** enquanto o repositório for **público**, nenhum texto de questão de prova real (`01-md/` e `questoes.json` de `conteudo/provas/`) vai para o Git (está no `.gitignore`). Só passa a ser versionado com o repo privado, e continua sem ir ao aluno até `direitos.status = "liberada"`.

Questão anulada ou com gabarito alterado: `anulada: true`, fora da geração de provas e fora das estatísticas.

## Vigência da legislação (requisito de produto)

Lei muda; prova antiga pode cobrar texto já alterado ou revogado. O **aluno deve ver isso na tela**, não só o pipeline. Regras:
- Toda questão carrega a data da prova e, quando houver, a pendência `verificar_vigencia` (prova antiga) ou `gabarito_preliminar` (gabarito não confirmado como definitivo).
- A interface mostra, junto à questão e no relatório, um aviso claro: "Esta questão é de uma prova de <ano>; a legislação pode ter mudado. Confira a fonte vigente." Nunca esconder o aviso nem dar a resposta como certa sem ele.
- O aviso só some quando um humano revisa a questão contra a fonte vigente (`revisao.status = "revisado"` e `fundamentacao.vigenteEm` preenchido).
- Questões geradas por IA citam a norma e a data de vigência conferida (`fundamentacao.vigenteEm`).

## Direção visual (interface)

Baseada no índice de design do autor (arquivo `design-skill.md`, fora do repositório). Sem identidade de marca definida, vale o **default ASCII**: tipografia monoespaçada, caracteres como elemento visual (`[####----]`, `( )`/`(x)`, `[!]`, `##`), **sem** ícones de biblioteca, emojis, gradientes, sombras, glassmorphism, cantos arredondados, faixa lateral colorida, "3 cards em fileira", depoimentos ou planos inventados.
- **Paleta 1** (Alabaster `#E5E4E2`, Onyx `#0A0A0A`, Blue Slate `#536878`) em tokens semânticos (`--fundo`, `--texto`, `--primario`...). Erro = Inferno `#AA0003` (no escuro `#FF7B72`), atenção = Gold `#FFD700` com texto Onyx. Escuro **reconstruído**, não invertido. Todo par de texto conferido em WCAG AA; nunca depender só de cor (usar texto e símbolo).
- **Tipografia:** 2 famílias (mono do sistema na interface, serifa do sistema no enunciado), escala modular 1.25 sobre 16px, medida 65ch. Espaçamento em múltiplos de 4. Grade de 4 colunas (celular) e 12 (painel/relatório).
- **Movimento:** só com propósito (feedback de estado), 100 a 250ms, `cubic-bezier(0.2,0.8,0.2,1)` na entrada, respeitar `prefers-reduced-motion`. Sem hover de escala/elevação: hover é vídeo inverso.
- **Estados:** todo controle tem padrão, hover, ativo, foco, desabilitado e carregando. Carregamento de página = esqueleto ASCII; botão = spinner ASCII. Erro de formulário inline, erro transitório em toast, nada de "Algo deu errado" sem dizer o quê, por quê e o que fazer. Estado vazio sempre com ação.
- Um botão primário por tela. Landing com demonstração real do produto (relatório gerado pelo motor), nunca mock inventado.
- Verificação obrigatória em mudança de interface: `e2e/fluxo-demo.cjs` e auditoria axe (0 violações).

## Estilo da banca

Cada banca tem um **perfil medido** em `conteudo/bancas/<banca>.json`, gerado por `python3 -I pipeline/perfil_banca.py` a partir das provas reais extraídas (só estatísticas; nenhum trecho de questão). Bancas **não se misturam** (FGV e FUMARC têm arquivos próprios). Não descreva o estilo de uma banca de memória: leia o perfil, e regenere-o quando entrar prova nova.

Resumo do que foi medido (amostras pequenas; `amostra.confianca` diz o quanto confiar):
- **FGV** (220 questões, 3 provas policiais, A–E): enunciado mediano ~335 caracteres (p10 87, p90 729); ~47% terminam sem pontuação (completar frase) e ~39% em ponto; ~9% usam assertivas numeradas "I, II, III" com alternativas de combinação; ~8% pedem a incorreta/EXCETO; ~30% citam norma/artigo; gabarito sem posição dominante.
- **FUMARC** (60 questões, 1 prova, A–D): enunciado mediano ~117 caracteres, bem mais curto; ~38% pedem incorreta/EXCETO (contra ~8% da FGV); ~57% terminam em dois pontos. Amostra de uma prova só: confiança baixa.

A geração por IA deve imitar o **estilo medido** da banca-alvo, jamais copiar enunciados reais, e **sortear a posição do gabarito de forma uniforme** (não replicar os desvios da amostra).

## Modelo de dados (resumo)

`Carreira → Concurso → Disciplina → Assunto → Conhecimento → Questão`

- **Conhecimento:** regra atômica citável (artigo, súmula, conceito). Tem `vigenteEm` e status (`vigente`, `superado`, `revogado`).
- **Simulado:** snapshot imutável (copia as questões, ordem e alternativas embaralhadas). Editar a questão depois não altera o histórico do aluno.
- **Resposta:** `usuario_id`, `simulado_id`, `questao_id`, `resposta`, `acertou`, `tempo_ms`, `marcou_chute`, `em`.
- **Relatório:** acerto por disciplina/assunto/banca, tempo, evolução, caderno de erros, revisão espaçada, prioridades ponderadas pelo peso do assunto no edital.

## Regras de código

- **Correção no servidor.** O gabarito nunca vai ao navegador antes de a resposta ser enviada (`paraCliente` do motor usa lista branca; não montar payload à mão).
- Motor (`packages/engine`) sem DOM e sem I/O. Seleção determinística por semente; testes obrigatórios.
- `questao`, `questao_gabarito`, `prova` e `simulado_gabarito` **não têm política para o navegador**: o aluno só enxerga questões dentro dos próprios simulados. Não criar política de leitura nelas.
- RLS ligada em toda tabela com dado de usuário. Toda migração nova é revisada com os advisors do Supabase.
- Segredos só em variáveis de ambiente (Vercel/Supabase/Clerk). Nunca em Git.
- Dados pessoais de aluno: coletar o mínimo (LGPD). Estatísticas só do próprio usuário.
- IDs de conteúdo são estáveis: **não renumerar**; só acrescentar.
- Ao mexer em schema, atualizar validador, `seed`, migração e testes na mesma mudança.

## Idioma

Código, nomes de campo e commits: o que o autor já usa (campos em português no JSON, identificadores de código em inglês quando for lib/infra). Textos de interface e conteúdo: **português do Brasil**.

## Origem

Arquitetura inspirada em um projeto anterior do autor, de outro contexto. **Nenhum conteúdo, dado ou arquivo de outros projetos ou empregadores entra neste repositório.**
