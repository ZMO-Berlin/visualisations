/**
 * Central error sink.
 *
 * Collects errors from explicit `handleError` calls plus the two global
 * failure channels (`error`, `unhandledrejection`), annotates them with
 * context, and fans them out to subscribers.
 */
export class ErrorManager {
    constructor() {
        this.listeners = new Set();
        this.onWindowError = event => this.handleError(event.error, { source: 'window.error' });
        this.onRejection = event => this.handleError(event.reason, { source: 'unhandledrejection' });
        this.setupGlobalHandlers();
    }

    setupGlobalHandlers() {
        window.addEventListener('error', this.onWindowError);
        window.addEventListener('unhandledrejection', this.onRejection);
    }

    handleError(error, context = {}) {
        const info = this.createErrorInfo(error, context);
        this.notifyListeners(info);
        this.logError(info);
        return info;
    }

    createErrorInfo(error, context) {
        // `error` may be any thrown value, not necessarily an Error instance.
        const isError = error instanceof Error;
        return {
            timestamp: new Date(),
            message: isError ? error.message : String(error ?? 'An unknown error occurred'),
            stack: isError ? error.stack : undefined,
            type: isError ? error.name : typeof error,
            context: {
                ...context,
                url: window.location.href
            }
        };
    }

    logError({ message, type, context, timestamp, stack }) {
        console.error('[ZMO]', message, { type, context, timestamp: timestamp.toISOString(), stack });
    }

    /** @returns {() => void} Unsubscribe function. */
    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notifyListeners(info) {
        this.listeners.forEach(listener => {
            try {
                listener(info);
            } catch (error) {
                console.error('[ZMO] error listener threw', error);
            }
        });
    }

    /**
     * Runs `fn`, reporting and re-throwing anything it throws. Re-throwing keeps
     * the caller's own error handling intact; the manager only observes.
     */
    wrapSync(fn, context = {}) {
        try {
            return fn();
        } catch (error) {
            this.handleError(error, context);
            throw error;
        }
    }

    /** Async counterpart to `wrapSync`. */
    async wrapAsync(fn, context = {}) {
        try {
            return await fn();
        } catch (error) {
            this.handleError(error, context);
            throw error;
        }
    }

    destroy() {
        window.removeEventListener('error', this.onWindowError);
        window.removeEventListener('unhandledrejection', this.onRejection);
        this.listeners.clear();
    }
}
