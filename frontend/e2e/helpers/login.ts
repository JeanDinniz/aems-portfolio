import type { Page } from '@playwright/test'
import { MOCK_USERS, mockCommonRoutes } from '../fixtures'

// ---------------------------------------------------------------------------
// mockLogin
//
// Injects a fake auth state into localStorage so the app considers the user
// already authenticated.  This avoids any real network call to the backend
// and is ideal for E2E tests that want to exercise page logic without a
// running API server.
//
// Usage:
//   await mockLogin(page, 'operator')
//   await page.goto('/service-orders')
// ---------------------------------------------------------------------------
export async function mockLogin(page: Page, role: 'owner' | 'supervisor' | 'operator') {
  const user = MOCK_USERS[role]
  const tokens = {
    accessToken: 'e2e_fake_access_token',
    refreshToken: 'e2e_fake_refresh_token',
    expiresIn: 28800,
  }

  // Set up common route mocks before navigating so requests are intercepted
  await mockCommonRoutes(page, role)

  // Navigate to the root page first so we have a document context for
  // localStorage manipulation.
  await page.goto('/')

  await page.evaluate(
    ({ user, tokens }) => {
      // Zustand persist stores the state under the 'name' defined in persist().
      // In auth.store.ts: name: 'aems-auth'
      const persistState = {
        state: {
          user,
          tokens,
          isAuthenticated: true,
        },
        version: 0,
      }
      localStorage.setItem('aems-auth', JSON.stringify(persistState))
    },
    { user, tokens }
  )
}

// ---------------------------------------------------------------------------
// mockLoginWithMustChangePassword
//
// Same as mockLogin but sets must_change_password: true so the app should
// redirect to /change-password after loading.
// ---------------------------------------------------------------------------
export async function mockLoginWithMustChangePassword(
  page: Page,
  role: 'owner' | 'supervisor' | 'operator'
) {
  const user = { ...MOCK_USERS[role], must_change_password: true }
  const tokens = {
    accessToken: 'e2e_fake_access_token',
    refreshToken: 'e2e_fake_refresh_token',
    expiresIn: 28800,
  }

  await mockCommonRoutes(page, role)
  await page.goto('/')

  await page.evaluate(
    ({ user, tokens }) => {
      const persistState = {
        state: {
          user,
          tokens,
          isAuthenticated: true,
        },
        version: 0,
      }
      localStorage.setItem('aems-auth', JSON.stringify(persistState))
    },
    { user, tokens }
  )
}

// ---------------------------------------------------------------------------
// clearAuth
//
// Clears authentication state from localStorage so the user is logged out.
// ---------------------------------------------------------------------------
export async function clearAuth(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('aems-auth')
  })
}
