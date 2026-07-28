/**
 * Builds an event-logging middleware.
 *
 * Logging is opt-in (`config.debug`) so production pages stay quiet. High-volume
 * layout and animation events are filtered out even when debugging.
 */
export function createLoggerMiddleware({ enabled = false } = {}) {
    const noisyPrefixes = ['layout:', 'animation:'];

    return (eventType, data) => {
        if (enabled && !noisyPrefixes.some(prefix => eventType.startsWith(prefix))) {
            console.debug(`[ZMO event] ${eventType}`, data);
        }
        return data;
    };
}
