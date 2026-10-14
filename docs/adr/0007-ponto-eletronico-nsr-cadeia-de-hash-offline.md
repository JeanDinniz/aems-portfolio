# 0007 — Ponto eletrônico: NSR persistido, cadeia de hash, horário fiel offline e comprovante

- **Status:** aceito
- **Data:** 2026-09-01
- **Tema:** conformidade / integridade / mobile offline

## Contexto

O módulo de ponto eletrônico (selfie + GPS) já seguia os princípios da Portaria MTP 671/2021 como
**controle interno**: imutabilidade por adição, correção por registro vinculado, exportação AFD/AEJ e
autoatendimento. Um princípio central é que **a marcação nunca é impedida** — geofence e reconhecimento
facial só registram metadados e sinalizam, jamais recusam a batida.

Restavam quatro lacunas técnicas:

1. **NSR efêmero.** O Número Sequencial de Registro era recalculado a cada exportação do AFD; o mesmo
   registro podia receber NSRs diferentes em exportações diferentes. O NSR deve ser único e estável.
2. **Sem prova de integridade.** Nada detectava adulteração direta no banco (um `UPDATE` em SQL contorna a
   guarda de imutabilidade do ORM).
3. **Horário offline impreciso.** Batidas feitas sem rede eram gravadas com o horário do **sync**, não com
   o horário real da marcação.
4. **Sem comprovante** para o trabalhador.

Restrição consciente: **não** se pretende ser um REP-P legal (sem assinatura ICP-Brasil, sem registro no
INPI, sem CNPJ por loja). O enquadramento é "**REP-A**": controle interno com garantias técnicas de
auditoria.

## Decisão

- **No INSERT**, cada batida recebe:
  - um **NSR sequencial global** (contador único por CNPJ), atribuído sob
    `pg_advisory_xact_lock` para serializar a sequência entre transações concorrentes;
  - um **`record_hash = SHA-256(campos legais | prev_hash)`**, formando uma **cadeia de integridade**
    verificável por `verify_chain`.
- **Offline:** o app envia o **horário real do dispositivo**, que vira o horário oficial; o registro é
  sinalizado (`is_offline_record`) e guarda `synced_at` (instante do recebimento). Uma janela de sanidade
  rejeita relógio adiantado além de uma tolerância e sync fora do prazo máximo.
- O **AFD** passa a usar NSR e hash **persistidos** (estáveis entre exportações) e exige a identificação
  do empregador configurada.
- **Comprovante** por registro (JSON + PDF) com o NSR real e um hash curto de conferência, entregue no app
  após a batida — provisório enquanto offline, definitivo após o sync.
- O **CPF entra no hash como snapshot** congelado no INSERT, para que editar o cadastro do funcionário não
  "quebre" a cadeia e simule uma adulteração.
- **Migration com backfill** da cadeia sobre todo o histórico, em ordem cronológica (desliga o trigger de
  imutabilidade só durante o backfill, em `try/finally`, e o religa).

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **REP-P legal completo** (ICP-Brasil + INPI) | Validade fiscal plena | Certificado, assinatura destacada do AFD e registro do programa — custo desproporcional ao uso interno. **Adiada.** |
| **Manter horário offline = horário do sync** | Simples; impossível de forjar pelo cliente | Registra a marcação no momento errado — inaceitável para controle de jornada. **Descartada.** |
| **Assinar cada registro digitalmente** | Mais forte que hash | Exige gestão de chaves/certificado — o mesmo custo que se está adiando. **Descartada.** |
| **Cadeia SHA-256 encadeada (escolhida)** | Integridade verificável sem infraestrutura de chaves | Detecta, mas não impede, adulteração por quem tem acesso total ao banco. |

## Consequências

**Positivas**
- NSR único e estável; a cadeia de hash **detecta adulteração** direta no banco.
- Horário fiel ao momento da marcação, mesmo sem rede.
- O trabalhador recebe um comprovante verificável.

**Negativas / trade-offs assumidos**
- **Backdating é detecção, não prevenção.** O sinalizador de offline e o horário do dispositivo vêm do
  cliente; um cliente online poderia declarar-se offline com horário retroativo dentro da janela. A defesa
  é posterior: offline e `synced_at` aparecem no espelho e no AFD para o RH conferir. Mitigações aplicadas:
  janela máxima reduzida de **30 para 7 dias** e marcação de **"sync tardio"** quando o envio ocorre mais
  de **24 h** após a batida.
- **AFD "compatível em espírito":** NSRs estáveis, porém não contíguos (a jornada efetiva exclui batidas
  anuladas), e campos extras na linha de marcação — um validador fiscal estrito rejeitaria, coerente com o
  enquadramento REP-A.
- **Deploy casado** backend + app e **novo build nativo** (mudou o fluxo de batida).

## Como foi validado

- Implementação guiada por **TDD** (12 tarefas). Os testes pegaram **2 bugs reais** antes do deploy:
  (1) mutar uma relação após o `refresh` marcava a batida como *dirty* e o autoflush da batida seguinte
  disparava o erro de imutabilidade; (2) o SQLite dos testes devolve datas *naive*, divergindo do hash
  gravado — normalização *naive → UTC* no cálculo do hash (e no backfill).
- Revisão de código encontrou e corrigiu um **IDOR** no endpoint de comprovante (a permissão genérica de
  leitura permitia enumerar comprovantes de colegas): passou a ser **somente o dono**, com 404 sem revelar
  existência.
- Validação em homologação antes da produção, incluindo o backfill.
