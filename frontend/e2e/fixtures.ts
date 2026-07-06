import { test as base, expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Shared test credentials (must match backend seed_owner.py or test DB seed)
// ---------------------------------------------------------------------------
export const TEST_CREDENTIALS = {
  owner: { email: 'owner@aems.com.br', password: 'Owner@2026!' },
  supervisor: { email: 'supervisor@aems.com.br', password: 'Supervisor@2026!' },
  operator: { email: 'operator@aems.com.br', password: 'Operator@2026!' },
}

// ---------------------------------------------------------------------------
// Shared mock user payloads keyed by role
// ---------------------------------------------------------------------------
export const MOCK_USERS = {
  owner: {
    id: 1,
    full_name: 'Arthur Owner',
    email: 'owner@aems.com.br',
    role: 'owner' as const,
    is_active: true,
    must_change_password: false,
    store_id: null,
    supervised_store_ids: [],
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  supervisor: {
    id: 2,
    full_name: 'Maria Supervisor',
    email: 'supervisor@aems.com.br',
    role: 'supervisor' as const,
    is_active: true,
    must_change_password: false,
    store_id: 1,
    supervised_store_ids: [1, 2],
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  operator: {
    id: 3,
    full_name: 'Carlos Operator',
    email: 'operator@aems.com.br',
    role: 'operator' as const,
    is_active: true,
    must_change_password: false,
    store_id: 1,
    supervised_store_ids: [],
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
}

// ---------------------------------------------------------------------------
// Helper: inject Zustand auth state directly into localStorage so pages load
// as authenticated without going through the real login API.
// The store key is 'aems-auth' (defined in auth.store.ts, persist name).
// ---------------------------------------------------------------------------
export async function injectAuthState(
  page: Page,
  role: 'owner' | 'supervisor' | 'operator'
) {
  const user = MOCK_USERS[role]
  const tokens = {
    accessToken: 'e2e_fake_access_token',
    refreshToken: 'e2e_fake_refresh_token',
    expiresIn: 28800,
  }

  await page.goto('/')

  await page.evaluate(
    ({ user, tokens }) => {
      const state = {
        state: {
          user,
          tokens,
          isAuthenticated: true,
        },
        version: 0,
      }
      localStorage.setItem('aems-auth', JSON.stringify(state))
    },
    { user, tokens }
  )
}

// ---------------------------------------------------------------------------
// Helper: mock all common API routes that pages need to boot without errors.
// Call this BEFORE page.goto() so that intercepts are registered in time.
// ---------------------------------------------------------------------------
export async function mockCommonRoutes(page: Page, role: 'owner' | 'supervisor' | 'operator') {
  const user = MOCK_USERS[role]

  // Auth endpoints
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
  )
  await page.route('**/api/v1/auth/logout', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  )
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'e2e_fake_access_token', refresh_token: 'e2e_fake_refresh_token', expires_in: 28800 }) })
  )

  // Stores (needed by StoreSelector in Header)
  await page.route('**/api/v1/stores*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, name: 'Loja Toyota Centro', code: 'LJ01', store_type: 'dealership', dealership_id: 1, is_active: true },
        { id: 2, name: 'Loja BYD Sul', code: 'LJ02', store_type: 'dealership', dealership_id: 2, is_active: true },
      ]),
    })
  )

  // Notifications (needed by Header)
  await page.route('**/api/v1/notifications*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('**/api/v1/notifications/unread-count*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) })
  )

  // Disable real WebSocket connections
  await page.route('**/ws/**', (route) => route.abort())
  await page.route('**/api/v1/ws/**', (route) => route.abort())
}

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------
type AuthFixtures = {
  loginAsOwner: void
  loginAsSupervisor: void
  loginAsOperator: void
}

// ---------------------------------------------------------------------------
// Extended test with pre-authenticated fixtures
// ---------------------------------------------------------------------------
export const test = base.extend<AuthFixtures>({
  loginAsOwner: [
    async ({ page }, use) => {
      await mockCommonRoutes(page, 'owner')
      await injectAuthState(page, 'owner')
      await use()
    },
    { auto: false },
  ],

  loginAsSupervisor: [
    async ({ page }, use) => {
      await mockCommonRoutes(page, 'supervisor')
      await injectAuthState(page, 'supervisor')
      await use()
    },
    { auto: false },
  ],

  loginAsOperator: [
    async ({ page }, use) => {
      await mockCommonRoutes(page, 'operator')
      await injectAuthState(page, 'operator')
      await use()
    },
    { auto: false },
  ],
})

export { expect }
