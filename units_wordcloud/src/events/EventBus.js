/**
 * Minimal async publish/subscribe bus.
 *
 * Handlers may return promises; `emit()` awaits them in priority order so that
 * callers can rely on all side effects having settled. Handler and middleware
 * failures are reported to the ErrorManager and never abort the emit loop —
 * one broken listener must not take down the rest of the UI.
 */
export class EventBus {
    /**
     * @param {object} deps
     * @param {import('../utils/ErrorManager.js').ErrorManager} deps.errorManager
     */
    constructor({ errorManager }) {
        if (!errorManager) {
            throw new Error('EventBus: errorManager is required');
        }
        this.errorManager = errorManager;
        this.events = new Map();
        this.middlewares = [];
    }

    /** Registers a middleware `(eventType, data) => data`. Chainable. */
    use(middleware) {
        this.middlewares.push(middleware);
        return this;
    }

    /**
     * Subscribes to an event.
     * @returns {() => void} Unsubscribe function. Callers are expected to keep
     *   this and invoke it on teardown.
     */
    on(eventType, callback, options = {}) {
        this.validateEventType(eventType);
        if (typeof callback !== 'function') {
            throw new Error(`EventBus: handler for "${eventType}" must be a function`);
        }

        if (!this.events.has(eventType)) {
            this.events.set(eventType, new Set());
        }

        const handler = {
            callback,
            once: options.once || false,
            priority: options.priority || 0
        };

        const handlers = this.events.get(eventType);
        handlers.add(handler);

        return () => handlers.delete(handler);
    }

    once(eventType, callback) {
        return this.on(eventType, callback, { once: true });
    }

    /**
     * Removes a specific handler, or every handler for `eventType` when
     * `callback` is omitted.
     */
    off(eventType, callback) {
        this.validateEventType(eventType);

        const handlers = this.events.get(eventType);
        if (!handlers) return;

        if (callback === undefined) {
            this.events.delete(eventType);
            return;
        }

        for (const handler of handlers) {
            if (handler.callback === callback) {
                handlers.delete(handler);
                break;
            }
        }
    }

    async emit(eventType, data = {}) {
        this.validateEventType(eventType);

        // Middleware runs before the subscriber check, not after: logging and
        // payload validation are properties of the event itself. Skipping them
        // when nothing happens to be listening would mean a malformed payload
        // passes silently today and only fails once a subscriber is added.
        let eventData = { ...data };
        for (const middleware of this.middlewares) {
            try {
                eventData = await middleware(eventType, eventData);
            } catch (error) {
                this.errorManager.handleError(error, {
                    component: 'EventBus',
                    method: 'emit',
                    eventType,
                    phase: 'middleware'
                });
                // A rejected middleware means the payload failed validation;
                // dropping the event is safer than running handlers on it.
                return;
            }
        }

        const handlers = this.events.get(eventType);
        if (!handlers || handlers.size === 0) {
            return;
        }

        // Snapshot before iterating: handlers may subscribe or unsubscribe.
        const ordered = Array.from(handlers).sort((a, b) => b.priority - a.priority);

        for (const handler of ordered) {
            if (handler.once) {
                handlers.delete(handler);
            }
            try {
                await handler.callback(eventData);
            } catch (error) {
                this.errorManager.handleError(error, {
                    component: 'EventBus',
                    method: 'emit',
                    eventType,
                    phase: 'handler'
                });
            }
        }
    }

    validateEventType(eventType) {
        if (!eventType || typeof eventType !== 'string') {
            throw new Error('EventBus: event type must be a non-empty string');
        }
    }

    clear() {
        this.events.clear();
        this.middlewares = [];
    }

    destroy() {
        this.clear();
    }
}
