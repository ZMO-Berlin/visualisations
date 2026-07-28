/**
 * Central, read-mostly configuration for the word cloud application.
 *
 * A single instance is created in `main.js` and injected into every component
 * that needs it. It is deliberately *not* a singleton: keeping construction in
 * one place makes the dependency graph explicit and keeps the app testable.
 */
export class ConfigManager {
    /**
     * @param {object} [overrides] Partial config merged over the defaults,
     *   using the same shape as `defaults()`.
     */
    constructor(overrides = {}) {
        this.config = ConfigManager.merge(ConfigManager.defaults(), overrides);
    }

    static defaults() {
        return {
            wordcloud: {
                dimensions: {
                    width: 1000,
                    height: 800,
                    // Upper bound on a word's font size, as a fraction of the
                    // cloud height. Recomputed by `updateDimensions()`.
                    maxFontSizeRatio: 8
                },
                font: {
                    family: {
                        primary: 'Muli',
                        fallback: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'
                    },
                    size: {
                        min: 10,
                        max: null,      // derived from height via updateDimensions()
                        scaleFactor: 5  // larger => smaller words for a given area
                    },
                    weight: {
                        normal: 400,
                        bold: 400
                    }
                },
                layout: {
                    padding: 8,
                    rotations: [0, 90],
                    rotationProbability: 0.5
                },
                animation: {
                    duration: 200,
                    scaleOnHover: 1.2
                },
                export: {
                    scale: 2,
                    format: 'png',
                    filename: 'word_cloud'
                },
                colors: {
                    // 'frequency' | 'random' | 'fixed'
                    colorAssignment: 'frequency',
                    schemeSize: 10,
                    opacity: {
                        normal: 1,
                        hover: 0.8
                    },
                    transition: {
                        duration: 200
                    }
                }
            },
            data: {
                minWords: 10,
                maxWords: 100,
                defaultWordCount: 75,
                defaultGroup: 'combined',
                // Font sizes are normalised into this range before layout.
                normalizedSize: {
                    min: 10,
                    max: 100
                }
            },
            groups: {
                items: [
                    { value: 'combined', labelKey: 'allUnits' },
                    { value: 'State_Society', label: 'State and Society' },
                    { value: 'Lives_Ecologies', label: 'Lives and Ecologies' },
                    { value: 'Religion-Intellectual-Culture', label: 'Religion and Intellectual Culture' }
                ]
            },
            /** Emit verbose event logs to the console. */
            debug: false
        };
    }

    /** Deep-merges plain objects; arrays and primitives are replaced wholesale. */
    static merge(base, override) {
        const result = { ...base };
        for (const [key, value] of Object.entries(override)) {
            const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
            result[key] = isPlainObject(value) && isPlainObject(base[key])
                ? ConfigManager.merge(base[key], value)
                : value;
        }
        return result;
    }

    /** Reads a dotted path, e.g. `get('wordcloud.dimensions.width')`. */
    get(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this.config);
    }

    /** Writes a dotted path, creating intermediate objects as needed. */
    set(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, key) => (obj[key] = obj[key] || {}), this.config);
        target[lastKey] = value;
    }

    getUnits() {
        return [...this.config.groups.items];
    }

    calculateMaxFontSize(height) {
        return height / this.config.wordcloud.dimensions.maxFontSizeRatio;
    }

    updateDimensions(width, height) {
        this.set('wordcloud.dimensions.width', width);
        this.set('wordcloud.dimensions.height', height);
        this.set('wordcloud.font.size.max', this.calculateMaxFontSize(height));
    }

    getLayoutOptions() {
        return { ...this.config.wordcloud.layout };
    }

    getFontConfig() {
        const font = this.config.wordcloud.font;
        return {
            family: `${font.family.primary}, ${font.family.fallback}`,
            minSize: font.size.min,
            maxSize: font.size.max,
            scaleFactor: font.size.scaleFactor,
            weights: font.weight
        };
    }

    getAnimationConfig() {
        return { ...this.config.wordcloud.animation };
    }

    getExportConfig() {
        return { ...this.config.wordcloud.export };
    }

    getColorConfig() {
        return this.config.wordcloud.colors;
    }

    /**
     * Resolves the URL of a group's frequency file.
     * `basePath` is set per-deployment by the page bootstrap (see `bootstrap.js`).
     */
    getDataPath(group) {
        const basePath = this.get('paths.basePath') ?? '..';
        return `${basePath}/data/${group}_word_frequencies.json`;
    }
}
