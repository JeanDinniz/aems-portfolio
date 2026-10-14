# 0005 — Consumo de bobina órfão: correção na origem + backfill conservador (1:1 inequívoco)

- **Status:** aceito
- **Data:** 2026-09-17
- **Tema:** integridade de dados / correção de dados históricos

## Contexto

Foram encontrados registros no extrato de consumo de película "órfãos": a bobina foi debitada (os metros
estão no extrato), mas o **vínculo com o item de serviço** que consumiu (`service_order_item_id`) estava
`NULL`.

**Diagnóstico.** Uma versão antiga da edição de O.S. fazia *delete + recreate* dos itens. Como a FK do
consumo para o item é `ON DELETE SET NULL`, apagar o item zerava o vínculo; quando a bobina não mudava na
edição, a lógica de diferença não religava. O código atual já religa corretamente, mas restaram **231**
linhas órfãs como resíduo histórico — e ainda havia **um caso de borda vivo**: remover na edição um
serviço multi-tonalidade continuava gerando órfãos.

Importante: o **estoque sempre esteve correto**, porque o saldo é derivado do extrato. O dano era de
**rastreabilidade** (quem consumiu?) e impedia estorno/retalho futuros por item.

## Decisão

1. **Correção na origem (forward).** Ao remover um serviço multi-tonalidade com consumo, a edição passa a
   apagar as linhas de consumo daquele serviço e **devolver os metros** às bobinas, pela mesma rotina já
   usada em "trocou/removeu bobina" (que recalcula o saldo a partir do extrato — devolução exata por
   construção, sem risco de crédito duplo). Elimina 100% dos novos órfãos.
2. **Backfill histórico conservador**, por script manual (não migration):
   - Religa consumo ↔ item **apenas em casos 1:1 inequívocos**: no agrupamento
     `(bobina, metros esperados)` deve existir **exatamente 1 órfão e 1 candidato**.
   - Ambíguos e sem candidato **ficam como estão** — princípio: *prefere não religar a religar errado*.
   - Candidatos de retorno/cortesia são excluídos (poderiam "roubar" o órfão da O.S. original).
   - **Dry-run é o padrão**; só grava com `--apply`; idempotente; **nunca toca metros/estoque**.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Só a correção na origem** | Menor esforço | Deixa os 231 órfãos sem nenhuma recuperação. **Descartada.** |
| **Backfill agressivo com desempate por data** | Religa muito mais casos | Data é indício, não prova do vínculo — risco de atribuição errada. **Descartada.** |
| **Reescrever a edição para update in-place** | Elimina a causa por completo | Reescrita grande e arriscada; o código atual já religa, bastava fechar o caso de borda. **Descartada.** |
| **Backfill como migration automática** | Roda sozinho no deploy | Heurística rodando sem revisão humana em produção é arriscada. **Descartada** em favor de script com dry-run. |

## Consequências

**Positivas**
- Novos órfãos deixam de ser criados.
- O backfill restaura a rastreabilidade dos casos seguros **sem risco de atribuição errada**.

**Negativas / riscos aceitos**
- Rendimento baixo, por desenho: dos **231** órfãos, só **24** eram religáveis com certeza (**139**
  ambíguos — vários carros na mesma bobina e metragem; **68** sem candidato). O restante segue órfão, mas
  o estoque está correto e os indicadores já tratam esses casos pela bobina.
- O `--apply` é uma escrita manual em produção, fora do pipeline de deploy — exige execução consciente
  após validação em homologação.

## Como foi validado

- **TDD:** teste de integração que finaliza um serviço multi-tonalidade com 2 bobinas, remove o serviço na
  edição e verifica que não sobra órfão e que os metros foram devolvidos; confirmado que **falha sem o
  fix**.
- Dry-run do script sobre uma cópia dos dados (231 → 24 religáveis, 139 ambíguos, 68 sem candidato).
- Revisão de código: após o ajuste de excluir retorno/cortesia, 2 casos migraram para "sem candidato" —
  a direção segura.
- Suíte das áreas afetadas verde (112 testes).
- Tratado um detalhe sutil de dados: itens legados gravaram JSON literal `null` (diferente de SQL `NULL`),
  então o filtro desse campo foi feito em Python, não em SQL.
