# AEMS — Auto Estética Management System

Sistema de gestão para rede de lojas de estética automotiva. Controla ordens de serviço, agendamentos, estoque de películas (bobinas), pedidos de material, conferência, fechamento mensal, ponto eletrônico, EPI, desempenho de instaladores e dashboard executivo para concessionárias parceiras de múltiplas montadoras — com app mobile para a equipe em campo.

> **Sobre este repositório** — projeto real desenvolvido para produção, publicado aqui como amostra de portfólio. O histórico de commits foi omitido e os dados do cliente (nomes de lojas, domínios, infraestrutura, credenciais) foram anonimizados ou removidos.

---

## Em números

| | |
|---|---|
| Módulos de backend | **28** (FastAPI, async) |
| Migrations versionadas | **147** (Alembic) |
| Testes automatizados | **~1.400 testes pytest** · **95 suítes Jest** (mobile) · Vitest + Playwright (web) |
| Código de aplicação | **~178 mil linhas** (Python + TypeScript) |
| Plataformas | API + SPA web (PWA) + app Android (React Native) |

> Snapshot atualizado em setembro/2026. O projeto está em produção e segue em evolução contínua.

---

## Principais funcionalidades

- **Ordens de Serviço** — criação com fotos obrigatórias, finalização pelo instalador com relato técnico, fluxo de status, retornos vinculados à O.S. de origem (inclusive entre lojas da mesma marca) e auditoria.
- **Agendamento** — visão dia/semana/mês por loja e departamento, exportação Excel/PDF, controle de atrasos.
- **Películas (estoque)** — bobinas rastreáveis por SMART ID, consumo por serviço, retalho, rebalanceamento entre lojas, indicadores de estoque × faturamento e relatório PDF gerado no backend (fpdf2).
- **Pedidos de Material** — bobinas e ferramentas por fornecedor, edição com reconciliação de estoque, cancelamento com motivo e trava quando o material já foi consumido.
- **Conferência e Fechamento mensal** — conferência de O.S. com fotos e anotações, relatórios Excel por departamento.
- **Ponto eletrônico (REP-A)** — marcação offline no app com horário fiel, NSR persistido, cadeia de hash para imutabilidade, comprovante e exportação AFD/AEJ (Portaria 671).
- **EPI e ferramentas** — entrega e recebimento com foto obrigatória por item.
- **Desempenho de instaladores** — resumo, retornos e pontuação.
- **Biblioteca e certificados** — catálogos técnicos e emissão de certificado de garantia em PDF.
- **Dashboard executivo** — faturamento, metas, rankings e resumo diário.
- **Perfis de acesso granulares** — permissões por submódulo e ação, escopo por loja/galpão, validadas no backend.
- **Tempo real** — notificações in-app via WebSocket e push (FCM) com deep-link para web e mobile.

---

## Meu papel no projeto

Projeto desenvolvido **individualmente**, do zero à produção — atuei sozinho como desenvolvedor **full-stack** em todas as camadas:

- **Backend (Python/FastAPI)** — arquitetura modular assíncrona, modelagem de dados (SQLAlchemy + Alembic), autenticação JWT com perfis de acesso granulares, tarefas em background (Celery), WebSocket para tempo real, upload de fotos (S3/MinIO) e dashboard analítico.
- **Frontend Web (React + Vite)** — SPA completa com design system próprio, gestão de estado (Zustand), data fetching com cache (TanStack Query) e formulários validados (React Hook Form + Zod).
- **App Mobile (React Native + Expo)** — aplicativo para uso em campo pelos instaladores, reaproveitando a camada de dados do web, com push notifications (FCM) e autenticação biométrica.
- **Infra & DevOps** — containerização (Docker Compose), pipelines de CI (GitHub Actions), migrations versionadas e deploy.

---

## Stack Tecnológico

