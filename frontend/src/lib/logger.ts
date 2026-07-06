const isDev = import.meta.env.DEV;

export const logger = {
    error: (message: string | unknown, error?: unknown) => {
        if (!isDev) return;
        if (error !== undefined) {
            console.error(message, error);
        } else {
            console.error(message);
        }
    },
    warn: (message: string, data?: unknown) => {
        if (!isDev) return;
        if (data !== undefined) {
            console.warn(message, data);
        } else {
            console.warn(message);
        }
    },
};
