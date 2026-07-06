import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { PermissionGuard } from '@/components/auth/PermissionGuard';
import { HomeRedirect } from '@/components/auth/HomeRedirect';
import { UnauthorizedPage } from '@/components/common/UnauthorizedPage';
import { Toaster } from '@/components/ui/toaster';

// Layouts
import { MainLayout } from '@/components/layout/MainLayout';
import { AuthLayout } from '@/components/layout/AuthLayout';

// Lazy-loaded pages
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const ChangePasswordPage = lazy(() => import('@/pages/auth/ChangePasswordPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const ProfilePage = lazy(() => import('@/pages/profile/ProfilePage').then(m => ({ default: m.ProfilePage })));
const ServiceOrdersPage = lazy(() => import('@/pages/service-orders/ServiceOrdersPage'));
const ServiceOrderDetailsPage = lazy(() => import('@/pages/service-orders/ServiceOrderDetailsPage'));
const EditServiceOrderPage = lazy(() => import('@/pages/service-orders/EditServiceOrderPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const UserManagementPage = lazy(() => import('@/pages/admin/UserManagementPage').then(m => ({ default: m.UserManagementPage })));
const ConsultantManagementPage = lazy(() => import('@/pages/admin/ConsultantManagementPage').then(m => ({ default: m.ConsultantManagementPage })));
const EmployeeManagementPage = lazy(() => import('@/pages/admin/EmployeeManagementPage').then(m => ({ default: m.EmployeeManagementPage })));
const FeriasPage = lazy(() => import('@/pages/admin/FeriasPage'));
const StoreManagementPage = lazy(() => import('@/pages/admin/StoreManagementPage').then(m => ({ default: m.StoreManagementPage })));
const VehicleModelsPage = lazy(() => import('@/pages/admin/VehicleModelsPage').then(m => ({ default: m.VehicleModelsPage })));
const BrandsManagementPage = lazy(() => import('@/pages/admin/BrandsManagementPage').then(m => ({ default: m.BrandsManagementPage })));
const AccessProfilesPage = lazy(() => import('@/pages/admin/AccessProfilesPage').then(m => ({ default: m.AccessProfilesPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));
const ServicesPage = lazy(() => import('@/pages/services/ServicesPage'));
const ConferencePage = lazy(() => import('@/pages/conference/ConferencePage').then(m => ({ default: m.ConferencePage })));
const FechamentoPage = lazy(() => import('@/pages/fechamento/FechamentoPage').then(m => ({ default: m.FechamentoPage })));
const InventoryPage = lazy(() => import('@/pages/inventory/InventoryPage'));
const FilmTypesPage = lazy(() => import('@/pages/admin/FilmTypesPage').then(m => ({ default: m.FilmTypesPage })));
const AuditPage = lazy(() => import('@/pages/admin/AuditPage').then(m => ({ default: m.AuditPage })));
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const SchedulingPage = lazy(() => import('@/pages/scheduling/SchedulingPage'));
const SuppliersPage = lazy(() => import('@/pages/admin/SuppliersPage').then(m => ({ default: m.SuppliersPage })));

const PageFallback = () => (
  <div className="flex items-center justify-center min-h-[200px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 2,
      retry: (failureCount, error) => {
        // Não retry em erros 4xx (client errors)
        if (error instanceof Error && 'status' in error) {
          const status = (error as { status: number }).status;
          if (status >= 400 && status < 500) return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

const router = createBrowserRouter([


  // Rotas públicas (Auth Layout)
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <Suspense fallback={<PageFallback />}><LoginPage /></Suspense> },
      { path: '/forgot-password', element: <Suspense fallback={<PageFallback />}><ForgotPasswordPage /></Suspense> },
      { path: '/change-password', element: <Suspense fallback={<PageFallback />}><ChangePasswordPage /></Suspense> },
    ],
  },

  // Rotas protegidas (autenticadas)
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          // Redirecionar raiz
          { path: '/', element: <HomeRedirect /> },

          // Rotas acessíveis por todos (autenticados)
          { path: '/profile', element: <Suspense fallback={<PageFallback />}><ProfilePage /></Suspense> },
          { path: '/settings', element: <Suspense fallback={<PageFallback />}><SettingsPage /></Suspense> },

          // Rotas operacionais e administrativas (owner + user com permissão)
          {
            element: <RoleGuard allowedRoles={['owner', 'user']} />,
            children: [
              {
                element: <PermissionGuard subModule="service_orders" />,
                children: [
                  { path: '/service-orders', element: <Suspense fallback={<PageFallback />}><ServiceOrdersPage /></Suspense> },
                  { path: '/service-orders/:id', element: <Suspense fallback={<PageFallback />}><ServiceOrderDetailsPage /></Suspense> },
                  { path: '/service-orders/:id/edit', element: <Suspense fallback={<PageFallback />}><EditServiceOrderPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="conference" />,
                children: [
                  { path: '/conference', element: <Suspense fallback={<PageFallback />}><ConferencePage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="fechamento" />,
                children: [
                  { path: '/fechamento', element: <Suspense fallback={<PageFallback />}><FechamentoPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="users" />,
                children: [
                  { path: '/admin/users', element: <Suspense fallback={<PageFallback />}><UserManagementPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="profiles" />,
                children: [
                  { path: '/admin/profiles', element: <Suspense fallback={<PageFallback />}><AccessProfilesPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="employees" />,
                children: [
                  { path: '/admin/employees', element: <Suspense fallback={<PageFallback />}><EmployeeManagementPage /></Suspense> },
                  { path: '/admin/ferias', element: <Suspense fallback={<PageFallback />}><FeriasPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="consultants" />,
                children: [
                  { path: '/admin/consultants', element: <Suspense fallback={<PageFallback />}><ConsultantManagementPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="stores" />,
                children: [
                  { path: '/admin/stores', element: <Suspense fallback={<PageFallback />}><StoreManagementPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="services" />,
                children: [
                  { path: '/servicos', element: <Suspense fallback={<PageFallback />}><ServicesPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="brands" />,
                children: [
                  { path: '/admin/marcas', element: <Suspense fallback={<PageFallback />}><BrandsManagementPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="models" />,
                children: [
                  { path: '/admin/modelos', element: <Suspense fallback={<PageFallback />}><VehicleModelsPage /></Suspense> },
                ],
              },
              {
                element: <RoleGuard allowedRoles={['owner']} allowGalponProfile />,
                children: [
                  { path: '/dashboard', element: <Suspense fallback={<PageFallback />}><DashboardPage /></Suspense> },
                ],
              },
              {
                element: <RoleGuard allowedRoles={['owner']} />,
                children: [
                  { path: '/admin/fornecedores', element: <Suspense fallback={<PageFallback />}><SuppliersPage /></Suspense> },
                ],
              },
              { path: '/analytics', element: <Navigate to="/dashboard" replace /> },
              {
                element: <PermissionGuard subModule="inventory" />,
                children: [
                  { path: '/estoque', element: <Suspense fallback={<PageFallback />}><InventoryPage /></Suspense> },
                ],
              },
              {
                element: <PermissionGuard subModule="scheduling" />,
                children: [
                  { path: '/scheduling', element: <Suspense fallback={<PageFallback />}><SchedulingPage /></Suspense> },
                ],
              },
              { path: '/admin/tipos-pelicula', element: <Suspense fallback={<PageFallback />}><FilmTypesPage /></Suspense> },
              { path: '/admin/auditoria', element: <Suspense fallback={<PageFallback />}><AuditPage /></Suspense> },
            ],
          },
        ],
      },
    ],
  },

  // Rotas de erro
  { path: '/unauthorized', element: <UnauthorizedPage /> },
  { path: '*', element: <Suspense fallback={<PageFallback />}><NotFoundPage /></Suspense> },
]);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
