# Banco (Supabase / Postgres)

Três migrações, aplicadas em ordem (os números de versão são os que o Supabase gravou no projeto, para a CLI não tentar reaplicá-las):

| Arquivo | O que cria |
|---|---|
| `20261125145251_conteudo.sql` | `concurso`, `disciplina`, `grupo_edital`, `item_edital`, `banca_perfil`, `prova`, `questao`, `questao_gabarito` |
| `20261125145326_aluno.sql` | `usuario_concurso`, `simulado`, `simulado_item`, `simulado_gabarito`, `resposta`, `relatorio_simulado`, `reporte_questao`, `usuario_atual()`, `apagar_dados_usuario()` |

## Modelo de acesso (o que o navegador pode e não pode)

| Tabela | Aluno (`authenticated`) | Servidor (`service_role`) |
|---|---|---|
| `concurso`, `disciplina`, `item_edital`, `grupo_edital`, `banca_perfil` | lê | tudo |
| `questao`, `questao_gabarito`, `prova` | **nada** (banco de questões é ativo comercial e o gabarito é segredo) | tudo |
| `simulado`, `simulado_item`, `relatorio_simulado` | lê **só os seus** | cria, corrige, gera relatório |
| `simulado_gabarito` | **nada** | tudo |
| `resposta` | lê as suas; grava só `letra`, `tempo_ms`, `chute`, e só em simulado `em_andamento` | grava `acertou`/`pontos` ao finalizar |
| `reporte_questao`, `usuario_concurso` | lê/grava os seus | tudo |

- O aluno só vê uma questão dentro de um simulado dele (`simulado_item.payload` = saída de `paraCliente` do motor, sem gabarito).
- Invariante no banco: questão `ativa` exige `direitos_status` ≠ `pendente_juridico`, `revisao_status = revisado` e gabarito (se não anulada).
- LGPD: `apagar_dados_usuario(text)` apaga tudo do usuário; só o servidor executa (chamar ao receber `user.deleted` do Clerk).
- Nunca usar a chave `service_role` no navegador.

## Clerk + Supabase (third-party auth)
1. Clerk → *Integrations / Supabase* → ativar. Isso inclui `"role": "authenticated"` no token de sessão.
2. Supabase → *Authentication → Sign In / Up → Third-Party Auth → Add provider → Clerk* (domínio do Clerk).
3. O `sub` do JWT é o id do Clerk (`user_...`, **texto**). As políticas comparam `usuario_id` com `usuario_atual()` (= `auth.jwt()->>'sub'`).
4. O cliente do navegador usa a chave `anon`/publicável mais o token do Clerk; o servidor (rotas do Next.js) usa a `service_role` só no servidor.

## Carregar o conteúdo
```bash
pip install -r pipeline/requirements-banco.txt
python3 -I pipeline/seed_banco.py                                   # simulação: valida e mostra contagens
DATABASE_URL=postgresql://... python3 -I pipeline/seed_banco.py --apply --confirmar-host <host>
```
Idempotente (`ON CONFLICT DO UPDATE`), em transação única, com trava de host. Só funciona onde os `questoes.json` existem (não vão ao Git).

## Testar a segurança
```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres python3 supabase/tests/test_rls.py
```
Cria e apaga um banco temporário (**nunca aponte para um banco real**), reproduz os papéis e o `auth.jwt()` do Supabase, aplica as migrações e tenta ataques de aluno (ler gabarito, ler dado de outro, escrever `acertou`, responder após finalizar, forjar reporte, chamar a função de LGPD...). 27 testes. Foi validado também por **mutação**: sabotar a migração (abrir `questao_gabarito`, tirar a checagem de status, liberar `acertou`, abrir a função de LGPD, remover o filtro de usuário) faz o teste falhar.

## Projeto Supabase
Criado em `sa-east-1` (São Paulo), plano gratuito, nome `concurso-engine`. As três migrações foram aplicadas e os *advisors* rodados:
- **Segurança:** 4 avisos informativos "RLS sem política" em `prova`, `questao`, `questao_gabarito` e `simulado_gabarito` — **intencionais** (tabelas só do servidor). Nada além disso.
- **Performance:** 6 chaves estrangeiras sem índice, corrigidas na 3ª migração. "Índices não usados" é efeito do banco vazio.
- **Conferência de deriva:** `supabase/tests/fingerprint.sql` gera uma impressão digital do esquema (colunas, restrições, índices, políticas, funções, gatilhos, RLS, privilégios). Rode no banco local (onde os 27 testes passam) e no projeto: os nove hashes devem ser iguais. Estavam.
- Variáveis de ambiente do app (nunca commitar): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (só servidor; pegar no painel), e as do Clerk. O identificador do projeto não fica no repositório.

## Pendente
- Integrar o Clerk (third-party auth) no painel do Supabase e do Clerk (passos acima).
- Carregar o conteúdo (`seed_banco.py`): **decisão do autor**, pois leva texto de prova real (`pendente_juridico`) para um banco hospedado.
- CI para rodar estes testes (ver "Pendências do autor" no `CLAUDE.md`).
- CI para rodar estes testes (ver "Pendências do autor" no `CLAUDE.md`).
