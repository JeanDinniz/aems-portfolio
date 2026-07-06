/**
 * MSW Server Setup for Testing
 *
 * Creates a mock server instance for use in Node.js test environment (Vitest).
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);

// Enable API mocking before tests
export function enableMocking() {
    server.listen({
        onUnhandledRequest: 'warn',
    });
}

// Reset handlers after each test
export function resetMocking() {
    server.resetHandlers();
}

// Disable API mocking after tests
export function disableMocking() {
    server.close();
}
