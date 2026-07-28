/**
 * Tracks the usable (padding-excluded) size of a container and notifies
 * subscribers when it changes.
 */
export class DimensionManager {
    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {import('../config/ConfigManager.js').ConfigManager} deps.config
     * @param {number} [deps.debounceMs] Delay applied to window-level events.
     */
    constructor(container, { config, debounceMs = 250 }) {
        this.container = container;
        this.config = config;
        this.observers = new Set();

        this.dimensions = {
            width: config.get('wordcloud.dimensions.width'),
            height: config.get('wordcloud.dimensions.height')
        };

        // Keep one stable reference per listener: removeEventListener compares
        // by identity, so registering a freshly-created debounced wrapper and
        // later passing the raw method — as this class previously did — leaves
        // the listener attached for the lifetime of the page.
        this.onResize = DimensionManager.debounce(() => this.measure(), debounceMs);

        this.setupObservers();
    }

    setupObservers() {
        // ResizeObserver catches layout-driven changes the window events miss
        // (e.g. the word list collapsing at a breakpoint).
        this.resizeObserver = new ResizeObserver(() => this.measure());
        this.resizeObserver.observe(this.container);

        window.addEventListener('resize', this.onResize);
        window.addEventListener('orientationchange', this.onResize);
    }

    measure() {
        const rect = this.container.getBoundingClientRect();
        const style = window.getComputedStyle(this.container);

        const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

        const next = {
            width: Math.max(rect.width - paddingX, 0),
            height: Math.max(rect.height - paddingY, 0)
        };

        if (next.width === 0 || next.height === 0) {
            return; // container is hidden or not laid out yet
        }

        if (next.width !== this.dimensions.width || next.height !== this.dimensions.height) {
            this.dimensions = next;
            this.notifyObservers();
        }
    }

    /**
     * Subscribes to size changes. The callback fires immediately with the
     * current size so callers do not need a separate priming step.
     * @returns {() => void} Unsubscribe function.
     */
    subscribe(callback) {
        this.observers.add(callback);
        callback(this.getDimensions());
        return () => this.observers.delete(callback);
    }

    notifyObservers() {
        const dimensions = this.getDimensions();
        [...this.observers].forEach(callback => callback(dimensions));
    }

    getDimensions() {
        return { ...this.dimensions };
    }

    static debounce(fn, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), wait);
        };
    }

    destroy() {
        this.resizeObserver?.disconnect();
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('orientationchange', this.onResize);
        this.observers.clear();
    }
}
