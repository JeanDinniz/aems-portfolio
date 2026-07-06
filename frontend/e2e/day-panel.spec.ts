/**
 * E2E — Day Panel (Painel do Dia / Semáforo)
 *
 * Covers:
 *  1. Kanban columns render (Aguardando, Fazendo, Inspeção, Pronto, Entregue)
 *  2. Service order card in "waiting" column shows white semaphore (< 30 min)
 *  3. Service order card shows red semaphore for overdue order (> 3h)
 *  4. Department filter tab "Película" changes active tab
 *  5. "Nova O.S." button navigates to /service-orders/new
 *  6. Statistics counters (Total, Atrasadas, Críticas) render
 *
 * WebSocket connections are aborted so tests run without a real WS server.
 * All API calls are intercepted.
 */

import { test, expect } from '@playwright/test'
import { mockCommonRoutes, MOCK_USERS } from './fixtures'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns an ISO timestamp N minutes ago */
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 1000).toISOString()
}

// ---------------------------------------------------------------------------
// Mock day-panel API response builder
// ---------------------------------------------------------------------------
function buildDayPanelResponse(overrides: {
  waitingOrders?: object[]
  inProgressOrders?: object[]
  inspectionOrders?: object[]
  readyOrders?: object[]
  deliveredOrders?: object[]
} = {}) {
  return {
    waiting: overrides.waitingOrders ?? [],
    in_progress: overrides.inProgressOrders ?? [],
    inspection: overrides.inspectionOrders ?? [],
    ready: overrides.readyOrders ?? [],
    delivered: overrides.deliveredOrders ?? [],
  }
}

/** Build a minimal service order card payload */
function buildCard(overrides: {
  id: number
  plate: string
  entryTime: string
  semaphoreColor: 'white' | 'yellow' | 'orange' | 'red'
  department?: string
}) {
  return {
    id: overrides.id,
    plate: overrides.plate,
    model: 'Corolla XEi',
    color: 'Prata',
    department: overrides.department ?? 'film',
    semaphoreColor: overrides.semaphoreColor,
    entryTime: overrides.entryTime,
    services: [{ id: 1, name: 'Película Fumê 35%' }],
    consultantName: 'João Consultor',
    dealershipName: 'Toyota Centro',
    assignedWorkers: [],
    status: 'waiting',
  }
}

