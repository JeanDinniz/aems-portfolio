/**
 * E2E — Authentication Flow
 *
 * Covers:
 *  1. Login page renders correctly
 *  2. Invalid credentials show error message
 *  3. Successful login redirects to /dashboard
 *  4. Unauthenticated access to /dashboard redirects to /login
 *  5. Logout clears state and redirects to /login
 *  6. must_change_password=true redirects to /change-password
 *
 * All API calls are intercepted with page.route() so the backend is not required.
 */

import { test, expect } from '@playwright/test'
import { MOCK_USERS, mockCommonRoutes } from './fixtures'

// ---------------------------------------------------------------------------
// Helper: build a successful login response
// ---------------------------------------------------------------------------
function buildLoginResponse(role: 'owner' | 'supervisor' | 'operator', mustChangePassword = false) {
  return {
    access_token: 'e2e_fake_access_token',
    refresh_token: 'e2e_fake_refresh_token',
    expires_in: 28800,
    must_change_password: mustChangePassword,
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
test.describe('Authentication Flow', () => {
  // =========================================================================
  // 1. Login form renders correctly
  // =========================================================================
  test('should display login form with all required fields', async ({ page }) => {
    await page.goto('/login')

    // Page title / heading
    await expect(page.getByText('AEMS Login')).toBeVisible()
    await expect(page.getByText('Auto Estética Management System')).toBeVisible()

    // Email field
    const emailInput = page.getByLabel('Email')
    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute('type', 'email')

    // Password field
    const passwordInput = page.getByLabel('Senha')
    await expect(passwordInput).toBeVisible()
    await expect(passwordInput).toHaveAttribute('type', 'password')

    // Submit button
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()

    // Forgot password link
    await expect(page.getByText('Esqueceu sua senha?')).toBeVisible()
  })

  // =========================================================================
  // 2. Invalid credentials show error
  // =========================================================================
  test('should show error message with invalid credentials', async ({ page }) => {
    // Mock login to return 401
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Credenciais inválidas' }),
      })
    )

    await page.goto('/login')

    await page.getByLabel('Email').fill('wrong@aems.com.br')
    await page.getByLabel('Senha').fill('WrongPassword!')
    await page.getByRole('button', { name: 'Entrar' }).click()

    // LoginForm sets a local error state on catch: "Falha no login. Verifique suas credenciais."
    await expect(
      page.getByText('Falha no login. Verifique suas credenciais.')
    ).toBeVisible({ timeout: 5000 })

    // Must still be on /login
    await expect(page).toHaveURL(/\/login/)
  })

  // =========================================================================
  // 3. Successful login redirects to /dashboard
  // =========================================================================
  test('should redirect to /dashboard after successful login as owner', async ({ page }) => {
    const ownerUser = MOCK_USERS.owner

    // Mock /auth/login — returns tokens
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildLoginResponse('owner')),
      })
    )

    // Mock /auth/me — called right after login to get user data
    await page.route('**/api/v1/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ownerUser),
      })
    )

    // Mock dashboard data so the page renders without errors
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

    await mockCommonRoutes(page, 'owner')
    await page.goto('/login')

    await page.getByLabel('Email').fill('owner@aems.com.br')
    await page.getByLabel('Senha').fill('Owner@2026!')
    await page.getByRole('button', { name: 'Entrar' }).click()

    // Should navigate to /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 8000 })
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  // =========================================================================
  // 4. Unauthenticated access redirects to /login
  // =========================================================================
  test('should redirect unauthenticated user from /dashboard to /login', async ({ page }) => {
    // Ensure no stored auth state
    await page.goto('/')
    await page.evaluate(() => localStorage.removeItem('aems-auth'))

    await page.goto('/dashboard')

    // ProtectedRoute detects isAuthenticated=false and navigates to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
  })

  // =========================================================================
  // 5. Logout clears state and redirects to /login
  // =========================================================================
  test('should logout and redirect to /login', async ({ page }) => {
    // Mock common routes and inject auth state
    await mockCommonRoutes(page, 'owner')

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

    // Navigate to root to set localStorage, then go to dashboard
    await page.goto('/')
    await page.evaluate(() => {
      const persistState = {
        state: {
          user: {
            id: 1,
            full_name: 'Arthur Owner',
            email: 'owner@aems.com.br',
            role: 'owner',
            is_active: true,
            must_change_password: false,
            store_id: null,
            supervised_store_ids: [],
          },
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
    })

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 })

    // Open user dropdown menu in the Header (avatar button)
    await page.getByRole('button', { name: /AO|Arthur/i }).first().click()

    // Click "Sair" inside the dropdown
    await page.getByRole('menuitem', { name: 'Sair' }).click()

    // Should land on /login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })

    // Verify localStorage was cleared
    const authState = await page.evaluate(() => localStorage.getItem('aems-auth'))
    const parsed = authState ? JSON.parse(authState) : null
    const isAuthenticated = parsed?.state?.isAuthenticated ?? false
    expect(isAuthenticated).toBe(false)
  })

  // =========================================================================
  // 6. must_change_password = true → redirect to /change-password
  // =========================================================================
  test('should redirect to /change-password when must_change_password is true', async ({ page }) => {
    const ownerUser = { ...MOCK_USERS.owner, must_change_password: true }

    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildLoginResponse('owner', true)),
      })
    )

    await page.route('**/api/v1/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ownerUser),
      })
    )

    await mockCommonRoutes(page, 'owner')
    await page.goto('/login')

    await page.getByLabel('Email').fill('owner@aems.com.br')
    await page.getByLabel('Senha').fill('Owner@2026!')
    await page.getByRole('button', { name: 'Entrar' }).click()

    // useAuth redirects to /change-password when must_change_password is true
    await expect(page).toHaveURL(/\/change-password/, { timeout: 8000 })
  })

  // =========================================================================
  // 7. Form validation: empty fields show error messages
  // =========================================================================
  test('should show validation errors when submitting empty form', async ({ page }) => {
    await page.goto('/login')

    // Click submit without filling anything
    await page.getByRole('button', { name: 'Entrar' }).click()

    // Zod resolvers emit these messages (defined in LoginForm loginSchema)
    await expect(page.getByText('Email inválido')).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('Senha é obrigatória')).toBeVisible({ timeout: 3000 })
  })
})
