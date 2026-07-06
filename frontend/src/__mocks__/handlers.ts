/**
 * MSW Handlers - Mock API responses for testing
 *
 * Provides mock responses for all AEMS backend API endpoints.
 * Based on the actual FastAPI backend specification.
 */

import { http, HttpResponse } from 'msw';
import type { LoginResponse, User } from '@/types/auth.types';
import type { ServiceOrder, ServiceOrderStatus } from '@/types/service-order.types';

const VITE_API_URL = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : 'http://localhost:8000';
const API_URL = `${VITE_API_URL}/api/v1`;

// Mock Data
export const mockUser: User = {
    id: 1,
    full_name: 'Test User',
    email: 'test@example.com',
    role: 'user',
    is_active: true,
    must_change_password: false,
    store_id: 1,
    store_name: 'Toyota Unidade 01',
    supervised_store_ids: [],
    phone: '11999999999',
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
};

export const mockSupervisor: User = {
    ...mockUser,
    id: 2,
    full_name: 'Supervisor User',
    email: 'supervisor@example.com',
    role: 'user',
    supervised_store_ids: [1, 2],
};

export const mockOwner: User = {
    ...mockUser,
    id: 3,
    full_name: 'Owner User',
    email: 'owner@example.com',
    role: 'owner',
    store_id: undefined,
    supervised_store_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

export const mockTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresIn: 28800, // 8 hours
};

export const mockLoginResponse: LoginResponse = {
    user: mockUser,
    tokens: mockTokens,
    must_change_password: false,
};

export const mockServiceOrders: ServiceOrder[] = [
    {
        id: 1,
        order_number: 'OS-2602-001',
        plate: 'ABC1D23',
        vehicle_model: 'Corolla XEi',
        vehicle_color: 'Prata',
        department: 'film',
        service_type: 'Instalação Película',
        service_description: 'Instalação de película fumê 35% nos vidros laterais e traseiro',
        status: 'waiting',
        entry_time: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        technician_id: null,
        technician_name: null,
        consultant_id: 1,
        consultant_name: 'Carlos Vendedor',
        workers: [],
        photos: ['photo1.jpg', 'photo2.jpg', 'photo3.jpg', 'photo4.jpg'],
        damage_map: null,
        damage_photos: [],
        invoice_number: null,
        location_id: 1,
        location_name: 'Toyota Unidade 01',
        dealership_id: 1,
        dealership_name: 'Toyota Centro',
        is_galpon: false,
        is_return: false,
        is_courtesy: false,
        notes: null,
        service_date: null,
        is_verified: false,
        verified_at: null,
        elapsed_minutes: 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    },
    {
        id: 2,
        order_number: 'OS-2602-002',
        plate: 'XYZ9W87',
        vehicle_model: 'Civic EXL',
        vehicle_color: 'Preto',
        department: 'workshop',
        service_type: 'Estética Completa',
        service_description: 'Lavagem completa + polimento + cristalização',
        status: 'doing',
        entry_time: new Date(Date.now() - 3600000).toISOString(),
        started_at: new Date(Date.now() - 1800000).toISOString(),
        completed_at: null,
        technician_id: 1,
        technician_name: 'José Técnico',
        consultant_id: 2,
        consultant_name: 'Ana Vendedora',
        workers: [
            { id: 1, employee_id: 1, name: 'José Técnico', isPrimary: true },
            { id: 2, employee_id: 2, name: 'Pedro Auxiliar', isPrimary: false },
        ],
        photos: ['photo1.jpg', 'photo2.jpg', 'photo3.jpg', 'photo4.jpg'],
        damage_map: null,
        damage_photos: [],
        invoice_number: null,
        location_id: 1,
        location_name: 'Toyota Unidade 01',
        dealership_id: 1,
        dealership_name: 'Toyota Centro',
        is_galpon: false,
        is_return: false,
        is_courtesy: false,
        notes: 'Cliente pediu atenção especial no polimento',
        service_date: null,
        is_verified: false,
        verified_at: null,
        elapsed_minutes: 60,
        created_at: new Date(Date.now() - 3600000).toISOString(),
        updated_at: new Date().toISOString(),
    },
];

