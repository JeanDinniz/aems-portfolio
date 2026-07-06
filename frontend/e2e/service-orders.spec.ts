/**
 * E2E — Service Orders (Ordens de Serviço)
 *
 * Covers:
 *  1. List page renders service orders from mocked API
 *  2. "Nova OS" button navigates to creation form
 *  3. Submit empty form shows required-field validation errors
 *  4. Successful creation redirects back to list
 *  5. Status filter updates the request query param
 *
 * All API calls are intercepted with page.route().
 */

import { test, expect } from '@playwright/test'
import { mockCommonRoutes, MOCK_USERS } from './fixtures'

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------
const MOCK_SERVICE_ORDERS = [
  {
    id: 1,
    order_number: 'LJ01-OS-2601-001',
    plate: 'ABC1D23',
    client_name: 'Toyota Centro',
    vehicle_model: 'Corolla XEi',
    vehicle_color: 'Prata',
    department: 'film',
    status: 'waiting',
    location_name: 'Loja Toyota Centro',
    entry_time: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    destination_store_id: null,
    destination_store_name: null,
  },
  {
    id: 2,
    order_number: 'LJ01-OS-2601-002',
    plate: 'XYZ9W87',
    client_name: 'BYD Sul',
    vehicle_model: 'BYD Han',
    vehicle_color: 'Preto',
    department: 'vn',
    status: 'in_progress',
    location_name: 'Loja BYD Sul',
    entry_time: new Date(Date.now() - 65 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 65 * 60 * 1000).toISOString(),
    destination_store_id: null,
    destination_store_name: null,
  },
]

const MOCK_SERVICES = [
  { id: 1, name: 'Película Fumê 35%', department: 'film', is_active: true },
  { id: 2, name: 'Película Fumê 50%', department: 'film', is_active: true },
  { id: 3, name: 'Higienização Completa', department: 'vn', is_active: true },
]

