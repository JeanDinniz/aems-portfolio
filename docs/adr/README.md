# Architecture Decision Records (ADRs)

Esta pasta reúne uma **seleção de 10 ADRs** dentre os **46** registrados no projeto real. Eles foram
reescritos para leitura externa (formato MADR enxuto, dados do cliente anonimizados), sem alterar a
substância técnica: os números citados vêm dos registros originais.

Um ADR registra **uma decisão e o porquê dela**: o problema de negócio, as alternativas consideradas
com seus prós e contras, as consequências aceitas e, quando aplicável, como a decisão foi validada.
No projeto, todo trabalho que envolve uma escolha de design ou de negócio gera um ADR (ver
[0010](0010-manual-versionado-e-adr-como-processo.md)).

## Índice

| Nº | Título | Tema | Resumo |
|----|--------|------|--------|
| [0001](0001-perfis-de-acesso-granulares.md) | Owner + Perfis de Acesso granulares | Segurança / arquitetura | Troca de papéis hierárquicos fixos por permissões submódulo × ação, com enforcement centralizado no backend e frontend apenas fail-closed. |
| [0002](0002-estoque-como-extrato-e-retalho-como-marcacao.md) | Estoque como extrato e retalho como marcação | Modelagem de dados | Saldo de bobina derivado de um ledger; reaproveitar sobra não debita de novo, com alerta por instalador em vez de trava. |
| [0003](0003-status-calculado-pelo-fato-de-negocio.md) | Status calculado pelo fato de negócio | Domínio / consistência | O status do agendamento passa a derivar de `completion_time` (imutável), corrigindo 18 casos sem migration nem backfill. |
| [0004](0004-consumo-por-tonalidade-distinta-na-finalizacao.md) | Consumo por tonalidade distinta na finalização | Integridade / causa-raiz | Análise de um HTTP 422 em produção revelou superconsumo silencioso por região; correção cirúrgica guiada por teste de regressão. |
| [0005](0005-consumo-orfao-gap-fix-e-backfill-conservador.md) | Consumo órfão: correção na origem + backfill conservador | Integridade / dados históricos | Fecha a causa dos órfãos e religa só casos 1:1 inequívocos (24 de 231), com dry-run por padrão: "prefere não religar a religar errado". |
| [0006](0006-edicao-de-pedido-com-rastro-de-auditoria.md) | Edição de pedido com rastro de auditoria | Auditoria / estoque | Edição completa com trava em bobina já consumida (409) e trilha de → para gravada só quando algo de fato muda. |
| [0007](0007-ponto-eletronico-nsr-cadeia-de-hash-offline.md) | Ponto eletrônico: NSR, cadeia de hash e offline | Conformidade / integridade / mobile | NSR estável, cadeia SHA-256 verificável, horário fiel offline e comprovante, com trade-offs de backdating explicitados. |
| [0008](0008-upload-de-fotos-mobile-perfil-moderado.md) | Upload de fotos no app: perfil moderado | Mobile / rede instável | Paralelismo limitado, compressão serial, foto menor e timeout menor, com reversão documentada por constante. |
| [0009](0009-prefetch-por-intencao-e-cache-de-catalogos.md) | Prefetch por intenção e cache de catálogos | Performance | Diagnóstico refutou a hipótese de N+1; a correção foi prefetch por intenção, reuso da lista e cache Redis com chave por escopo de loja. |
| [0010](0010-manual-versionado-e-adr-como-processo.md) | Manual versionado e ADR como processo | Processo de engenharia | Guia canônico único para humanos e IAs, ADRs, gate completo e changelog append-only. |

## Critério de seleção

Foram priorizados ADRs com **trade-offs reais** e impacto em integridade de dados, segurança e
conformidade, performance, operação offline e processo. Decisões puramente visuais ficaram de fora.

## Formato

Cada ADR segue: **Status**, **Data**, **Contexto**, **Decisão**, **Alternativas consideradas**,
**Consequências** (positivas e negativas) e, quando há testes envolvidos, **Como foi validado**.
