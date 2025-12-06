export const getErrorMessage = (error: unknown, fallback = 'Something went wrong'): string => {
    if (typeof error === 'string') {
        return error;
    }

    if (error && typeof error === 'object') {
        const maybeError = error as any;
        let message = fallback;

        const detail = maybeError?.response?.data?.detail;
        if (typeof detail === 'string' && detail.trim().length > 0) {
            message = detail;
        } else if (typeof maybeError?.message === 'string' && maybeError.message.trim().length > 0) {
            message = maybeError.message;
        }

        // Append URL info if available (for debugging connection issues)
        if (maybeError?.config?.url) {
            const baseURL = maybeError?.config?.baseURL || '';
            const fullUrl = baseURL + maybeError.config.url;
            message += `\n(Target: ${fullUrl})`;
        }

        return message;
    }

    return fallback;
};
