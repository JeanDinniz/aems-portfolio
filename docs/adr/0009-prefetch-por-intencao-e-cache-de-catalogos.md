# 0009 — Editor de O.S. instantâneo: prefetch por intenção, reuso da lista e cache de catálogos

- **Status:** aceito
- **Data:** 2026-09-24
- **Tema:** performance / diagnóstico antes de otimizar

## Contexto

Ao abrir o editor de O.S. (Conferência, Agendamento e lista de O.S.), os campos simples (placa, cor,
modelo, data) apareciam na hora, mas os seletores relacionais — consultores, modelos, serviços, tipos de
película, bobinas, instaladores — chegavam em **cascata** (*waterfall*), com campos vazios e *pop-in*
visível.

A hipótese inicial do pedido era que o gargalo estava no **backend** (N+1, carregamento *lazy*). A
investigação no código **refutou** essa hipótese:

- **O backend já estava correto.** O detalhe da O.S. e a listagem de tipos de película já usavam
  `selectinload` cobrindo exatamente o que os schemas serializam. **Sem N+1.**
- **O waterfall era imposto pelo frontend:**
  - não existia nenhum `prefetchQuery` no projeto — nada era aquecido antes do clique;
  - os catálogos só disparavam na montagem do modal, condicionados a loja/marca;
  - o detalhe na Conferência usava `staleTime: 0` (refetch a cada abertura), e era esse refetch que
    reescrevia instaladores e películas, causando o *pop-in*;
  - hooks de catálogo sem `staleTime` próprio caíam no padrão global.

## Decisão

Correção **essencialmente no frontend**, com um cache servidor enxuto por decisão explícita do cliente.

**Frontend (TanStack Query)**
- **Fábricas de `queryKey`** centralizadas, com tempos de cache explícitos: catálogos tratados como **dado
  de referência** (`staleTime` 30 min, `gcTime` 60 min) e detalhe da O.S. com 1 min. As fábricas garantem
  **paridade de chave** entre quem consome e quem faz o prefetch (senão o prefetch vira cache órfão) e
  unificaram chaves que divergiam entre telas.
- **Prefetch por intenção:** `onMouseEnter` / `onFocus` / `onPointerDown` nos botões de editar aquecem o
  detalhe e os catálogos **antes do clique**.
- **Reuso da lista:** o detalhe é semeado com o objeto da lista (`initialData`), marcado como *stale*
  (`initialDataUpdatedAt: 0`) — o formulário abre completo e ainda faz um refetch de reconciliação em
  segundo plano, **evitando lost update** em edições concorrentes.
- **Selects atômicos:** enquanto as opções não chegam, o seletor mostra o rótulo atual como opção de
  *fallback* — nunca fica em branco.

**Backend (cache Redis de catálogos)**
- Helper reutilizável `cached_catalog(key, compute, ttl=300)`: **fail-open** (Redis fora não quebra a
  leitura), desligado em modo DEBUG, com **chave versionada**.
- O **escopo de lojas do usuário entra na chave** dos catálogos por loja — nunca se serve a um usuário
  dado de loja fora do seu perfil.
- **Invalidação pós-commit:** escritas nos catálogos marcam a sessão, e o *bump* de versão só ocorre
  **depois** da persistência real (na finalização da dependency de sessão).

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Otimizar queries do backend** (hipótese do pedido) | — | Não se aplicava: já era *eager*. **Descartada pela evidência.** |
| **Prefetch na carga da lista** (todas as lojas da página) | Simples | Busca catálogos que talvez nunca sejam abertos. **Descartada.** |
| **Só reuso + `staleTime`, sem prefetch** | Menor mudança | A primeira abertura de cada loja ainda teria atraso. **Descartada.** |
| **Prefetch por intenção + reuso + cache (escolhida)** | Abre completo no 1º frame | Mais peças para manter (fábricas de chave). |

## Consequências

**Positivas**
- O modal abre com todos os seletores preenchidos no primeiro frame, sem rajada de requisições no clique;
  reabrir a mesma O.S. dentro do `staleTime` não gera tráfego.
- Fim do *pop-in* mantendo a reconciliação de edições concorrentes.
- O cache de catálogos alivia picos de leitura simultânea.

**Negativas / riscos aceitos**
- O ganho do cache servidor é **marginal por desenho** (o cliente já cacheia); ajuda no cenário de cache
  frio em massa — por isso foi mantido enxuto.
- Janela de dado desatualizado de até 5 min se o *bump* falhar com o Redis fora (best-effort) —
  aceitável para dado de referência.
- Deploy casado backend + web.

## Como foi validado

- Testes unitários do helper de cache (versão, fail-open, chave com escopo de loja) e testes de integração
  dos catálogos com cache (incluindo invalidação após escrita).
- Gate completo do backend e do frontend (lint, type-check, build) e roteiro de teste em homologação.
