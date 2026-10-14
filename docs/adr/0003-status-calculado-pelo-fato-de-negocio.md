# 0003 — Status do agendamento calculado pelo fato de negócio (`completion_time`), não por um rótulo

- **Status:** aceito
- **Data:** 2026-09-09
- **Tema:** domínio / consistência entre módulos

## Contexto

O ciclo de vida da Ordem de Serviço (O.S.) é enxuto: `waiting → in_progress → completed`, com dois
desfechos alternativos — `wrong` ("Lançado Errado", reversível) e `cancelled` (terminal, *soft delete*).

O módulo de **Agendamento** não grava "Atrasado" ou "Finalizado": calcula um `display_status` em tempo
real a partir do agendamento e da O.S. vinculada. Uma regra anterior fazia uma O.S. em `wrong` deixar de
contar como finalizada — o carro "voltava" para a fila e, por data, aparecia como **Atrasado**.

Só que a **Conferência** usa "Errada" como etapa de **reconciliação contra o sistema da concessionária**:
se uma O.S. finalizada não é encontrada lá (sumida, divergente), ela é marcada como `wrong`. Resultado:
O.S. **já executadas** ressurgiam como "Atrasado" no Agendamento. Um diagnóstico somente-leitura em
produção encontrou **123** transições `completed → wrong`, das quais **18** apareciam indevidamente como
atrasadas.

Regra de negócio confirmada com o cliente: quem define a cobrança é o **agendamento** — cobra-se o
serviço que foi feito. Divergência com a concessionária não muda o que a loja executou. Portanto,
"Errada" é assunto **exclusivo da Conferência**.

## Decisão

- O Agendamento **ignora o status `wrong`** e reflete o estado real usando
  **`ServiceOrder.completion_time`** como sinal de "foi finalizada".
- `completion_time` é gravado no Finalizar e **nunca é limpo** (marcar `wrong` só troca o status) — é um
  sinal confiável e imune ao rótulo.
- Regra: O.S. com `completion_time` (ou status terminal) → **Finalizado**; O.S. vinculada e não
  finalizada → **Em execução**, independente da data.
- O mesmo critério foi replicado nos três lugares que derivam status (função Python, filtros de query e o
  SQL agregado do resumo por loja), e o código específico da regra antiga foi **removido**.

**Desdobramento (decisão seguinte, mesma linha):** a trava do comando *Finalizar* foi alinhada ao mesmo
critério — aceita O.S. `wrong` **nunca finalizada** (sem `completion_time`) e continua bloqueando a `wrong`
**já finalizada**, cujo caminho correto é o "desfazer errada". A primeira versão desse ajuste aceitava
`wrong` incondicionalmente; a revisão de código apontou que isso permitiria re-finalizar O.S. já
concluídas via chamada direta à API (reescrevendo instaladores e podendo reconsumir bobina), e o gate por
`completion_time` foi adicionado.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Selo "Reprovada na Conferência" no agendamento** | Mais transparente | Continuaria rebaixando o agendamento. Não atende à regra. **Descartada.** |
| **Bloquear a transição `completed → wrong`** | Elimina o sintoma | Tira da Conferência sua ferramenta legítima de reconciliação. **Descartada.** |
| **Restaurar em massa as O.S. marcadas** | Rápido | As marcações não eram engano; não corrige a causa. **Descartada.** |
| **Backfill de dados** | — | Desnecessário: o status é calculado, corrige-se sozinho no deploy. **Descartada.** |
| **Derivar pelo `completion_time` (escolhida)** | Um sinal de fato de negócio, imutável; correção retroativa sem migration | Exige manter Python e SQL agregado espelhados. |

## Consequências

**Positivas**
- "Errada" passa a ter efeito só na Conferência.
- As 18 O.S. afetadas voltaram a "Finalizado" sozinhas no deploy — **sem migration e sem backfill**,
  porque o status é derivado.
- Mudança só no backend; web e app herdam (são consumidores puros do `display_status`).

**Negativas / riscos**
- O SQL agregado do resumo por loja usa recursos específicos do PostgreSQL e não roda no SQLite da suíte
  de testes; sua lógica foi validada por espelhamento com a função testada, revisão e homologação.

## Como foi validado

- Testes unitários da função de status com casos âncora: "`wrong` + `completion_time` → finalizado",
  "`wrong` sem `completion_time` → em execução", "ativa com `completion_time` → finalizado",
  "duplicada + `completion_time` → duplicidade".
- Testes de integração do agendamento reescritos para a nova semântica.
- Revisão de código focada em consistência Python ↔ SQL e em *null-safety* dos agrupamentos.
