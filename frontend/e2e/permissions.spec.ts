/**
 * E2E — RBAC Permissions
 *
 * Covers:
 *  1. Owner can access /admin/users
 *  2. Owner can access /admin/stores (via /admin/users route group)
 *  3. Operator accessing /admin/users is redirected to /unauthorized
 *  4. Supervisor accessing /admin/users is redirected to /unauthorized
 *  5. Operator does NOT see the "Aprovar" button in the approvals page
 *  6. Supervisor DOES see the "Aprovar" button in the approvals page
 *  7. Owner sees "Gestão de Usuários" and "Consultores" in the sidebar
 *  8. Operator does NOT see "Gestão de Usuários" in the sidebar
 *
 * All routes are intercepted; no backend required.
 */

import { test, expect } from '@playwright/test'
import { mockCommonRoutes, MOCK_USERS } from './fixtures'

// ---------------------------------------------------------------------------
// Helper: inject specific role auth into localStorage
// ---------------------------------------------------------------------------
async function injectAuth(
  page: import('@playwright/test').Page,
  role: 'owner' | 'supervisor' | 'operator'
) {
  await mockCommonRoutes(page, role)
  await page.goto('/')
  await page.evaluate(
    ({ user }) => {
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
    },
    { user: MOCK_USERS[role] }
  )
}

// ---------------------------------------------------------------------------
// Mock payloads
// ---------------------------------------------------------------------------
const MOCK_USERS_LIST = {
  items: [
    {
      id: 1,
      full_name: 'Arthur Owner',
      email: 'owner@aems.com.br',
      role: 'owner',
      is_active: true,
      store_id: null,
      created_at: new Date().toISOString(),
    },
  ],
  total: 1,
}

const MOCK_PURCHASE_REQUESTS = {
  items: [
    {
      id: 10,
      request_number: 'PR-2601-010',
      category: 'film',
      urgency: 'normal',
      status: 'pending',
      justification: 'Precisa de película fumê',
      requester_name: 'Carlos Operator',
      store_name: 'Loja Toyota Centro',
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      items: [
        {
          id: 1,
          product_name: 'Película Fumê 35%',
          quantity: 5,
          estimated_price: 150.0,
        },
      ],
    },
  ],
  total: 1,
}

