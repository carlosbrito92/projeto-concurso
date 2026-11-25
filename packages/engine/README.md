# @concurso/engine

Motor **puro** (sem DOM, sem I/O, sem relógio) de seleção de questões, simulado, correção e relatório. Roda igual no servidor e no cliente. Escrito em TypeScript; Node ≥ 22.18 executa os `.ts` direto.

```bash
cd packages/engine
npm install
npm run typecheck
npm test            # 38 testes; o de integração com questões reais é pulado se os JSONs não existirem
```

## Fluxo

```ts
import { selecionar, pesosDoEdital, montarSimulado, paraCliente, corrigir, gerarRelatorio, gerarRelatorioAcumulado } from "@concurso/engine";

// 1) servidor: escolhe questões (política padrão = só liberadas, ativas, revisadas e completas)
const { questoes, avisos } = selecionar(pool, { n: 30, seed, pesos: pesosDoEdital(edital), vistas, foco });

// 2) servidor: congela o simulado (snapshot + ordem das alternativas)
const simulado = montarSimulado(questoes, { id, seed, criadoEm: new Date().toISOString() });

// 3) navegador recebe SÓ isto (sem gabarito, comentário nem assunto)
const paraTela = paraCliente(simulado);

// 4) servidor corrige e gera o relatório depois que o aluno envia
const rel = gerarRelatorio(simulado, respostas, { edital });
const historico = gerarRelatorioAcumulado(sessoesAnteriores, { edital }); // evidência por assunto vem daqui
```

## Regras que o motor impõe (CLAUDE.md)
- **Política de elegibilidade** (`POLITICA_PADRAO`): `direitos` liberada ou não aplicável, `status` ativa, `revisao` revisada, sem pendência de imagem/tabela/formatação. `POLITICA_DESENVOLVIMENTO` é só para teste.
- **Anulada ou sem gabarito nunca é selecionada**, em nenhuma política.
- **Gabarito nunca vai ao navegador**: `paraCliente` usa lista branca de campos.
- **Avisos de vigência** (`avisosDaQuestao`) saem do motor; a tela só os exibe.
- **Determinismo**: mesma semente e mesmo conjunto, mesmo resultado, independente da ordem do `pool`.

## Decisões
- Evidência por assunto exige `minimoParaAvaliar` (3) questões; abaixo disso o nível é `indefinido`. Se nenhum assunto tem evidência, o foco sobe para a **disciplina**; se nem a disciplina tem, o relatório diz por quê.
- Taxa suavizada em direção à média do aluno (`suavizacao` = 2 pseudo-questões) para não decretar "crítico" com 1 ou 2 questões.
- Limiares de domínio (75% / 50%) são configuráveis e **não vêm do edital**: são ponto de partida.
- Pontuação padrão 1/0/0 (FGV e FUMARC). Bancas com desconto por erro usam outra `Pontuacao`.
