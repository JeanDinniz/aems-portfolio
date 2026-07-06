# Frontend Page Tests

Testes abrangentes para as páginas principais do sistema AEMS.

## Estrutura de Testes

```
src/pages/__tests__/
├── LoginPage.test.tsx           # Testes da página de login
├── DashboardPage.test.tsx       # Testes do dashboard
├── DayPanelPage.test.tsx        # Testes do painel do dia
├── ServiceOrdersPage.test.tsx   # Testes da listagem de OS
├── UserManagementPage.test.tsx  # Testes de gestão de usuários
└── README.md                    # Este arquivo
```

## Padrões de Teste

### Setup Global

Todos os testes usam:
- **MSW** (Mock Service Worker) para interceptar chamadas de API
- **Vitest** como test runner
- **React Testing Library** para testes de componentes
- **userEvent** para simular interações do usuário

### Wrapper de Testes

```typescript
const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    return ({ children }: { children: React.ReactNode }) => (
        <BrowserRouter>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </BrowserRouter>
    );
};
```

## LoginPage Tests

### Cobertura de Testes

✅ **Rendering** (3 testes)
- Renderização do formulário de login
- Campos de input (email, senha)
- Botão de submit e link "esqueceu senha"

✅ **Form Validation** (4 testes)
- Validação de campos vazios
- Validação de formato de email
- Limpeza de erros ao digitar

✅ **Form Submission** (5 testes)
- Login com credenciais válidas
- Login com credenciais inválidas
- Estados de loading
- Navegação após sucesso

✅ **Navigation** (2 testes)
- Link "esqueceu senha"
- Redirecionamento pós-login

✅ **Accessibility** (3 testes)
- Labels adequados
- Navegação por teclado
- Roles ARIA

✅ **Integration** (2 testes)
- Integração com auth store
- Atualização de estado global

**Total:** 18 testes

### Exemplos de Testes

```typescript
// Teste de renderização
it('should render login form with all elements', () => {
    renderLoginPage();
    expect(screen.getByText('AEMS')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
});

// Teste de validação
it('should show error for invalid email format', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'invalid-email');

    const submitButton = screen.getByRole('button', { name: /entrar/i });
    await user.click(submitButton);

    await waitFor(() => {
        expect(screen.getByText(/email inválido/i)).toBeInTheDocument();
    });
});

// Teste de submissão
it('should successfully login with valid credentials', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/senha/i), 'password123');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
});
```

## DashboardPage Tests

### Cobertura de Testes

✅ **Rendering** (3 testes)
- Header e título
- Botões de ação
- Data atual

✅ **Loading State** (2 testes)
- Indicador de loading
- Spinner animado

✅ **KPI Cards** (5 testes)
- Renderização de todos os KPIs
- Valores corretos
- Formatação (moeda, percentual)
- Trends

✅ **Filters** (2 testes)
- Renderização de filtros
- Integração com hook

✅ **Alerts** (2 testes)
- Exibição de alertas
- Estado vazio

✅ **Charts** (2 testes)
- Gráfico de receita
- Gráfico de departamentos

✅ **Role-based Content** (3 testes)
- Visibilidade por role (operator, supervisor, owner)

✅ **Rankings** (2 testes)
- Top installers
- Top services

✅ **Actions** (2 testes)
- Refresh data
- Export

✅ **Error Handling** (2 testes)
- Null data
- Undefined data

**Total:** 27 testes

### Mocks Utilizados

```typescript
const mockDashboardData = {
    kpis: {
        totalOrdersToday: 15,
        completedOrdersToday: 10,
        revenueThisMonth: 45000,
        productivity: 85,
        nps: 78,
    },
    revenueData: [...],
    departmentData: [...],
    topInstallers: [...],
    alerts: [...]
};

vi.mock('@/hooks/useDashboardData', () => ({
    useDashboardData: vi.fn(() => ({
        data: mockDashboardData,
        isLoading: false,
        refetch: vi.fn(),
    })),
}));
```

## DayPanelPage Tests

### Cobertura de Testes

✅ **Rendering** (5 testes)
- Header
- WebSocket indicator
- Stats cards
- Botão Nova O.S.
- Filtros

✅ **Status Columns** (5 testes)
- Renderização de 5 colunas (Aguardando, Fazendo, Inspeção, Pronto, Entregue)
- Cards em cada coluna
- Contagem de cards

✅ **Service Order Cards** (4 testes)
- Placas
- Modelos de veículos
- Nomes de clientes
- Cores do semáforo

✅ **Stats** (4 testes)
- Total count
- Delayed count
- Critical count
- Animação de críticos

✅ **Filters** (3 testes)
- Filtro por departamento
- Filtro por atrasadas
- Callbacks de filtros

✅ **Navigation** (1 teste)
- Navegação para criar O.S.

✅ **Layout** (3 testes)
- Full height
- Scrollable kanban
- Minimum width

✅ **Real-time Updates** (2 testes)
- Atualização de stats
- Atualização de colunas

**Total:** 30 testes

### Mock do Hook

```typescript
const mockDayPanelData = {
    columns: {
        waiting: [
            {
                id: 1,
                plate: 'ABC1D23',
                department: 'film',
                semaphore_color: 'white',
            },
        ],
        in_progress: [...],
        inspection: [],
        ready: [...],
        delivered: [],
    },
    stats: {
        total: 4,
        delayed: 1,
        critical: 0,
    },
    filters: {
        department: null,
        setDepartment: vi.fn(),
        onlyDelayed: false,
        setOnlyDelayed: vi.fn(),
    },
};
```

