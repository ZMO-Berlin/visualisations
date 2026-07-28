/**
 * Wraps d3-cloud's spiral placement algorithm.
 *
 * Layout is asynchronous and incremental: d3-cloud yields between words to keep
 * the main thread responsive, so a run started for an earlier word count can
 * still be in flight when the next one begins.
 */
export class WordCloudLayoutManager {
    /**
     * @param {object} deps
     * @param {import('../../config/ConfigManager.js').ConfigManager} deps.config
     * @param {import('../../utils/WordStyler.js').WordStyler} deps.wordStyler
     */
    constructor({ config, wordStyler }) {
        this.config = config;
        this.wordStyler = wordStyler;
        this.layout = this.createLayout();
    }

    createLayout() {
        const { width, height } = this.config.get('wordcloud.dimensions');
        const { padding } = this.config.getLayoutOptions();

        return d3.layout.cloud()
            .size([width, height])
            .padding(padding)
            .canvas(WordCloudLayoutManager.createMeasurementCanvas)
            .rotate(() => this.getRotation());
    }

    /**
     * Supplies the scratch canvas d3-cloud uses for pixel-level collision tests.
     *
     * That code path reads back image data on every placement, so the context
     * needs `willReadFrequently` to avoid Chrome's GPU-readback warning and the
     * associated stalls. Using d3-cloud's `canvas()` hook keeps the override
     * scoped to this one element — the previous CanvasManager patched
     * `document.createElement` process-wide to achieve the same thing.
     */
    static createMeasurementCanvas() {
        const canvas = document.createElement('canvas');
        const getContext = canvas.getContext.bind(canvas);

        canvas.getContext = (type, attributes = {}) =>
            getContext(type, type === '2d' ? { ...attributes, willReadFrequently: true } : attributes);

        return canvas;
    }

    getRotation() {
        const { rotations, rotationProbability } = this.config.getLayoutOptions();
        return Math.random() < rotationProbability
            ? rotations[Math.floor(Math.random() * rotations.length)]
            : 0;
    }

    updateDimensions({ width, height }) {
        if (!width || !height) return;
        this.config.updateDimensions(width, height);
        this.layout.size([width, height]);
    }

    /**
     * Places `words` and resolves with the positioned set.
     *
     * Any run still in progress is stopped first, otherwise two concurrent
     * layouts write `x`/`y` onto the same word objects and the cloud renders
     * a mix of both passes.
     *
     * @returns {Promise<Array<object>>}
     */
    layoutWords(words) {
        if (!words || words.length === 0) {
            return Promise.resolve([]);
        }

        this.layout.stop();

        const { width, height } = this.config.get('wordcloud.dimensions');
        const sizer = this.wordStyler.createSizer(words, width * height);

        return new Promise((resolve, reject) => {
            try {
                this.layout
                    .words(words.map(word => ({ ...word })))
                    .fontSize(sizer)
                    .on('end', resolve)
                    .start();
            } catch (error) {
                reject(error);
            }
        });
    }

    destroy() {
        this.layout.stop();
        this.layout.on('end', null);
    }
}
