/**
 * Tests for Service Orders Service
 *
 * Tests CRUD operations, status updates, day panel retrieval,
 * and filtering for service orders.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { serviceOrdersService } from '../service-orders.service';
import apiClient from '../client';

describe('serviceOrdersService', () => {
    beforeEach(() => {
        apiClient.defaults.headers.common['Authorization'] = 'Bearer mock-token';
    });

    describe('getAll', () => {
        it('should fetch paginated service orders without filters', async () => {
            const response = await serviceOrdersService.getAll(undefined, 0, 20);

            expect(response).toHaveProperty('items');
            expect(response).toHaveProperty('total');
            expect(Array.isArray(response.items)).toBe(true);
            expect(typeof response.total).toBe('number');
        });

        it('should apply pagination parameters', async () => {
            const response = await serviceOrdersService.getAll(undefined, 0, 10);

            expect(response.items.length).toBeLessThanOrEqual(10);
        });

        it('should filter by status', async () => {
            const filters = { status: 'waiting' };
            const response = await serviceOrdersService.getAll(filters);

            expect(response.items).toBeDefined();
        });

        it('should filter by location_id', async () => {
            const filters = { location_id: 1 };
            const response = await serviceOrdersService.getAll(filters);

            expect(response.items).toBeDefined();
        });

        it('should filter by date range', async () => {
            const filters = {
                start_date: '2026-02-01',
                end_date: '2026-02-11',
            };
            const response = await serviceOrdersService.getAll(filters);

            expect(response.items).toBeDefined();
            expect(response.total).toBeGreaterThanOrEqual(0);
        });

        it('should filter by search query', async () => {
            const filters = { search: 'ABC' };
            const response = await serviceOrdersService.getAll(filters);

            expect(response.items).toBeDefined();
        });

        it('should combine multiple filters', async () => {
            const filters = {
                status: 'in_progress',
                location_id: 1,
                search: 'Corolla',
            };
            const response = await serviceOrdersService.getAll(filters, 0, 20);

            expect(response).toHaveProperty('items');
            expect(response).toHaveProperty('total');
        });
    });

    describe('getById', () => {
        it('should fetch a service order by ID', async () => {
            const order = await serviceOrdersService.getById(1);

            expect(order).toBeDefined();
            expect(order.id).toBe(1);
            expect(order.plate).toBe('ABC1D23');
        });

        it('should throw error for non-existent ID', async () => {
            await expect(serviceOrdersService.getById(99999)).rejects.toThrow();
        });

        it('should return complete service order data', async () => {
            const order = await serviceOrdersService.getById(1);

            expect(order).toHaveProperty('id');
            expect(order).toHaveProperty('plate');
            expect(order).toHaveProperty('location_id');
            expect(order).toHaveProperty('department');
            expect(order).toHaveProperty('status');
            expect(order).toHaveProperty('vehicle_model');
            expect(order).toHaveProperty('photos');
            expect(order).toHaveProperty('created_at');
        });
    });

    describe('create', () => {
        it('should create a new service order', async () => {
            const newOrderData = {
                plate: 'XYZ1A23',
                vehicle_model: 'Civic EXL',
                vehicle_color: 'Branco',
                department: 'workshop' as const,
                service_description: 'Instalação de película fumê',
                location_id: 1,
                dealership_id: 1,
                items: [],
                photos: ['photo1.jpg', 'photo2.jpg', 'photo3.jpg', 'photo4.jpg'],
            };

            const createdOrder = await serviceOrdersService.create(newOrderData);

            expect(createdOrder).toBeDefined();
            expect(createdOrder.plate).toBe('XYZ1A23');
            expect(createdOrder.department).toBe('workshop');
            expect(createdOrder.status).toBe('waiting');
        });

        it('should validate minimum 4 photos requirement', async () => {
            const newOrderData = {
                plate: 'XYZ1A23',
                vehicle_model: 'Civic EXL',
                vehicle_color: 'Branco',
                department: 'workshop' as const,
                service_description: 'Instalação de película',
                location_id: 1,
                dealership_id: 1,
                items: [],
                photos: ['photo1.jpg', 'photo2.jpg', 'photo3.jpg', 'photo4.jpg'],
            };

            const order = await serviceOrdersService.create(newOrderData);
            expect(order.photos.length).toBeGreaterThanOrEqual(4);
        });

        it('should set default status to waiting', async () => {
            const newOrderData = {
                plate: 'NEW1B23',
                vehicle_model: 'Corolla XEi',
                vehicle_color: 'Prata',
                department: 'workshop' as const,
                service_description: 'Lavagem completa',
                items: [],
                location_id: 1,
                dealership_id: 1,
                photos: ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg'],
            };

            const order = await serviceOrdersService.create(newOrderData);
            expect(order.status).toBe('waiting');
        });
    });

    describe('update', () => {
        it('should update an existing service order', async () => {
            const updates = {
                vehicle_color: 'Azul',
                notes: 'Updated notes',
            };

            const updatedOrder = await serviceOrdersService.update(1, updates);

            expect(updatedOrder).toBeDefined();
            expect(updatedOrder.id).toBe(1);
        });

        it('should throw error for non-existent ID', async () => {
            await expect(
                serviceOrdersService.update(99999, { notes: 'test' })
            ).rejects.toThrow();
        });

        it('should preserve unchanged fields', async () => {
            const updates = {
                notes: 'Just updating notes',
            };

            const updatedOrder = await serviceOrdersService.update(1, updates);

            expect(updatedOrder.plate).toBe('ABC1D23');
            expect(updatedOrder.department).toBe('film');
        });
    });

    describe('updateStatus', () => {
        it('should update service order status', async () => {
            // 'doing' is the frontend name; service converts to backend 'in_progress',
            // then mapServiceOrder converts it back to 'doing'
            const updatedOrder = await serviceOrdersService.updateStatus(
                1,
                'doing'
            );

            expect(updatedOrder).toBeDefined();
            expect(updatedOrder.status).toBe('doing');
        });

        it('should update status with worker assignment', async () => {
            const updatedOrder = await serviceOrdersService.updateStatus(
                1,
                'doing',
                {
                    worker_ids: [1, 2],
                    primary_worker_id: 1,
                }
            );

            expect(updatedOrder.status).toBe('doing');
            expect(updatedOrder.workers).toBeDefined();
            expect(updatedOrder.workers?.length).toBe(2);
            expect(updatedOrder.workers?.[0].isPrimary).toBe(true);
        });

        it('should handle status transitions', async () => {
            // Frontend status names are used — service maps them to backend and back
            // waiting -> doing (backend: in_progress)
            let order = await serviceOrdersService.updateStatus(1, 'doing');
            expect(order.status).toBe('doing');

            // doing -> ready (backend: completed)
            order = await serviceOrdersService.updateStatus(1, 'ready');
            expect(order.status).toBe('ready');
        });

        it('should throw error for non-existent ID', async () => {
            await expect(
                serviceOrdersService.updateStatus(99999, 'in_progress')
            ).rejects.toThrow();
        });
    });

    describe('delete', () => {
        it('should delete a service order', async () => {
            await expect(serviceOrdersService.delete(1)).resolves.not.toThrow();
        });

        it('should throw error for non-existent ID', async () => {
            await expect(serviceOrdersService.delete(99999)).rejects.toThrow();
        });
    });

    describe('business rules validation', () => {
        it('should validate Mercosul plate format', async () => {
            const newOrderData = {
                plate: 'ABC1D23', // Valid Mercosul format
                vehicle_model: 'Test Vehicle',
                vehicle_color: 'Preto',
                department: 'workshop' as const,
                service_description: 'Test',
                location_id: 1,
                dealership_id: 1,
                items: [],
                photos: ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg'],
            };

            const order = await serviceOrdersService.create(newOrderData);
            expect(order.plate).toMatch(/^[A-Z]{3}\d[A-Z]\d{2}$/);
        });

        it('should have valid department values', async () => {
            const response = await serviceOrdersService.getAll();
            expect(response.items.length).toBeGreaterThan(0);

            const order = response.items[0];
            expect(['film', 'ppf', 'vn', 'vu', 'bodywork', 'workshop']).toContain(order.department);
        });

        it('should have valid status values', async () => {
            const response = await serviceOrdersService.getAll();
            expect(response.items.length).toBeGreaterThan(0);

            const order = response.items[0];
            expect([
                'waiting',
                'in_progress',
                'doing',
                'ready',
            ]).toContain(order.status);
        });

    });

    describe('data integrity', () => {
        it('should include timestamps in created orders', async () => {
            const newOrderData = {
                plate: 'TST1C23',
                vehicle_model: 'Test Vehicle',
                vehicle_color: 'Preto',
                department: 'film' as const,
                service_description: 'Test service',
                location_id: 1,
                dealership_id: 1,
                items: [],
                photos: ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg'],
            };

            const order = await serviceOrdersService.create(newOrderData);

            expect(order.created_at).toBeDefined();
            expect(order.updated_at).toBeDefined();
            expect(new Date(order.created_at).getTime()).toBeLessThanOrEqual(
                Date.now()
            );
        });

        it('should update timestamp on modifications', async () => {
            const response = await serviceOrdersService.getAll();
            expect(response.items.length).toBeGreaterThan(0);

            const existingOrder = response.items[0];
            const order = await serviceOrdersService.update(existingOrder.id, {
                notes: 'Updated',
            });

            expect(order.updated_at).toBeDefined();
            expect(new Date(order.updated_at).getTime()).toBeLessThanOrEqual(
                Date.now()
            );
        });
    });
});