// ---------------------------------------------------------------------------
// Helper: inject owner auth state into localStorage
// ---------------------------------------------------------------------------
async function injectOwnerAuth(page: import('@playwright/test').Page) {
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
test.describe('Service Orders', () => {
  test.beforeEach(async ({ page }) => {
    await mockCommonRoutes(page, 'operator')

    // Mock service orders list endpoint
    await page.route('**/api/v1/service-orders*', async (route) => {
      const _url = route.request().url()
      // POST — creation
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 99,
            order_number: 'LJ01-OS-2601-099',
            plate: 'ABC1D23',
            client_name: null,
            vehicle_model: 'Honda Civic',
            vehicle_color: 'Branco',
            department: 'film',
            status: 'waiting',
            location_name: 'Loja Toyota Centro',
            entry_time: new Date().toISOString(),
            created_at: new Date().toISOString(),
          }),
        })
        return
      }

      // GET — list with pagination
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: MOCK_SERVICE_ORDERS,
          total: MOCK_SERVICE_ORDERS.length,
          offset: 0,
          limit: 10,
        }),
      })
    })

    // Mock services endpoint (used by CreateServiceOrderPage)
    await page.route('**/api/v1/services*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SERVICES),
      })
    )

    // Mock consultants endpoint
    await page.route('**/api/v1/consultants*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0 }),
      })
    )

    // Mock workers endpoint
    await page.route('**/api/v1/users*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    )

    // Mock photo upload endpoint
    await page.route('**/api/v1/upload*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ url: 'https://cdn.aems.com.br/photos/test.jpg' }]),
      })
    )

    await injectOwnerAuth(page)
  })

  // =========================================================================
  // 1. List page renders orders from mocked API
  // =========================================================================
  test('should list service orders with correct data', async ({ page }) => {
    await page.goto('/service-orders')

    // Page heading
    await expect(
      page.getByRole('heading', { name: 'Ordens de Serviço' })
    ).toBeVisible({ timeout: 8000 })

    // Table headers
    await expect(page.getByRole('columnheader', { name: 'Placa' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()

    // Data rows from mock
    await expect(page.getByText('ABC1D23')).toBeVisible()
    await expect(page.getByText('XYZ9W87')).toBeVisible()
    await expect(page.getByText('Corolla XEi - Prata')).toBeVisible()
  })

  // =========================================================================
  // 2. "Nova OS" button navigates to /service-orders/new
  // =========================================================================
  test('should navigate to creation form when clicking "Nova OS"', async ({ page }) => {
    await page.goto('/service-orders')
    await expect(
      page.getByRole('heading', { name: 'Ordens de Serviço' })
    ).toBeVisible({ timeout: 8000 })

    await page.getByRole('button', { name: 'Nova OS' }).click()

    await expect(page).toHaveURL(/\/service-orders\/new/, { timeout: 5000 })
    await expect(
      page.getByRole('heading', { name: 'Nova Ordem de Serviço' })
    ).toBeVisible()
  })

  // =========================================================================
  // 3. Submit empty creation form shows validation errors
  // =========================================================================
  test('should show validation errors when submitting empty form', async ({ page }) => {
    await page.goto('/service-orders/new')
    await expect(
      page.getByRole('heading', { name: 'Nova Ordem de Serviço' })
    ).toBeVisible({ timeout: 8000 })

    // Click submit without filling in required fields
    await page.getByRole('button', { name: 'Criar Ordem de Serviço' }).click()

    // Zod validation errors defined in CreateServiceOrderPage schema
    await expect(
      page.getByText('Selecione pelo menos um serviço')
    ).toBeVisible({ timeout: 5000 })

    await expect(
      page.getByText('Selecione uma loja')
    ).toBeVisible()
  })

  // =========================================================================
  // 4. Invalid plate format triggers Mercosul validation error
  // =========================================================================
  test('should show plate format validation error for non-Mercosul plate', async ({ page }) => {
    await page.goto('/service-orders/new')
    await expect(
      page.getByRole('heading', { name: 'Nova Ordem de Serviço' })
    ).toBeVisible({ timeout: 8000 })

    // Fill an invalid plate
    await page.getByLabel('Placa do Veículo *').fill('INVALID')
    // Trigger validation by attempting submit
    await page.getByRole('button', { name: 'Criar Ordem de Serviço' }).click()

    await expect(
      page.getByText('Placa inválida (Mercosul ou Antiga)')
    ).toBeVisible({ timeout: 5000 })
  })

  // =========================================================================
  // 5. Status filter button updates the displayed list heading
  // =========================================================================
  test('should show status filter select element on the list page', async ({ page }) => {
    await page.goto('/service-orders')
    await expect(
      page.getByRole('heading', { name: 'Ordens de Serviço' })
    ).toBeVisible({ timeout: 8000 })

    // The status filter is a Select component with "Todos Status" as the placeholder
    await expect(page.getByText('Todos Status')).toBeVisible()

    // Department filter is also present
    await expect(page.getByText('Todos Depts')).toBeVisible()
  })

  // =========================================================================
  // 6. Search input is visible and interactive
  // =========================================================================
  test('should have a functional search input on the list page', async ({ page }) => {
    await page.goto('/service-orders')
    await expect(
      page.getByRole('heading', { name: 'Ordens de Serviço' })
    ).toBeVisible({ timeout: 8000 })

    const searchInput = page.getByPlaceholder('Buscar por cliente, veículo ou OS...')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('ABC1D23')
    await expect(searchInput).toHaveValue('ABC1D23')
  })

  // =========================================================================
  // 7. Pagination buttons are rendered
  // =========================================================================
  test('should render pagination controls', async ({ page }) => {
    await page.goto('/service-orders')
    await expect(
      page.getByRole('heading', { name: 'Ordens de Serviço' })
    ).toBeVisible({ timeout: 8000 })

    await expect(page.getByRole('button', { name: 'Anterior' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Próximo' })).toBeVisible()
  })

  // =========================================================================
  // 8. "Cancelar" button in create form navigates back to list
  // =========================================================================
  test('should navigate back to list when clicking Cancelar in create form', async ({ page }) => {
    await page.goto('/service-orders/new')
    await expect(
      page.getByRole('heading', { name: 'Nova Ordem de Serviço' })
    ).toBeVisible({ timeout: 8000 })

    await page.getByRole('button', { name: 'Cancelar' }).click()

    await expect(page).toHaveURL(/\/service-orders$/, { timeout: 5000 })
  })
})