### Backend
| Tecnologia | Versão | Uso |
|------------|--------|-----|
| Python | 3.11+ | Linguagem principal |
| FastAPI | latest | Framework web assíncrono |
| SQLAlchemy | 2.0 | ORM assíncrono |
| PostgreSQL | 15 | Banco de dados |
| Redis | 7 | Cache e fila de tarefas |
| Celery | latest | Tarefas assíncronas (e-mail, relatórios) |
| fpdf2 / openpyxl | latest | Geração de relatórios PDF e Excel |
| Alembic | latest | Migrations |
| MinIO | latest | Armazenamento de fotos (S3-compatible) |

### Frontend Web
| Tecnologia | Versão | Uso |
|------------|--------|-----|
| React | 19 | UI |
| TypeScript | 5+ | Tipagem estática |
| TailwindCSS | 3 | Estilização |
| Vite | 6 | Build tool |
| TanStack Query | v5 | Cache e fetching de dados |
| Zustand | latest | Estado global |
| React Hook Form + Zod | latest | Formulários e validação |

### App Mobile
| Tecnologia | Versão | Uso |
|------------|--------|-----|
| React Native | 0.81 | UI nativa |
| Expo | SDK 54 | Plataforma mobile |
| TypeScript | 5+ | Tipagem estática |
| NativeWind | v4 | Estilização (TailwindCSS nativo) |
| TanStack Query | v5 | Cache e fetching de dados |
| Zustand | latest | Estado global |
| React Hook Form + Zod | latest | Formulários e validação |
| Expo Notifications | latest | Push notifications (Firebase/FCM) |

---

## Estrutura do Repositório

```
aems/
├── app/                        # Backend FastAPI
│   ├── main.py                 # Entry point
│   ├── config.py               # Settings (pydantic-settings)
│   ├── core/                   # Segurança, permissões, exceções, paginação
│   ├── db/                     # Configuração do banco (session, base)
│   ├── modules/                # Módulos de feature
│   │   ├── auth/               # JWT, troca de senha, reset por e-mail
│   │   ├── users/              # Usuários do sistema
│   │   ├── access_profiles/    # Perfis de acesso com permissões granulares
│   │   ├── stores/             # Cadastro de lojas
│   │   ├── employees/          # Funcionários/instaladores
│   │   ├── consultants/        # Consultores de concessionária
│   │   ├── dealerships/        # Concessionárias parceiras
│   │   ├── brands/             # Marcas de veículos
│   │   ├── vehicle_models/     # Modelos de veículos por marca
│   │   ├── services/           # Catálogo de serviços por departamento
│   │   ├── service_orders/     # Ordens de serviço (módulo principal)
│   │   ├── scheduling/         # Agendamentos por loja e departamento
│   │   ├── inventory/          # Películas: tipos, bobinas, consumo
│   │   ├── material_requests/  # Pedidos de material (bobinas + ferramentas)
│   │   ├── suppliers/          # Fornecedores
│   │   ├── epi/                # EPI e ferramentas
│   │   ├── time_clock/         # Ponto eletrônico (REP-A, AFD/AEJ)
│   │   ├── holidays/           # Feriados
│   │   ├── installer_performance/ # Desempenho de instaladores
│   │   ├── ebook/              # Biblioteca e certificados de garantia
│   │   ├── analytics/          # Dashboard executivo, indicadores, PDFs
│   │   ├── settings/           # Configurações globais (metas)
│   │   ├── audit_logs/         # Trilha de auditoria
│   │   ├── notifications/      # Notificações in-app + WebSocket
│   │   ├── push/               # Push notifications (FCM)
│   │   └── upload/             # Upload de fotos
│   └── workers/                # Celery app e tasks
├── alembic/                    # Migrations
├── tests/                      # Testes automatizados
├── frontend/                   # Frontend web React
│   └── src/
│       ├── components/         # Design system, layout e componentes de domínio
│       ├── pages/              # Páginas por rota
│       ├── hooks/              # React Query hooks por módulo
│       ├── services/api/       # Clientes HTTP por módulo
│       ├── stores/             # Zustand stores
│       └── types/              # TypeScript types
├── mobile/                     # App mobile React Native + Expo
│   └── src/
│       ├── components/         # Design system mobile (NativeWind)
│       ├── screens/            # Telas por módulo
│       ├── navigation/         # React Navigation (Stack + Tab)
│       ├── hooks/              # React Query hooks (reutilizados do web)
│       ├── services/           # Clientes HTTP por módulo
│       ├── stores/             # Zustand stores
│       ├── providers/          # WebSocket, Auth, QueryClient
│       └── types/              # TypeScript types
├── docker-compose.yml
└── pyproject.toml
```

