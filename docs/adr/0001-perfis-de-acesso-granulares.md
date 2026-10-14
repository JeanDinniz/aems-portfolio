# 0001 — Controle de acesso: um único papel de sistema (Owner) + Perfis de Acesso granulares

- **Status:** aceito
- **Data:** 2026-08-25 (consolida decisões de sessões anteriores)
- **Tema:** segurança / arquitetura

## Contexto

O sistema nasceu com papéis fixos e hierárquicos (`Owner`, `Supervisor`, `Operator`). Na prática isso
não descrevia a operação da rede de lojas: cada loja precisava de um recorte diferente de acesso — quem
vê a Conferência, quem edita o Estoque, quem só bate ponto. Com papéis fixos, cada exceção virava um
`if` espalhado pelo código, e o modelo de autorização ficava difícil de auditar.

Era preciso um acesso **granular e configurável pelo próprio cliente**, sem multiplicar papéis.

## Decisão

- Existe **um único papel de sistema: `Owner`** (acesso total, incluindo Dashboard Executivo e gestão de
  usuários).
- Todos os demais usuários recebem permissões por **Perfis de Acesso**: perfis configuráveis com
  permissões por **submódulo × ação** (`can_view` / `can_edit` / `can_delete`). Um usuário pode ter
  vários perfis ativos; as permissões se somam (OR).
- Os papéis `Supervisor` e `Operator` foram **removidos** do código, da UI e da documentação.
- **Toda trava tem enforcement no backend**, centralizado em um único módulo de permissões
  (`check_profile_permission`, `check_any_profile_permission`, `is_owner`). O frontend usa um hook
  `useHasPermission()` **fail-closed** (sem permissões carregadas, esconde) apenas para UX.
- Acesso a recurso de outra loja responde **404, não 403** (`require_resource_access`), para não revelar
  a existência do recurso.

Submódulos controlados: ordens de serviço, conferência, fechamento, agendamento, ponto, espelho de
ponto, usuários, funcionários, consultores, lojas, serviços, marcas, modelos, perfis e estoque.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Manter papéis hierárquicos** (Supervisor/Operator) | Simples de entender | Não representava a operação real; exceções por loja espalhadas no código. **Descartada.** |
| **Biblioteca RBAC/ABAC de terceiros** | Modelo pronto, expressivo | Peso e curva desnecessários para o tamanho do sistema; o modelo submódulo × ação resolve com código próprio e testável. **Descartada.** |
| **Owner + Perfis de Acesso (escolhida)** | Acesso sob medida sem inflar papéis; enforcement num ponto só | Exige disciplina: todo endpoint novo precisa declarar seu submódulo/ação. |

## Consequências

**Positivas**
- Acesso sob medida por perfil, configurado pelo cliente, sem deploy.
- Um ponto único de verdade para "é Owner?" — nunca se compara `role == "owner"` à mão.
- Cadastros (lojas, marcas, serviços, consultores, funcionários) deixaram de ser "só Owner" e passaram a
  ser "por perfil".

**Negativas / riscos**
- Esquecer de declarar a permissão num endpoint novo = vazamento. Mitigação: padrão de router que sempre
  injeta a dependency de permissão, revisão de código e uma auditoria dedicada de "travas do frontend
  sem enforcement no backend".

## Como foi validado

- Suíte de integração dedicada ao *enforcement* de permissões (ex.: "sem permissão → 403",
  "recurso de outra loja → 404", "Owner continua ok") e testes específicos das flags de perfil.
- Auditoria cruzada frontend × backend: travas visuais foram rastreadas até o enforcement no servidor, e
  as lacunas encontradas viraram correções priorizadas por severidade.
