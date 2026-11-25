# @concurso/web

Next.js 15 (App Router) + Clerk + Supabase, consumindo o motor `@concurso/engine`. Tudo que toca dados roda **no servidor**: o navegador nunca fala com o banco.

## Rodar em demonstração (sem Clerk, sem banco)
```bash
npm install                      # na raiz do repositório (workspaces)
cd apps/web
DEMO=1 APP_ENV=dev npm run dev   # http://localhost:3000
```
Dados em memória: **edital real** do concurso PC-MG 2024 + **questões fictícias**. O app recusa `DEMO=1` fora de desenvolvimento.

## Variáveis de ambiente
Veja `.env.example`. Valores nunca vão para o Git.

| Variável | Onde | Observação |
|---|---|---|
| `APP_ENV` | todos | `dev`, `teste` ou `producao` |
| `POLITICA_QUESTOES=desenvolvimento` | só `teste` | libera questões ainda `pendente_juridico` para um tester num deploy privado; proibida em produção (o app falha ao subir) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | navegador e servidor | públicas por desenho |
| `SUPABASE_SECRET_KEY` | **só servidor** | chave `sb_secret_...` rotacionável; usada para criar simulado, corrigir e ler o banco de questões |
| `ADMIN_USER_IDS` | servidor | IDs do Clerk (`user_...`, separados por vírgula) com acesso a `/admin`. Vazio = ninguém; quem não é admin recebe 404. Mudar o valor exige novo deploy |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | | integração Clerk + Supabase (third-party auth) já feita pelo autor |

## Como os dados fluem
- **Leitura e respostas do aluno:** cliente Supabase com o token de sessão do Clerk; o RLS do banco aplica `usuario_id = sub`. O aluno só grava `letra`, `tempo` e `chute`.
- **Criar simulado, corrigir, relatório, banco de questões, gabarito:** cliente com a chave secreta, só no servidor (`import "server-only"`).
- **Gabarito** nunca chega ao navegador: a tela recebe `paraCliente(simulado)` (lista branca). O resultado, com a resposta certa e o comentário, só existe depois de finalizar.
- Política de questões: `politicaQuestoes()` (produção = só liberadas juridicamente, ativas e revisadas).

## Estrutura
```
src/lib/servico.ts      casos de uso (criar simulado, responder, finalizar, panorama); usa o motor
src/lib/repo/           memoria.ts (demo/testes) e supabase.ts (produção), mesmo contrato (tipos.ts)
src/app/(app)/          painel, simulado/[id], simulado/[id]/resultado, actions.ts (server actions)
src/components/         Prova, RelatorioView, FormNovoSimulado, Aviso, Barra, ...
test/servico.test.ts    11 testes do serviço (isolamento entre usuários, travas de ambiente, política)
e2e/fluxo-demo.cjs      teste de navegador (Playwright) do fluxo completo em modo demonstração
```

## Verificação
```bash
npm run typecheck && npm test            # tipos e testes do serviço
DEMO=1 APP_ENV=dev npm run dev & node e2e/fluxo-demo.cjs ./capturas   # navegador
node e2e/reportes-demo.cjs ./capturas <pasta-com-axe-core>              # reportes do aluno + /admin (claro e escuro, axe)
```
Auditoria de acessibilidade (axe, WCAG A/AA + boas práticas) nas 6 telas × 2 temas: 0 violações de contraste ou rótulo.

## Reportes e administração
O aluno reporta problema na questão durante a prova. `/admin` (só `ADMIN_USER_IDS`) mostra a fila de reportes, o banco de questões (com gabarito, somente leitura) e os resolvidos. Cada reporte é **justificado** (questão mantida) ou leva à **retirada** da questão (`inativa`, sai dos novos simulados; o histórico dos alunos não muda). A função `resolver_reporte` roda só com a chave de servidor.

## O que NÃO foi testado de ponta a ponta
O caminho de produção (`repo/supabase.ts` com token real do Clerk e `SUPABASE_SECRET_KEY`) compila com os tipos reais do esquema, mas só foi exercitado contra o projeto real pelo tester. O mesmo contrato é coberto pelo repositório em memória nos testes.

## Design
Ver "Direção visual" no `CLAUDE.md` da raiz.