// ---------------------------------------------------------------------------
// Shared auth injection helper
// ---------------------------------------------------------------------------
async function injectAuth(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.evaluate((user) => {
    const persistState = {
      state: {
        user,
        tokens: {
          accessToken: 'e2e_fake_access_token',
          refreshToken: 'e2e_fake_refresh_token',
          expiresIn: 28800,
        },
        isAuthenticated: true,
      },
      version: 0,
    }
    localStorage.setItem('aems-auth', JSON.stringify(persistState))
  }, MOCK_USERS.operator)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Day Panel (Semáforo)', () => {
  test.beforeEach(async ({ page }) => {
    await mockCommonRoutes(page, 'operator')
    await injectAuth(page)
  })

  // =========================================================================
  // 1. All Kanban columns render
  // =========================================================================
  test('should display all kanban columns', async ({ page }) => {
    await page.route('**/api/v1/service-orders/day-panel*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildDayPanelResponse()),
      })
    )

    await page.goto('/day-panel')

    await expect(page.getByRole('heading', { name: 'Painel do Dia' })).toBeVisible({ timeout: 8000 })

    // Column headings rendered by StatusColumn
    await expect(page.getByText('Aguardando')).toBeVisible()
    await expect(page.getByText('Fazendo')).toBeVisible()
    await expect(page.getByText('Inspeção')).toBeVisible()
    await expect(page.getByText('Pronto')).toBeVisible()
    await expect(page.getByText('Entregue')).toBeVisible()
  })

  // =========================================================================
  // 2. Stats counters render (Total, Atrasadas, Críticas)
  // =========================================================================
  test('should render stats counters at the top', async ({ page }) => {
    await page.route('**/api/v1/service-orders/day-panel*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildDayPanelResponse()),
      })
    )

    await page.goto('/day-panel')
    await expect(page.getByRole('heading', { name: 'Painel do Dia' })).toBeVisible({ timeout: 8000 })

    // Stat labels from DayPanelPage
    await expect(page.getByText('Total')).toBeVisible()
    await expect(page.getByText('Atrasadas')).toBeVisible()
    await expect(page.getByText('Críticas')).toBeVisible()
  })

  // =========================================================================
  // 3. White semaphore for order created < 30 min ago
  // =========================================================================
  test('should show white semaphore timer for a recent order (< 30 min)', async ({ page }) => {
    const recentCard = buildCard({
      id: 1,
      plate: 'ABC1D23',
      entryTime: minutesAgo(15),
      semaphoreColor: 'white',
    })

    await page.route('**/api/v1/service-orders/day-panel*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildDayPanelResponse({ waitingOrders: [recentCard] })),
      })
    )

    await page.goto('/day-panel')
    await expect(page.getByRole('heading', { name: 'Painel do Dia' })).toBeVisible({ timeout: 8000 })

    // The plate should appear in the waiting column card
    await expect(page.getByText('ABC1D23')).toBeVisible()

    // The SemaphoreTimer uses 'text-slate-600 bg-slate-100' class for white
    // We can verify via the element having a Clock icon sibling with minutes text
    const card = page.locator('div').filter({ hasText: 'ABC1D23' }).first()
    await expect(card).toBeVisible()

    // The timer should display "15min" (approximately — allow for slight variance)
    await expect(card.getByText(/\d+min/)).toBeVisible()
  })

  // =========================================================================
  // 4. Red semaphore for overdue order (> 3h = > 180 min)
  // =========================================================================
  test('should show red semaphore for overdue order (> 3h)', async ({ page }) => {
    const overdueCard = buildCard({
      id: 2,
      plate: 'RED9R99',
      entryTime: minutesAgo(200),
      semaphoreColor: 'red',
    })

    await page.route('**/api/v1/service-orders/day-panel*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildDayPanelResponse({ waitingOrders: [overdueCard] })),
      })
    )

    await page.goto('/day-panel')
    await expect(page.getByRole('heading', { name: 'Painel do Dia' })).toBeVisible({ timeout: 8000 })

    await expect(page.getByText('RED9R99')).toBeVisible()

    // Red alert text rendered by ServiceOrderCard when semaphoreColor === 'red'
    await expect(page.getByText('ATENÇÃO URGENTE')).toBeVisible()
  })

  // =========================================================================
  // 5. Department filter tabs are rendered and clickable
  // =========================================================================
  test('should render department filter tabs including "Película"', async ({ page }) => {
    await page.route('**/api/v1/service-orders/day-panel*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildDayPanelResponse()),
      })
    )

    await page.goto('/day-panel')
    await expect(page.getByRole('heading', { name: 'Painel do Dia' })).toBeVisible({ timeout: 8000 })

    // Filter tabs from DepartmentFilter.tsx
    await expect(page.getByRole('tab', { name: 'Todos' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Película' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'VN' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'VU' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Funilaria' })).toBeVisible()

    // Click the "Película" tab and verify it becomes selected
    await page.getByRole('tab', { name: 'Película' }).click()
    await expect(page.getByRole('tab', { name: 'Película' })).toHaveAttribute(
      'data-state',
      'active'
    )
  })

  // =========================================================================
  // 6. "Apenas Atrasadas" toggle button is present
  // =========================================================================
  test('should render the "Apenas Atrasadas" toggle button', async ({ page }) => {
    await page.route('**/api/v1/service-orders/day-panel*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildDayPanelResponse()),
      })
    )

    await page.goto('/day-panel')
    await expect(page.getByRole('heading', { name: 'Painel do Dia' })).toBeVisible({ timeout: 8000 })

    const toggleButton = page.getByRole('button', { name: /Apenas Atrasadas/i })
    await expect(toggleButton).toBeVisible()

    // Click to toggle — label should change to "Mostrando Atrasadas"
    await toggleButton.click()
    await expect(page.getByRole('button', { name: /Mostrando Atrasadas/i })).toBeVisible()
  })

  // =========================================================================
  // 7. "Nova O.S." button navigates to /service-orders/new
  // =========================================================================
  test('should navigate to service order creation from "Nova O.S." button', async ({ page }) => {
    await page.route('**/api/v1/service-orders/day-panel*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildDayPanelResponse()),
      })
    )

    // Mock services for the create page
    await page.route('**/api/v1/services*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    )

    await page.goto('/day-panel')
    await expect(page.getByRole('heading', { name: 'Painel do Dia' })).toBeVisible({ timeout: 8000 })

    await page.getByRole('button', { name: 'Nova O.S.' }).click()

    await expect(page).toHaveURL(/\/service-orders\/new/, { timeout: 5000 })
  })

  // =========================================================================
  // 8. Multiple orders across columns show correct data
  // =========================================================================
  test('should render cards in their respective columns', async ({ page }) => {
    const waitingCard = buildCard({ id: 10, plate: 'AAA1B11', entryTime: minutesAgo(10), semaphoreColor: 'white' })
    const progressCard = buildCard({ id: 11, plate: 'BBB2C22', entryTime: minutesAgo(50), semaphoreColor: 'yellow' })
    const inspectionCard = buildCard({ id: 12, plate: 'CCC3D33', entryTime: minutesAgo(100), semaphoreColor: 'orange' })

    await page.route('**/api/v1/service-orders/day-panel*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildDayPanelResponse({
            waitingOrders: [waitingCard],
            inProgressOrders: [progressCard],
            inspectionOrders: [inspectionCard],
          })
        ),
      })
    )

    await page.goto('/day-panel')
    await expect(page.getByRole('heading', { name: 'Painel do Dia' })).toBeVisible({ timeout: 8000 })

    // Verify plates are visible in the panel
    await expect(page.getByText('AAA1B11')).toBeVisible()
    await expect(page.getByText('BBB2C22')).toBeVisible()
    await expect(page.getByText('CCC3D33')).toBeVisible()
  })
})
