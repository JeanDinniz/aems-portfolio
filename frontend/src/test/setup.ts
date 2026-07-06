import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { enableMocking, resetMocking, disableMocking } from '@/__mocks__/server';

// Enable MSW before all tests
beforeAll(() => {
    enableMocking();
});

// Reset handlers and cleanup after each test
afterEach(() => {
    resetMocking();
    cleanup();
    window.localStorage.clear();
});

// Disable MSW after all tests
afterAll(() => {
    disableMocking();
});

// Mock LocalStorage
const localStorageMock = (function () {
    let store: Record<string, string> = {};
    return {
        getItem: function (key: string) {
            return store[key] || null;
        },
        setItem: function (key: string, value: string) {
            store[key] = value.toString();
        },
        removeItem: function (key: string) {
            delete store[key];
        },
        clear: function () {
            store = {};
        },
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
});

// Mock ResizeObserver (required for Radix UI components)
globalThis.ResizeObserver = class ResizeObserver {
    observe() {
        // do nothing
    }
    unobserve() {
        // do nothing
    }
    disconnect() {
        // do nothing
    }
};

// Mock hasPointerCapture/setPointerCapture/releasePointerCapture (required for Radix UI Select)
if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => { };
}
if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => { };
}
