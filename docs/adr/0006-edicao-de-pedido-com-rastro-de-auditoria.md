# 0006 — Edição de pedido de material já lançado, com trava de consumo e rastro de auditoria

- **Status:** aceito
- **Data:** 2026-09-21
- **Tema:** auditoria / integridade de estoque

## Contexto

A tela de Pedidos de Material só permitia **criar** e **cancelar**. Para corrigir um pedido com a
película digitada errada (tipo, tonalidade, nota fiscal), o usuário cancelava e recriava — poluindo a
lista com cancelamentos e perdendo continuidade.

Existia um endpoint `PATCH`, mas ele era **parcial e silencioso**: editava só data/observação e
ferramentas, **não tocava nas linhas de película** e **não gravava nada na auditoria**.

O cliente pediu edição com uma condição explícita: **rastro à prova de fraude** — "senão perde
autenticidade". A parte sensível é a linha de película: ela vira uma **bobina no estoque**, com NF e
custo, e **pode já ter sido consumida em carros**. Mudar metros ou tipo depois disso quebraria o histórico
das O.S. e o cálculo de rendimento.

## Decisão

- **Tudo editável, com trava.** Película (tipo, tonalidade, metros, NF, fornecedor, custo, lote, data de
  recebimento), ferramentas e cabeçalho. **Metros e tipo só mudam se a bobina não tiver consumo**; caso
  contrário, **409** — a mesma regra que já impedia cancelar pedido com bobina usada. Metadados
  (tonalidade, NF, fornecedor, custo, lote, data) são sempre editáveis.
- **Reconciliação no backend.** O payload traz as linhas de película: linha com id **edita** a bobina;
  sem id **cria** (mesma rotina do create, preservando a unicidade do identificador visual); bobina
  **ausente** do payload é **removida** — bloqueada com 409 se tiver consumo.
- **Rastro de auditoria.** Só quando algo **de fato mudou** (comparação de *snapshot* antes × depois):
  grava `edited_at` / `edited_by_user_id` e uma entrada de auditoria com o **de → para** de campos e
  linhas. Cada bobina alterada/removida também gera sua própria entrada de auditoria. Salvar sem
  alteração **não** marca "Editado" — senão o selo mentiria.
- **Travas adicionais:** pedido cancelado e pedido importado de planilha histórica não são editáveis.
- **Permissão:** mantida a do módulo; a autenticidade é garantida pelo **rastro** (autor + de → para), não
  por restringir a edição ao Owner.
- **UI:** botão Editar reabre o diálogo de criação em modo edição; bobinas consumidas aparecem com
  tipo/metros desabilitados; selo **"Editado"** no card com "editado em DD/MM/AAAA por <usuário>".
- **Migration aditiva:** duas colunas anuláveis (`NULL` = nunca editado).

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Editar só metadados** | Risco mínimo | Não resolve a dor principal (corrigir a película errada). **Descartada.** |
| **Editar campos sem adicionar/remover linhas** | Mais simples | Mantém o cancela + recria para casos comuns. **Descartada.** |
| **Editar sempre, sem trava** | Máxima liberdade | Reescrever bobina já consumida romperia histórico e rendimento. **Descartada.** |
| **Edição só pelo Owner** | Controle centralizado | Tira autonomia de quem opera; a auditoria já garante autenticidade. **Descartada.** |
| **Só auditoria central, sem selo** | Menos UI | O cliente pediu identificação fácil no próprio card. **Descartada.** |

## Consequências

**Positivas**
- Corrigir um pedido deixou de exigir cancelar e recriar.
- Toda edição real é rastreável (autor + de → para) e visível no card — atende o requisito anti-fraude
  sem tirar autonomia.
- A trava de consumo reaproveita exatamente a regra do cancelamento.

**Negativas / riscos**
- Deploy casado backend + web.
- `edited_at` indica "houve edição", não versões — o histórico versionado vive na auditoria central.
- A trava visual do front usa uma heurística (saldo < total); a fonte de verdade é o backend (existe
  consumo no extrato?). Numa borda rara (consumo seguido de estorno total), o usuário recebe um 409 com
  mensagem clara — sem risco de dado inconsistente.
- Duas armadilhas de SQLAlchemy assíncrono documentadas: o reload final do pedido precisa de
  `populate_existing=True` (a identity map traria estado obsoleto, e `expire()` provocaria *lazy load*
  proibido no modo async), e um segundo reload após gravar o autor da edição.

## Como foi validado

- 29 testes no módulo, sendo 11 específicos de edição: trava 409 com bobina consumida, pedido de planilha
  (409), bobina de outro pedido (404), esvaziar linhas (422) e "salvar sem mudança não carimba".
- Revisão de código: dois apontamentos relevantes corrigidos (unicidade do identificador visual ao editar
  componentes dele; documentação da heurística do front).
