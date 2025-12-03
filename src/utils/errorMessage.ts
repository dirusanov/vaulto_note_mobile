export const getErrorMessage = (error: unknown, fallback = 'Something went wrong'): string => {
    if (typeof error === 'string') {
        return error;
    }

    if (error && typeof error === 'object') {
        const maybeError = error as any;
        const detail = maybeError?.response?.data?.detail;
        if (typeof detail === 'string' && detail.trim().length > 0) {
            return detail;
        }

        if (typeof maybeError?.message === 'string' && maybeError.message.trim().length > 0) {
            return maybeError.message;
        }
    }

    return fallback;
};