---

## Pré-requisitos

- [Docker](https://www.docker.com/) e Docker Compose
- [Python 3.11+](https://www.python.org/downloads/) (para desenvolvimento local do backend)
- [Node.js 20+](https://nodejs.org/) (para desenvolvimento local do frontend/mobile)

---

## Início Rápido (Docker)

```bash
# Clonar o repositório
git clone https://github.com/JeanDinniz/aems-portfolio.git
cd aems-portfolio

# Copiar variáveis de ambiente
cp .env.example .env
# edite o .env com suas configurações

# Subir todos os serviços
docker-compose up -d

# Aplicar migrations
docker exec aems_api alembic upgrade head
```

- **Backend:** http://localhost:8000
- **Frontend Web:** http://localhost:5173
- **API Docs (Swagger):** http://localhost:8000/api/v1/docs

---

## Desenvolvimento Local

### Backend

```bash
# Criar e ativar ambiente virtual
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Linux/macOS

# Instalar dependências
pip install -r requirements.txt

# Subir apenas banco e cache
docker-compose up -d postgres redis minio

# Rodar servidor com hot-reload
venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Migrations
venv/Scripts/python.exe -m alembic upgrade head
venv/Scripts/python.exe -m alembic revision --autogenerate -m "descricao"

# Lint
venv/Scripts/python.exe -m ruff check app/
venv/Scripts/python.exe -m ruff format app/

# Testes
venv/Scripts/python.exe -m pytest tests/ -q
```

### Frontend Web

```bash
cd frontend

npm install
npm run dev          # Servidor de desenvolvimento (porta 5173)
npm run type-check   # Verificação de tipos TypeScript
npm run lint         # ESLint
npm run build        # Build de produção
npm run test         # Vitest
```

### App Mobile

```bash
cd mobile

npm install

# Rodar no Expo Go (SDK 54)
npx expo start

# Rodar em dispositivo Android
npx expo start --android

# Build de desenvolvimento (EAS)
eas build --profile development --platform android

# Testes
npm test
```

> **Atenção:** O app mobile usa Expo SDK 54. Sempre instale dependências com `npx expo install <pacote>` para garantir compatibilidade de versão.

---

## Módulos Ativos

| Módulo | Prefixo API | Descrição |
|--------|------------|-----------|
| `auth` | `/auth` | Autenticação JWT, troca de senha, reset por e-mail |
| `users` | `/users` | Gestão de usuários |
| `access_profiles` | `/access-profiles` | Perfis de acesso com permissões granulares |
| `stores` | `/stores` | Cadastro de lojas |
| `employees` | `/employees` | Funcionários e instaladores por loja |
| `consultants` | `/consultants` | Consultores de concessionária |
| `dealerships` | `/dealerships` | Concessionárias parceiras |
| `brands` | `/brands` | Marcas de veículos |
| `vehicle_models` | `/vehicle-models` | Modelos de veículos por marca |
| `services` | `/services` | Catálogo de serviços por departamento |
| `service_orders` | `/service-orders` | Ordens de serviço (módulo principal) |
| `scheduling` | `/scheduling` | Agendamentos por loja e departamento |
| `inventory` | `/film-types`, `/inventory` | Tipos de película, bobinas e consumo |
| `material_requests` | `/material-requests` | Pedidos de material (bobinas e ferramentas) |
| `suppliers` | `/suppliers` | Fornecedores |
| `epi` | `/epi` | Entrega/recebimento de EPI e ferramentas |
| `time_clock` | `/time-clock` | Ponto eletrônico REP-A, espelho e AFD/AEJ |
| `holidays` | `/holidays` | Feriados |
| `installer_performance` | `/installer-performance` | Desempenho de instaladores |
| `ebook` | `/ebook` | Biblioteca de documentos e certificados |
| `analytics` | `/analytics` | Dashboard executivo, indicadores e relatórios |
| `settings` | `/settings` | Configurações globais (metas de faturamento) |
| `audit_logs` | `/audit-logs` | Trilha de auditoria (Owner) |
| `notifications` | `/notifications` | Notificações in-app + WebSocket |
| `push` | `/push` | Registro de dispositivos para push (FCM) |
| `upload` | `/upload` | Upload de fotos (MinIO/S3) |

---

## Controle de Acesso

O sistema usa dois níveis de acesso:

- **Owner** — acesso total, incluindo Dashboard Executivo e gestão de usuários
- **Perfis de Acesso** — permissões granulares por submódulo e ação, configuráveis por usuário

Perfis especiais:
- `is_galpon_profile` — filtra todos os módulos para exibir apenas dados do galpão
- `hide_galpon_option` — filtra todos os módulos para excluir dados do galpão

---

## Fluxo de Status de O.S.

```
waiting → in_progress → completed
Aguardando   Fazendo      Finalizado

Estados alternativos (de qualquer status):
  → wrong      (Lançado Errado — pode voltar para waiting)
  → cancelled  (Cancelada)
```

---

## WebSocket

Conexão: `GET /ws/{room}?token=<access_token>`

Rooms disponíveis:
- `store:{store_id}` — eventos de loja em tempo real
- `user:{user_id}` — notificações pessoais

---

## Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DATABASE_URL` | URL de conexão PostgreSQL (asyncpg) | — |
| `REDIS_URL` | URL de conexão Redis | — |
| `SECRET_KEY` | Chave secreta JWT (mín. 32 chars) | — |
| `DEBUG` | Modo debug | `False` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Expiração do access token | `30` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Expiração do refresh token | `7` |
| `MINIO_ENDPOINT` | Endpoint do MinIO | — |
| `MINIO_ACCESS_KEY` | Access key do MinIO | — |
| `MINIO_SECRET_KEY` | Secret key do MinIO | — |
| `MINIO_BUCKET` | Nome do bucket | — |
| `ALLOWED_ORIGINS` | Origens CORS permitidas (JSON array) | — |

---

## CI/CD

O projeto possui workflows de CI no GitHub Actions:

| Workflow | Arquivo | Descrição |
|----------|---------|-----------|
| **Backend CI** | `backend-ci.yml` | Lint (ruff) + testes (pytest + PostgreSQL/Redis) |
| **Frontend CI** | `frontend-ci.yml` | Type-check (tsc) + lint (eslint) + testes (vitest) |
| **Mobile CI** | `mobile-ci.yml` | Type-check + lint + testes (jest) |
| **CI** | `ci.yml` | Pipeline unificado de lint e qualidade |

Todos os workflows disparam em push/PR nas branches `main` e `develop`.

> _Nota: os workflows de build/deploy para a infraestrutura de produção foram removidos nesta versão de portfólio._

---

## Ambientes

| Ambiente | URL | Branch |
|----------|-----|--------|
| Local | localhost:5173 / 8000 | — |

O projeto roda em produção com ambientes de homologação e produção separados (detalhes de infraestrutura omitidos nesta versão de portfólio).

---

## Licença

Projeto de portfólio — Todos os direitos reservados. Uso restrito a avaliação.

---

**AEMS** — Auto Estética Management System