## ServiceOrdersPage Tests

### Cobertura de Testes

✅ **Rendering** (5 testes)
- Header
- Botão Nova O.S.
- Search input
- Filtros (status, departamento)

✅ **Table** (6 testes)
- Headers
- Dados de O.S.
- Labels de departamento
- Badges de status
- Botões de ação

✅ **Loading State** (2 testes)
- Mensagem de loading
- Paginação desabilitada

✅ **Error State** (1 teste)
- Mensagem de erro

✅ **Empty State** (1 teste)
- Mensagem de vazio

✅ **Search** (3 testes)
- Digitação no input
- Reset de página
- Chamada do hook com parâmetro

✅ **Filters** (3 testes)
- Seleção de status
- Seleção de departamento
- Integração com hook

✅ **Pagination** (6 testes)
- Controles de paginação
- Estado dos botões
- Navegação entre páginas

✅ **Navigation** (2 testes)
- Criar nova O.S.
- Ver detalhes

**Total:** 31 testes

## UserManagementPage Tests

### Cobertura de Testes

✅ **Access Control** (3 testes)
- Acesso para owner
- Redirect para operator
- Redirect para supervisor

✅ **Rendering** (4 testes)
- Header
- Botões de ação
- Filtros
- Tabela

✅ **Table Content** (4 testes)
- Nomes de usuários
- Emails
- Roles
- Store information

✅ **Loading State** (1 teste)
- Indicador de loading

✅ **Empty State** (1 teste)
- Mensagem de vazio

✅ **Filters** (3 testes)
- Filtro por role
- Chamada do hook
- Atualização da tabela

✅ **Pagination** (2 testes)
- Controles
- Parâmetros do hook

✅ **Create User Dialog** (3 testes)
- Estado inicial
- Abrir dialog
- Fechar dialog

✅ **Export** (1 teste)
- Trigger de export

✅ **User Actions** (4 testes)
- Botões de ação
- Editar
- Reset password
- Desativar

**Total:** 28 testes

## Comandos de Teste

```bash
# Rodar todos os testes de páginas
npm test -- src/pages/__tests__/

# Rodar testes de uma página específica
npm test -- src/pages/__tests__/LoginPage.test.tsx

# Rodar com coverage
npm test -- --coverage src/pages/__tests__/

# Rodar em watch mode
npm test -- --watch src/pages/__tests__/

# Rodar com reporter verbose
npm test -- --reporter=verbose src/pages/__tests__/
```

## Sumário de Cobertura

| Página | Testes | Áreas Cobertas |
|--------|--------|----------------|
| LoginPage | 18 | Validação, Autenticação, Navegação, Acessibilidade |
| DashboardPage | 27 | KPIs, Charts, Filters, RBAC, Loading/Error States |
| DayPanelPage | 30 | Kanban, Semáforo, WebSocket, Filtros, Real-time |
| ServiceOrdersPage | 31 | Listagem, Search, Filtros, Paginação, Navegação |
| UserManagementPage | 28 | RBAC, CRUD, Filtros, Paginação, Permissions |
| **TOTAL** | **134** | **Cobertura completa das funcionalidades críticas** |

## Boas Práticas Seguidas

### 1. Isolamento de Testes
- Cada teste é independente
- Mocks resetados em `beforeEach`
- Auth store limpo entre testes

### 2. Testes Legíveis
- Nomes descritivos
- Arrange-Act-Assert pattern
- Comentários quando necessário

### 3. User-Centric Testing
- Uso de `screen.getByRole`, `screen.getByText`
- Interações via `userEvent`
- Testes de acessibilidade

### 4. Async Handling
- `waitFor` para operações assíncronas
- `findBy` para elementos que aparecem depois
- Proper cleanup com `cleanup()`

### 5. MSW para Mocks
- Mocks realistas de API
- Handlers reutilizáveis
- Reset entre testes

### 6. Coverage
- Casos de sucesso e erro
- Edge cases
- Loading e empty states
- RBAC e permissões

## Próximos Passos

1. **Adicionar testes E2E com Playwright** para fluxos completos
2. **Aumentar coverage de componentes filho** (KPICard, StatusColumn, etc.)
3. **Adicionar testes de performance** (rendering time, re-renders)
4. **Testes de integração** entre páginas (navegação completa)
5. **Visual regression tests** com Chromatic/Percy

## Troubleshooting

### Erro: "Unable to find element"
- Verificar se o componente está renderizando corretamente
- Usar `screen.debug()` para ver o HTML renderizado
- Verificar se há `waitFor` necessário para elementos assíncronos

### Erro: "Navigation to another Document"
- Normal em testes com `react-router-dom`
- Usar mock do `useNavigate`
- Verificar se BrowserRouter está no wrapper

### Erro: "MSW handler not found"
- Verificar se handler está registrado em `handlers.ts`
- Checar URL e método HTTP
- Usar `server.printHandlers()` para debug

### Erro: "Timeout"
- Aumentar timeout: `waitFor(..., { timeout: 5000 })`
- Verificar se operação async está completa
- Checar se mock está retornando dados

## Recursos

- [Testing Library Docs](https://testing-library.com/docs/react-testing-library/intro/)
- [Vitest Docs](https://vitest.dev/)
- [MSW Docs](https://mswjs.io/docs/)
- [AGENT_TESTING.md](../../../docs/AGENT_TESTING.md) - Padrões de teste do projeto
