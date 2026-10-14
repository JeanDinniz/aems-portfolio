# 0010 — Manual de engenharia versionado no repositório, guia único para humanos e IAs, e ADR como processo

- **Status:** aceito
- **Data:** 2026-08-25
- **Tema:** processo de engenharia / governança do conhecimento

## Contexto

O projeto é mantido por um único desenvolvedor, com uso intenso de assistentes de IA para implementação,
revisão e testes. O conhecimento do projeto estava concentrado em um arquivo de instruções de uma IA
específica e em memória local, enquanto a pasta `docs/` **estava fora do versionamento** — o manual não
tinha histórico compartilhado.

Além disso, cada ferramenta de IA tem (ou teria) seu próprio arquivo de instruções, com risco real de
divergirem: a "regra verdadeira" passaria a depender de qual ferramenta foi usada.

## Decisão

1. **`docs/` passa a ser versionado** junto com o código.
2. **Um único guia canônico na raiz** (`AGENTS.md`) serve a qualquer IA e a qualquer pessoa; ele aponta
   para um manual numerado: visão geral, arquitetura, regras de negócio, PRD, convenções, fluxo de
   trabalho, **ADRs** e **changelog cumulativo** (append-only).
3. Os arquivos específicos de cada ferramenta viram **ponteiros curtos** para o guia — nunca uma fonte
   paralela de verdade.
4. O fluxo de trabalho fica explícito e é o mesmo para humanos e IAs:
   - ler o guia e as decisões vigentes antes de tocar no código (**não reabrir decisão fechada sem
     motivo**);
   - apresentar **entendimento + plano** antes de executar;
   - **toda escolha de design ou negócio vira um ADR**, com as opções em linguagem clara (prós/contras) e
     a decisão do dono do produto registrada;
   - rodar o **gate completo** antes de declarar "pronto" (backend: lint, formatação, checagem de tipos,
     testes e verificação anti-drift da documentação técnica gerada; web: lint, type-check, build;
     mobile: type-check, lint, testes);
   - registrar uma entrada datada no changelog e entregar um **roteiro de teste** para validação em
     homologação.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Manter docs fora do git + instruções de uma única IA como fonte** | Zero esforço imediato | Conhecimento preso a uma ferramenta e sem histórico. **Rejeitada.** |
| **Um arquivo de instruções completo por ferramenta** | Cada IA "lê o seu" | Duplicação garantida e divergência com o tempo. **Rejeitada.** |
| **Guia único + ponteiros + ADRs (escolhida)** | Uma fonte de verdade com histórico | Exige disciplina para manter atualizado. |

## Consequências

**Positivas**
- O manual tem histórico no git e é o mesmo para qualquer IA e para pessoas — inclusive para um futuro
  colaborador.
- O **porquê** das decisões fica preservado em ADRs; meses depois ninguém precisa "arqueologar" conversas.
- O processo (plano → ADR → gate → changelog → roteiro de teste) transforma "achei que funcionou" em algo
  verificável.
- O projeto acumulou dezenas de ADRs nesse formato, e um job de CI garante que o índice técnico gerado a
  partir do código (endpoints, tabelas, feature flags) não divirja da documentação.

**Negativas / riscos**
- Exige disciplina para manter os ponteiros curtos e o manual atualizado a cada mudança relevante.
- Cuidado com encoding (UTF-8 sem BOM) ao editar documentos acentuados em Windows.

## Como foi validado

- O próprio histórico do repositório: cada mudança relevante posterior tem ADR e entrada no changelog.
- Job de CI "Web Docs Drift" falha se a documentação técnica derivada do código ficar desatualizada.
