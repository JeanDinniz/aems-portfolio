# 0004 — Finalização consome metros por tonalidade distinta, não por região do veículo

- **Status:** aceito
- **Data:** 2026-09-23
- **Tema:** integridade de dados / análise de causa-raiz

## Contexto

Em produção, um instalador não conseguia finalizar uma O.S.: o endpoint de finalização devolvia
**HTTP 422 — "Esta bobina já está esgotada e não pode receber consumo"**. O erro só se tornou visível
depois de um ajuste de UI que fazia a mensagem de erro aparecer na tela; antes, o botão "não fazia nada".

A investigação (leitura dos dados reais, autorizada pelo cliente) descartou problema na bobina: ela estava
em uso, com **10,5 m** de saldo, e o serviço consome **3,5 m**.

**Causa-raiz.** Um serviço de película pode ter tonalidades diferentes por região do carro; isso é
guardado num JSON de aplicações (`{tonalidade, região, bobina}` por região). No ramo multi-tonalidade da
finalização, o laço percorria as **regiões** e chamava `consume_roll` **uma vez por região**, cada uma
descontando `metros / K` (K = número de tonalidades distintas). Nesse item havia **4 regiões, todas com a
mesma tonalidade** (K = 1): o código tentava consumir `4 × 3,5 = 14 m` num serviço de 3,5 m. Na 3ª região
a bobina zerava e virava `esgotada`; na 4ª, o consumo era recusado → 422 → **rollback da transação
inteira** (por isso a bobina continuava intacta no banco).

O próprio docstring do trecho já declarava a intenção correta — "cada bobina consome metros/K" —, ou
seja, **um consumo por tonalidade**. Pior: quando a bobina tinha folga, o bug **superconsumia em
silêncio** (gastava N × metros e ninguém percebia).

## Decisão

No laço multi-tonalidade, o consumo passa a rodar **uma única vez por tonalidade distinta**, controlado
por um conjunto por item:

```python
consumed_tonalities: set[str] = set()
for app in item.film_applications:
    ...
    meters = await get_meters_for_service(db, roll.film_type_id, service_id)
    if meters and app_tonality not in consumed_tonalities:
        await consume_roll(db, a.film_roll_id, item.id, float(meters) / k)
        consumed_tonalities.add(app_tonality)
```

A **marcação** da bobina continua sendo gravada em **todas** as regiões do JSON; só o **consumo** é
deduplicado. A marcação de retalho (0 m) já era deduplicada e não mudou.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Dividir os metros pelo nº de regiões** | Elimina o 422 | Contraria a regra declarada (metros/K por tonalidade) e gera consumo fracionado por região sem significado de negócio. **Descartada.** |
| **Deduplicar antes do laço** (1 aplicação por tonalidade) | Laço mais simples | Mudaria a montagem do JSON e perderia a marcação por região. **Descartada.** |
| **Conjunto `consumed_tonalities` no laço (escolhida)** | Correção cirúrgica (~5 linhas), preserva o JSON por região | — |

## Consequências

**Positivas**
- A finalização de O.S. com a mesma tonalidade em várias regiões volta a funcionar, consumindo os metros
  corretos.
- Fecha o superconsumo silencioso para lançamentos futuros.
- Itens com tonalidades realmente distintas (ex.: G20 + G05) ficam inalterados.
- Só backend, sem migration, sem deploy casado.

**Negativas / dívida registrada**
- Consumos passados já gravados com superconsumo **não** são corrigidos por este fix — o reparo de dados
  legado ficou como trabalho separado, a ser feito com backup.
- Uma investigação paralela (bobinas com saldo positivo mas status `esgotada`) foi registrada e adiada a
  pedido do cliente.

## Como foi validado

- **TDD de regressão:** dois testes de integração novos — (1) item com 4 regiões da mesma tonalidade
  consome uma única vez; (2) bobina com saldo para exatamente uma aplicação finaliza sem esgotar
  (reproduz o 422 original e falha sem o fix).
- Reprodução do cenário a partir dos dados reais antes da correção.