const MOCK_APPROVAL_STATS = {
  pending_count: 1,
  approved_count: 0,
  rejected_count: 0,
  total_pending_value: 750.0,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('RBAC Permissions', () => {
  // =========================================================================
  // 1. Owner can access /admin/users
  // =========================================================================
  test('owner should access the user management page', async ({ page }) => {
    await injectAuth(page, 'owner')

    await page.route('**/api/v1/users*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USERS_LIST),
      })
    )

    await page.goto('/admin/users')

    // UserManagementPage renders this heading
    await expect(
      page.getByRole('heading', { name: /Gestão de Usuários|Usuários/i })
    ).toBeVisible({ timeout: 8000 })

    // Should NOT be on /unauthorized
    await expect(page).not.toHaveURL(/\/unauthorized/)
  })

  // =========================================================================
  // 2. Operator accessing /admin/users is redirected to /unauthorized
  // =========================================================================
  test('operator should be redirected to /unauthorized when accessing admin pages', async ({
    page,
  }) => {
    await injectAuth(page, 'operator')

    await page.goto('/admin/users')

    // RoleGuard in the router redirects non-owners to /unauthorized
    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 5000 })
  })

  // =========================================================================
  // 3. Supervisor accessing /admin/users is redirected to /unauthorized
  // =========================================================================
  test('supervisor should be redirected to /unauthorized when accessing admin pages', async ({
    page,
  }) => {
    await injectAuth(page, 'supervisor')

    await page.goto('/admin/users')

    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 5000 })
  })

  // =========================================================================
  // 4. Operator does NOT see the "Aprovar" button on approvals page
  // =========================================================================
  test('operator should see access-denied message on approvals page', async ({ page }) => {
    await injectAuth(page, 'operator')

    await page.route('**/api/v1/purchase-requests*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PURCHASE_REQUESTS),
      })
    )

    await page.route('**/api/v1/purchase-requests/stats*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_APPROVAL_STATS),
      })
    )

    await page.goto('/approvals')

    // ApprovalsPage renders "Acesso negado." for operators
    await expect(page.getByText('Acesso negado.')).toBeVisible({ timeout: 8000 })

    // Approve button should not appear
    await expect(page.getByRole('button', { name: /Aprovar/i })).not.toBeVisible()
  })

  // =========================================================================
  // 5. Supervisor DOES see the approvals panel with "Aprovar" button
  // =========================================================================
  test('supervisor should see approval cards with Aprovar button', async ({ page }) => {
    await injectAuth(page, 'supervisor')

    await page.route('**/api/v1/purchase-requests/pending*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PURCHASE_REQUESTS),
      })
    )

    await page.route('**/api/v1/purchase-requests/stats*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_APPROVAL_STATS),
      })
    )

    await page.route('**/api/v1/purchase-requests*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PURCHASE_REQUESTS),
      })
    )

    await page.goto('/approvals')

    // ApprovalsPage heading
    await expect(
      page.getByRole('heading', { name: 'Painel de Aprovações' })
    ).toBeVisible({ timeout: 8000 })

    // "Acesso negado" should NOT appear for supervisor
    await expect(page.getByText('Acesso negado.')).not.toBeVisible()

    // Approve button should be present in ApprovalCard
    await expect(page.getByRole('button', { name: /Aprovar/i }).first()).toBeVisible()
  })

  // =========================================================================
  // 6. Owner sidebar has both "Gestão de Usuários" and "Consultores" links
  // =========================================================================
  test('owner should see Gestão de Usuários and Consultores in sidebar', async ({ page }) => {
    await injectAuth(page, 'owner')

    await page.route('**/api/v1/reports/dashboard*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          kpis: {
            totalOrdersToday: 0,
            completedOrdersToday: 0,
            inProgressOrdersToday: 0,
            delayedOrders: 0,
            revenueThisMonth: 0,
            revenueLastMonth: 0,
            revenueGrowth: 0,
            averageCompletionTime: 0,
            productivity: 0,
            nps: 0,
          },
          revenueData: [],
          departmentData: [],
          storePerformance: [],
          topInstallers: [],
          topServices: [],
          alerts: [],
        }),
      })
    )

    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 8000 })

    // Owner-only sidebar links (roles: ['owner'] in Sidebar.tsx)
    await expect(page.getByRole('link', { name: 'Gestão de Usuários' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Consultores' })).toBeVisible()
  })

  // =========================================================================
  // 7. Operator sidebar does NOT have owner-only links
  // =========================================================================
  test('operator should not see Gestão de Usuários link in sidebar', async ({ page }) => {
    await injectAuth(page, 'operator')

    await page.route('**/api/v1/reports/dashboard*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          kpis: {
            totalOrdersToday: 0,
            completedOrdersToday: 0,
            inProgressOrdersToday: 0,
            delayedOrders: 0,
            revenueThisMonth: 0,
            revenueLastMonth: 0,
            revenueGrowth: 0,
            averageCompletionTime: 0,
            productivity: 0,
            nps: 0,
          },
          revenueData: [],
          departmentData: [],
          storePerformance: [],
          topInstallers: [],
          topServices: [],
          alerts: [],
        }),
      })
    )

    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 8000 })

    // These links must NOT be visible for operators
    await expect(page.getByRole('link', { name: 'Gestão de Usuários' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Consultores' })).not.toBeVisible()
  })

  // =========================================================================
  // 8. Owner can access /admin/stores
  // =========================================================================
  test('owner should access /admin/stores page', async ({ page }) => {
    await injectAuth(page, 'owner')

    await page.route('**/api/v1/stores*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 1, name: 'Loja Toyota Centro', code: 'LJ01', store_type: 'dealership', is_active: true },
        ]),
      })
    )

    await page.goto('/admin/stores')

    // Should NOT be redirected to /unauthorized
    await expect(page).not.toHaveURL(/\/unauthorized/, { timeout: 5000 })
  })
})
