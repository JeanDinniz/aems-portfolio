# 0002 — Estoque de película como extrato (ledger) e retalho como marcação, sem débito

- **Status:** aceito
- **Data:** 2026-08-24 (UI consolidada em 2026-08-25)
- **Tema:** modelagem de dados / integridade de estoque

## Contexto

A película é comprada em bobinas físicas. Cada bobina tem metragem total, e o saldo é **derivado de um
extrato** de movimentações (`FilmConsumption`): `saldo = total − Σ(consumos)`. O extrato tem tipos
(`consumo`, `estorno`, `ajuste` com motivo obrigatório, `reconciliacao`) e é a fonte de verdade — o
saldo nunca é editado diretamente.

Problema real relatado pela operação: uma bobina de 14 m atendeu 8 carros, zerou e foi marcada
automaticamente como `esgotada`, mas o instalador avisou que ainda havia cerca de 6 m no rolo. Causa:
parte dos serviços é feita com **retalho** — sobra de um corte anterior, cujos metros **já tinham sido
debitados** da bobina na época. Ao reaproveitar a sobra, o sistema debitava de novo os metros de tabela
da bobina em uso.

O único remédio disponível era o ajuste manual de estoque, que corrige o número mas **apaga o porquê**
(rastreabilidade).

## Decisão

- **Retalho é uma marcação, não um estoque de sobras.** Um serviço marcado como retalho
  (`used_scrap = true`) **não debita** metros de nenhuma bobina.
- Modelagem aditiva (uma migration): coluna booleana no item de serviço; itens com várias tonalidades
  guardam a mesma chave dentro do JSON de aplicações por região.
- Regras de negócio decididas com o cliente:
  - **Tudo ou nada por serviço** (sem retalho parcial no mesmo serviço).
  - **Quem finaliza marca** (o instalador), no web e no app.
  - **Sem backfill**: bobinas já ajustadas manualmente ficam como estão.
  - O freio não é uma trava, e sim **detecção**: alerta aos gestores quando um instalador ultrapassa
    **40%** de serviços com retalho no mês (com mínimo de **10** serviços), disparado **só na transição**
    do limiar (sem spam), mais visibilidade na Conferência.
- Evolução de UI: o retalho deixou de ser um checkbox + seletor de "bobina de origem" e virou **uma
  opção dentro do próprio seletor de bobina** ("Retalho (sobra)").
- O backend continua aceitando o payload antigo (sem o campo) → **sem deploy casado** com o app.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Estoque de retalhos peça a peça** | Modelo "completo" da sobra física | Custo alto; a operação não controla sobra peça a peça. **Descartada.** |
| **Só ajuste manual de estoque** | Já existia | Apaga a rastreabilidade do porquê do ajuste. **Foi o que motivou a decisão.** |
| **Checkbox + bobina de origem obrigatória** (1ª versão) | Liga o carro ao rolo de onde veio a sobra | Complicava a UI e forçava escolher um rolo frequentemente já esgotado. **Simplificada.** |
| **Marcação no seletor de bobina (escolhida)** | UI simples; saldo deixa de ser debitado indevidamente | Retalho é declaração do instalador e pode ser mal usado. |

## Consequências

**Positivas**
- O saldo da bobina para de ser debitado em dobro; a sobra reaproveitada não "some" do estoque.
- Como o saldo é derivado do extrato, a correção não exige mexer em saldos existentes.
- Compatível com versões antigas do app em campo.

**Negativas / riscos**
- Retalho é uma declaração — por isso o alerta por instalador e a visibilidade na Conferência.
- Sem bobina de origem, o histórico não liga mais o carro ao rolo de onde veio a sobra (troca consciente
  de rastreabilidade por simplicidade de uso).
- Causa-raiz paralela registrada fora do escopo: revisar a metragem de tabela de certos combos de
  serviço, caso a sobra seja sistemática.

## Como foi validado

- Suíte de integração dedicada ao retalho (finalização com retalho sem débito de saldo, alerta por
  instalador).
- Testes de componente da tela de finalização no app mobile, reescritos para a opção de retalho no seletor.