// Handlers
export const handlers = [
    // ============ AUTH ============
    http.post(`${API_URL}/auth/login`, async ({ request }) => {
        const formData = await request.formData();
        const username = formData.get('username') as string;
        const password = formData.get('password') as string;

        if (username === 'test@example.com' && password === 'password123') {
            return HttpResponse.json({
                access_token: mockTokens.accessToken,
                refresh_token: mockTokens.refreshToken,
                expires_in: mockTokens.expiresIn,
                must_change_password: false,
            });
        }

        if (username === 'supervisor@example.com' && password === 'password123') {
            return HttpResponse.json({
                access_token: 'supervisor-token',
                refresh_token: 'supervisor-refresh',
                expires_in: 28800,
                must_change_password: false,
            });
        }

        return HttpResponse.json(
            { detail: 'Invalid credentials' },
            { status: 401 }
        );
    }),

    http.get(`${API_URL}/auth/me`, ({ request }) => {
        const authHeader = request.headers.get('Authorization');

        if (!authHeader) {
            return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
        }

        if (authHeader.includes('supervisor-token')) {
            return HttpResponse.json(mockSupervisor);
        }

        return HttpResponse.json(mockUser);
    }),

    http.post(`${API_URL}/auth/logout`, () => {
        return HttpResponse.json({ message: 'Logged out successfully' });
    }),

    http.post(`${API_URL}/auth/refresh`, async ({ request }) => {
        const body = await request.json() as { refresh_token?: string; refreshToken?: string };

        if ((body.refresh_token || body.refreshToken) === mockTokens.refreshToken) {
            return HttpResponse.json({
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
                expires_in: 28800,
                must_change_password: false,
            });
        }

        return HttpResponse.json(
            { detail: 'Invalid refresh token' },
            { status: 401 }
        );
    }),

    http.post(`${API_URL}/auth/forgot-password`, () => {
        return HttpResponse.json({ message: 'Password reset email sent' });
    }),

    http.post(`${API_URL}/auth/reset-password`, () => {
        return HttpResponse.json({ message: 'Password reset successful' });
    }),

    http.post(`${API_URL}/auth/change-password`, () => {
        return HttpResponse.json({ message: 'Password changed successfully' });
    }),

    http.patch(`${API_URL}/auth/profile`, async ({ request }) => {
        const body = await request.json() as Partial<User>;
        return HttpResponse.json({ ...mockUser, ...body });
    }),

    // ============ SERVICE ORDERS ============
    http.get(`${API_URL}/service-orders`, ({ request }) => {
        const url = new URL(request.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const skip = (page - 1) * limit;

        return HttpResponse.json({
            items: mockServiceOrders.slice(skip, skip + limit),
            pagination: { total: mockServiceOrders.length },
        });
    }),

    http.get(`${API_URL}/service-orders/:id`, ({ params }) => {
        const id = parseInt(params.id as string);
        const order = mockServiceOrders.find(o => o.id === id);

        if (!order) {
            return HttpResponse.json(
                { detail: 'Service order not found' },
                { status: 404 }
            );
        }

        return HttpResponse.json(order);
    }),

    http.post(`${API_URL}/service-orders`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        const newOrder: ServiceOrder = {
            id: mockServiceOrders.length + 1,
            order_number: `OS-2602-${String(mockServiceOrders.length + 1).padStart(3, '0')}`,
            plate: body.plate as string,
            vehicle_model: body.vehicle_model as string || '',
            vehicle_color: body.vehicle_color as string || '',
            department: body.department as ServiceOrder['department'],
            service_type: body.service_type as string || '',
            service_description: body.service_description as string || '',
            items: (body.items as Array<{ service_id: number; quantity: number; notes?: string }>)?.map(item => ({
                service_id: item.service_id,
                quantity: item.quantity,
                notes: item.notes
            })) || [],
            status: 'waiting',
            entry_time: new Date().toISOString(),
            started_at: null,
            completed_at: null,
            technician_id: body.technician_id as number || null,
            technician_name: null,
            consultant_id: body.consultant_id as number || null,
            consultant_name: null,
            workers: [],
            photos: body.photos as string[] || [],
            damage_map: body.damage_map as string || null,
            invoice_number: body.invoice_number as string || null,
            location_id: body.location_id as number,
            location_name: 'Toyota Unidade 01',
            dealership_id: body.dealership_id as number,
            dealership_name: 'Concessionária',
            is_galpon: body.is_galpon as boolean ?? false,
            is_return: false,
            is_courtesy: false,
            damage_photos: [],
            notes: body.notes as string || null,
            service_date: body.service_date as string || null,
            is_verified: false,
            verified_at: null,
            elapsed_minutes: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        mockServiceOrders.push(newOrder);
        return HttpResponse.json(newOrder, { status: 201 });
    }),

    http.put(`${API_URL}/service-orders/:id`, async ({ params, request }) => {
        const id = parseInt(params.id as string);
        const body = await request.json() as Partial<ServiceOrder>;
        const index = mockServiceOrders.findIndex(o => o.id === id);

        if (index === -1) {
            return HttpResponse.json(
                { detail: 'Service order not found' },
                { status: 404 }
            );
        }

        mockServiceOrders[index] = {
            ...mockServiceOrders[index],
            ...body,
            updated_at: new Date().toISOString(),
        };

        return HttpResponse.json(mockServiceOrders[index]);
    }),

    http.patch(`${API_URL}/service-orders/:id`, async ({ params, request }) => {
        const id = parseInt(params.id as string);
        const body = await request.json() as Partial<ServiceOrder>;
        const index = mockServiceOrders.findIndex(o => o.id === id);

        if (index === -1) {
            return HttpResponse.json(
                { detail: 'Service order not found' },
                { status: 404 }
            );
        }

        mockServiceOrders[index] = {
            ...mockServiceOrders[index],
            ...body,
            updated_at: new Date().toISOString(),
        };

        return HttpResponse.json(mockServiceOrders[index]);
    }),

    http.patch(`${API_URL}/service-orders/:id/status`, async ({ params, request }) => {
        const id = parseInt(params.id as string);
        const body = await request.json() as { new_status?: string; status?: ServiceOrderStatus; worker_ids?: number[]; primary_worker_id?: number };
        const index = mockServiceOrders.findIndex(o => o.id === id);

        if (index === -1) {
            return HttpResponse.json(
                { detail: 'Service order not found' },
                { status: 404 }
            );
        }

        const newStatus = (body.new_status || body.status) as ServiceOrderStatus;

        // Convert worker_ids to workers array if provided
        const workers = body.worker_ids?.map(workerId => ({
            id: workerId,
            employee_id: workerId,
            name: `Worker ${workerId}`,
            isPrimary: workerId === body.primary_worker_id,
        }));

        mockServiceOrders[index] = {
            ...mockServiceOrders[index],
            status: newStatus,
            workers: workers || mockServiceOrders[index].workers,
            updated_at: new Date().toISOString(),
        };

        return HttpResponse.json(mockServiceOrders[index]);
    }),

    http.delete(`${API_URL}/service-orders/:id`, ({ params }) => {
        const id = parseInt(params.id as string);
        const index = mockServiceOrders.findIndex(o => o.id === id);

        if (index === -1) {
            return HttpResponse.json(
                { detail: 'Service order not found' },
                { status: 404 }
            );
        }

        mockServiceOrders.splice(index, 1);
        return HttpResponse.json(null, { status: 204 });
    }),

    // ============ CONSULTANTS ============
    http.get(`${API_URL}/consultants`, ({ request }) => {
        const url = new URL(request.url);
        const skip = parseInt(url.searchParams.get('skip') || '0');
        const limit = parseInt(url.searchParams.get('limit') || '20');

        const mockConsultants = [
            {
                id: 1,
                name: 'Carlos Vendedor',
                store_id: 1,
                store_name: 'Toyota Unidade 01',
                dealership_id: 1,
                dealership_name: 'Toyota Centro',
                phone: '11987654321',
                email: 'carlos@toyota.com',
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
            {
                id: 2,
                name: 'Ana Vendedora',
                store_id: 1,
                store_name: 'Toyota Unidade 01',
                dealership_id: 1,
                dealership_name: 'Toyota Centro',
                phone: '11976543210',
                email: 'ana@toyota.com',
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
            {
                id: 3,
                name: 'Pedro Consultor',
                store_id: 2,
                store_name: 'Toyota Unidade 02',
                dealership_id: 2,
                dealership_name: 'Toyota Zona Norte',
                phone: '11965432100',
                email: 'pedro@toyota.com',
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
        ];

        return HttpResponse.json({
            items: mockConsultants.slice(skip, skip + limit),
            total: mockConsultants.length,
        });
    }),

    http.get(`${API_URL}/consultants/:id`, ({ params }) => {
        const id = parseInt(params.id as string);

        const mockConsultant = {
            id,
            name: 'Carlos Vendedor',
            store_id: 1,
            store_name: 'Toyota Unidade 01',
            dealership_id: 1,
            dealership_name: 'Toyota Centro',
            phone: '11987654321',
            email: 'carlos@toyota.com',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        return HttpResponse.json(mockConsultant);
    }),

    http.post(`${API_URL}/consultants`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;

        const newConsultant = {
            id: 999,
            name: body.name as string,
            store_id: body.store_id as number,
            store_name: 'Toyota Unidade 01',
            dealership_id: body.dealership_id as number,
            dealership_name: 'Toyota Centro',
            phone: body.phone as string || null,
            email: body.email as string || null,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        return HttpResponse.json(newConsultant, { status: 201 });
    }),

    http.patch(`${API_URL}/consultants/:id`, async ({ params, request }) => {
        const id = parseInt(params.id as string);
        const body = await request.json() as Record<string, unknown>;

        const updated = {
            id,
            name: body.name as string || 'Carlos Vendedor',
            store_id: body.store_id as number || 1,
            store_name: 'Toyota Unidade 01',
            dealership_id: 1,
            dealership_name: 'Toyota Centro',
            phone: body.phone as string || null,
            email: body.email as string || null,
            is_active: body.is_active !== undefined ? body.is_active as boolean : true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        return HttpResponse.json(updated);
    }),

    http.delete(`${API_URL}/consultants/:id`, () => {
        return HttpResponse.json(null, { status: 204 });
    }),

    // ============ DEALERSHIPS ============
    http.get(`${API_URL}/dealerships`, ({ request }) => {
        const url = new URL(request.url);
        const storeId = url.searchParams.get('store_id');

        const allDealerships = [
            { id: 1, name: 'Toyota Centro', brand: 'Toyota', store_id: 1, store_name: 'Toyota Unidade 01', is_active: true, created_at: new Date().toISOString() },
            { id: 2, name: 'Toyota Zona Norte', brand: 'Toyota', store_id: 2, store_name: 'Toyota Unidade 02', is_active: true, created_at: new Date().toISOString() },
            { id: 3, name: 'BYD Premium', brand: 'BYD', store_id: 4, store_name: 'BYD Unidade 04', is_active: true, created_at: new Date().toISOString() },
            { id: 4, name: 'Hyundai Unidade 09', brand: 'Hyundai', store_id: 9, store_name: 'Hyundai Unidade 09', is_active: true, created_at: new Date().toISOString() },
        ];

        const filtered = storeId
            ? allDealerships.filter(d => d.store_id === parseInt(storeId))
            : allDealerships;

        return HttpResponse.json({
            items: filtered,
            total: filtered.length,
        });
    }),

    // ============ USERS ============
    http.get(`${API_URL}/users`, () => {
        return HttpResponse.json({
            items: [mockUser, mockSupervisor, mockOwner],
            total: 3,
        });
    }),

    http.get(`${API_URL}/users/:id`, ({ params }) => {
        const id = parseInt(params.id as string);
        const users = [mockUser, mockSupervisor, mockOwner];
        const user = users.find(u => u.id === id);

        if (!user) {
            return HttpResponse.json(
                { detail: 'User not found' },
                { status: 404 }
            );
        }

        return HttpResponse.json(user);
    }),

    http.post(`${API_URL}/users`, async ({ request }) => {
        const body = await request.json() as Partial<User>;
        const newUser: User = {
            id: 4,
            full_name: body.full_name || '',
            email: body.email || '',
            role: body.role || 'user',
            is_active: true,
            must_change_password: true,
            store_id: body.store_id || null,
            store_name: body.store_name || null,
            supervised_store_ids: body.supervised_store_ids || [],
            phone: body.phone || null,
            last_login: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        return HttpResponse.json(newUser, { status: 201 });
    }),

    http.patch(`${API_URL}/users/:id`, async ({ params, request }) => {
        const id = parseInt(params.id as string);
        const body = await request.json() as Partial<User>;

        return HttpResponse.json({
            ...mockUser,
            id,
            ...body,
            updated_at: new Date().toISOString(),
        });
    }),

    http.delete(`${API_URL}/users/:id`, () => {
        return HttpResponse.json(null, { status: 204 });
    }),

    http.post(`${API_URL}/users/:id/activate`, ({ params }) => {
        const id = parseInt(params.id as string);
        return HttpResponse.json({
            ...mockUser,
            id,
            is_active: true,
            updated_at: new Date().toISOString(),
        });
    }),

    http.post(`${API_URL}/users/:id/reset-password`, () => {
        return HttpResponse.json({
            temporary_password: 'Temp123!@#',
        });
    }),

    // ============ STORES ============
    http.get(`${API_URL}/stores`, () => {
        return HttpResponse.json({
            items: [
                { id: 1, code: 'LJ01', name: 'Toyota Unidade 01', is_active: true, store_type: 'dealership', dealership_id: 1 },
                { id: 2, code: 'LJ02', name: 'Toyota Unidade 02', is_active: true, store_type: 'dealership', dealership_id: 2 },
                { id: 3, code: 'LJ03', name: 'Toyota Unidade 03', is_active: true, store_type: 'dealership', dealership_id: 1 },
                { id: 4, code: 'LJ04', name: 'BYD Unidade 04', is_active: true, store_type: 'dealership', dealership_id: 3 },
                { id: 5, code: 'LJ05', name: 'BYD Unidade 05', is_active: true, store_type: 'dealership', dealership_id: 3 },
                { id: 6, code: 'LJ06', name: 'BYD Unidade 06', is_active: true, store_type: 'dealership', dealership_id: 3 },
                { id: 7, code: 'LJ07', name: 'BYD Unidade 07', is_active: true, store_type: 'dealership', dealership_id: 3 },
                { id: 8, code: 'LJ08', name: 'BYD Unidade 08', is_active: true, store_type: 'dealership', dealership_id: 3 },
                { id: 9, code: 'LJ09', name: 'Hyundai Unidade 09', is_active: true, store_type: 'dealership', dealership_id: 4 },
                { id: 10, code: 'LJ10', name: 'Hyundai Unidade 10', is_active: true, store_type: 'dealership', dealership_id: 4 },
                { id: 11, code: 'LJ11', name: 'Fiat Unidade 11', is_active: true, store_type: 'dealership', dealership_id: 1 },
                { id: 12, code: 'LJ12', name: 'Fiat Unidade 12', is_active: true, store_type: 'dealership', dealership_id: 1 },
            ],
            total: 12,
        });
    }),
];
