# Testes E2E (Maestro) — AEMS Mobile

QA-03 (Sprint 7). Fluxos end-to-end dos caminhos críticos do app, escritos para o
[Maestro](https://docs.maestro.dev). **A execução é ação do PO** (requer device/emulador
Android físico ou virtual). Este diretório entrega os flows + doc de execução; nada roda no CI ainda.

> A câmera **não** é mockável pelo Maestro. Os fluxos que precisam de foto usam a
> **galeria** com uma imagem pré-carregada no emulador (ver [Foto no emulador](#foto-no-emulador)).

---

## Conteúdo

```
.maestro/
├── config.yaml              # ordem dos flows numa execução de pasta
├── README.md                # este arquivo
├── subflows/
│   └── login.yaml           # login reutilizável (runFlow) — loga se necessário
└── flows/
    ├── 01-login.yaml            # login → bootstrap → lista de O.S.
    ├── 02-criar-os.yaml         # criar O.S. com foto → upload → submissão
    ├── 03-status-finalizar.yaml # abrir O.S. → trocar status → finalizar
    ├── 04-agendamento-gera-os.yaml # criar agendamento → gerar O.S.
    └── 05-logout.yaml           # logout limpa estado (volta ao login)
```

---

## Pré-requisitos

1. **Maestro CLI** instalado
   ```bash
   curl -fsSL "https://get.maestro.mobile.dev" | bash
   maestro --version
   ```
   (No Windows, instale via WSL ou use o instalador oficial; a CLI roda contra o
   emulador/aparelho Android conectado.)

2. **Android** — um dos dois:
   - **Emulador** (Android Studio AVD) rodando, ou
   - **Aparelho físico** com depuração USB ligada (`adb devices` deve listá-lo).

3. **Build do app** instalada no device — duas formas:

   | Forma | `APP_ID` | Observações |
   |-------|----------|-------------|
   | **Dev build / preview (EAS)** | `com.example.aems` | Recomendado. É o applicationId real (Android `package`, ver `app.config.ts`). Câmera/galeria/push funcionam. Gere com `eas build --profile preview` e instale o APK. |
   | **Expo Go** | `host.exp.exponent` | Só funciona apontando o Expo Go para o bundle do Metro/HML. Alguns módulos nativos degradam no Expo Go (push, sharing). Serve para os fluxos 1/3/5; os de foto (2/4) dependem do image-picker, que funciona no Expo Go. |

   > Ao rodar via Expo Go, o `appId` é o do próprio Expo Go (`host.exp.exponent`) e o
   > `launchApp` abre o Expo Go — você precisa já ter o projeto aberto/deep-linkado nele.
   > Por isso o **dev build é o caminho suportado** para uma execução limpa (o `launchApp`
   > com `clearState` reinicia o AEMS de fato).

4. **App apontando para HML.** Os testes assumem dados reais de staging. Em dev build,
   configure `API_URL`/`WS_URL` de HML no perfil EAS (`eas.json`). Não use produção.

---

## Variáveis

As credenciais e os dados de teste são passados por **variáveis de ambiente** no comando
(`-e CHAVE=valor`). **Nunca** faça commit de senha real.

| Variável | Descrição | Placeholder / exemplo |
|----------|-----------|-----------------------|
| `APP_ID` | applicationId do app sob teste | `com.example.aems` (dev build) ou `host.exp.exponent` (Expo Go) |
| `EMAIL` | e-mail do usuário de teste (HML) | `qa@exemplo.com` |
| `SENHA` | senha do usuário de teste | `••••••` (informe no comando, não aqui) |
| `PLACA_TESTE` | placa/chassi válido p/ criar/abrir O.S. (fluxos 2 e 3) | `ABC1D23` |
| `DEPARTAMENTO` | label do chip de departamento na criação de O.S. (fluxo 2) | `Estética` |
| `MODELO_TESTE` | rótulo do modelo no sheet "Selecionar modelo" | `Corolla` |
| `CONSULTOR_TESTE` | rótulo do consultor no sheet "Selecionar consultor" | `João Silva` |
| `SERVICO_TESTE` | rótulo do serviço no sheet "Selecionar serviços" (fluxo 2) | `EST-01 — Lavagem` |
| `LOJA_TESTE` | (opcional) rótulo da loja — só se o usuário tem >1 loja | `Loja Barra` |
| `PLACA_AGD` | placa/chassi do agendamento (fluxo 4) | `XYZ9K88` |
| `DEPARTAMENTO_AGD` | chip de departamento **não-película** (fluxo 4) | `Estética` |
| `SERVICO_AGD` | rótulo do serviço no agendamento (fluxo 4) | `EST-01 — Lavagem` |

> Os rótulos de **modelo/consultor/serviço/loja** são dinâmicos (vêm do banco de HML). Ajuste
> os valores para dados que existam no ambiente e sejam compatíveis (ex.: um serviço que exista
> no departamento escolhido, um consultor ativo da loja selecionada).

---

## Como rodar

Um fluxo isolado:
```bash
maestro test .maestro/flows/01-login.yaml \
  -e APP_ID=com.example.aems \
  -e EMAIL=qa@exemplo.com \
  -e SENHA='suaSenha'
```

O fluxo 2 (com todos os dados de teste):
```bash
maestro test .maestro/flows/02-criar-os.yaml \
  -e APP_ID=com.example.aems \
  -e EMAIL=qa@exemplo.com -e SENHA='suaSenha' \
  -e PLACA_TESTE=ABC1D23 -e DEPARTAMENTO='Estética' \
  -e MODELO_TESTE='Corolla' -e CONSULTOR_TESTE='João Silva' \
  -e SERVICO_TESTE='EST-01 — Lavagem'
```

A suíte inteira (na ordem do `config.yaml`):
```bash
maestro test .maestro/flows \
  -e APP_ID=com.example.aems \
  -e EMAIL=qa@exemplo.com -e SENHA='suaSenha' \
  -e PLACA_TESTE=ABC1D23 -e DEPARTAMENTO='Estética' \
  -e MODELO_TESTE='Corolla' -e CONSULTOR_TESTE='João Silva' \
  -e SERVICO_TESTE='EST-01 — Lavagem' \
  -e PLACA_AGD=XYZ9K88 -e DEPARTAMENTO_AGD='Estética' -e SERVICO_AGD='EST-01 — Lavagem'
```

> **Ordem importa** ao rodar a pasta: o fluxo 2 cria uma O.S. com `PLACA_TESTE` que o fluxo 3
> reabre e finaliza. Se rodar o 3 isolado, garanta que existe uma O.S. **não finalizada/cancelada**
> para `PLACA_TESTE` no HML.

Modo interativo (útil para depurar seletores):
```bash
maestro studio
```

---

## Dados de teste necessários (HML)

- **Usuário** válido com permissão de **ver e editar** O.S. e Agendamentos (para os FABs/ações
  aparecerem) e `scheduling_os`.edit (para "Gerar O.S." no fluxo 4). Idealmente Owner, para não
  esbarrar em filtros de galpão/loja.
- **Loja** acessível com **marca** vinculada (o modelo/serviços derivam da marca da loja).
- **Modelo, consultor e serviço** compatíveis com a loja/departamento escolhidos (ver Variáveis).
- Para o **fluxo 3** isolado: uma O.S. aberta (status Aguardando ou Fazendo) para `PLACA_TESTE`.
- Para o **fluxo 4**: o usuário precisa poder criar agendamento e gerar O.S.

---

## Foto no emulador

O Maestro **não** controla a câmera nativa. Os fluxos 2 e 4 usam **"Escolher da galeria"** e
assumem ≥1 imagem já na galeria. Como semear:

- **Emulador Android (AVD):**
  ```bash
  adb push minha-foto.jpg /sdcard/Pictures/
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
    -d file:///sdcard/Pictures/minha-foto.jpg
  ```
  Ou arraste uma imagem para a janela do emulador. A **câmera virtual** do AVD também gera fotos
  (abra o app Câmera uma vez para popular a galeria), mas a galeria é o caminho mais previsível.

- **Aparelho físico:** basta ter qualquer foto na galeria.

No passo da galeria, o flow toca na **primeira miniatura por posição** (`point: 20%, 35%`) porque a
UI do seletor de imagens do SO **não** expõe rótulos estáveis. Se o layout do seletor do seu
Android for diferente, ajuste esse ponto (ou use `maestro studio` para achar o alvo). Após a
seleção, o app comprime e faz upload; o flow espera o thumb com `id: "Foto enviada"` e o botão
voltar de "Enviando fotos..." para "Salvar"/"Gerar O.S." antes de submeter.

---

## Seletores usados (referência)

Os flows usam, sempre que possível, **texto** e **accessibilityLabel** já existentes no código.
`testID`/`accessibilityLabel` no RN mapeiam para o `id:` do Maestro.

| Seletor | Onde | Tipo |
|---------|------|------|
| `id: login-email`, `id: login-password` | LoginScreen | **testID novo** (ver abaixo) |
| `Entrar` | LoginScreen (PrimaryButton) | texto |
| `Wash Control` | HomeScreen (marca do header) | texto (assert pós-login) |
| `AEMS` | LoginScreen (marca) | texto |
| `O.S.`, `Agendamentos`, `Estoque`, `Mais`, `Início` | AppTabs (tabBarLabel) | texto |
| `Ordens de Serviço` | header da lista de O.S. | texto |
| `id: Buscar por placa ou O.S.` | busca (lista O.S. e Agendamentos) | accessibilityLabel |
| `id: Nova ordem de serviço` | FAB criar O.S. | accessibilityLabel |
| `Lançar O.S` | header criar O.S. | texto |
| `id: Placa / Chassi *`, `id: Cor *`, `id: Nº O.S. Concessionária` | campos DS TextField | accessibilityLabel (=label) |
| `Selecionar loja...`/`Selecionar modelo...`/`Selecionar consultor...` | PickerField | texto (placeholder) |
| `Selecionar loja`/`Selecionar modelo`/`Selecionar consultor`/`Selecionar serviços` | títulos dos sheets Select | texto |
| `id: Selecionar serviços` | trigger do ServiceItemPicker | accessibilityLabel (substring) |
| `id: Adicionar foto` / `Adicionar foto` / `Escolher da galeria` | PhotoCapture | accessibilityLabel / textos |
| `id: Foto enviada` | thumb de foto após upload | accessibilityLabel |
| `Visualizar` | OSCard (rodapé) | texto |
| `Detalhes`, `Iniciar O.S`, `Alterar status`, `Finalizado`, `Confirmar` | detalhe + StatusChangeSheet | texto / accessibilityLabel |
| `id: Novo agendamento` / `Novo` | FAB agendamentos | accessibilityLabel / texto |
| `Novo Agendamento`, `Criar agendamento` | criar agendamento | texto |
| `id: Agendamento <placa>` | AppointmentCard | accessibilityLabel (substring) |
| `Gerar O.S.` | detalhe agendamento (botão) e GenerateOS (header/botão) | texto |
| `Mais`, `id: Perfil`, `Perfil`, `Sair` | MoreScreen → ProfileScreen → Alert | texto / accessibilityLabel |

### testID adicionados ao código de produção

Apenas **2**, ambos em `src/screens/auth/LoginScreen.tsx` (a tela de login usa o `TextField`
legado, que — diferente do `TextField` do design system — **não** define `accessibilityLabel`,
deixando os campos sem seletor estável):

| Arquivo | testID |
|---------|--------|
| `src/screens/auth/LoginScreen.tsx` | `login-email` |
| `src/screens/auth/LoginScreen.tsx` | `login-password` |

Nenhuma outra tela precisou de `testID` novo: os demais campos (DS `TextField`), botões (`Button`/
`PrimaryButton` renderizam o título como texto), FABs, cards e sheets já expõem
`accessibilityLabel`/texto estável. `testID` não altera aparência nem comportamento e não quebra os
testes Jest existentes (que selecionam por placeholder/texto).

---

## Limitações conhecidas

- **Câmera não é testável** via Maestro — os fluxos 2 e 4 usam a **galeria** com foto pré-carregada.
  A captura real por câmera fica para validação manual do PO.
- **Seletor de galeria do SO** não tem rótulos estáveis → toque por posição (`point`), que pode
  variar por versão de Android/skin. Ajuste se necessário.
- **Time picker nativo** (fluxo 4) é do SO → o flow confirma com "OK" (Android). Em iOS o picker
  é inline e o rótulo muda; estes flows são **Android-primeiro**.
- **Rótulos dinâmicos** (loja/modelo/consultor/serviço) dependem dos dados de HML → passados por
  variável. Um valor inexistente faz o `tapOn` falhar por timeout.
- **Expo Go vs dev build:** com Expo Go o `appId` é `host.exp.exponent` e `launchApp`/`clearState`
  reiniciam o **Expo Go**, não o AEMS — a limpeza de estado do fluxo 5 é confiável apenas em **dev
  build/preview**. Prefira dev build.
- **Alert nativo de logout** (fluxo 5): o botão "Sair" do Alert é selecionado por `index: 1` (0 = o
  item "Sair" da tela de Perfil). Se em algum device a ordem divergir, use `maestro studio` para
  confirmar o alvo do Alert.
- **Ordem/estado:** rodando a pasta inteira, o fluxo 3 depende da O.S. criada no 2. Cada re-execução
  cria novos registros no HML (sem teardown automático) — limpe os dados de teste periodicamente.
