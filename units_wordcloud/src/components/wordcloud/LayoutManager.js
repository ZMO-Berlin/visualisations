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
        const { family } = this.config.getFontConfig();

        return d3.layout.cloud()
            .size([width, height])
            .padding(padding)
            // d3-cloud measures every word on a scratch canvas to decide where
            // it fits, and defaults that measurement to a generic `serif` —
            // while the SVG draws in the configured face. The layout was
            // packing shapes that were never the ones on screen, which is both
            // gaps where there should be none and collisions where the metrics
            // disagreed.
            .font(family)
            .canvas(WordCloudLayoutManager.createMeasurementCanvas)
            .rotate((word, index) => this.getRotation(word, index));
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

    /**
     * Whether a word is turned on its side, and by how much.
     *
     * Words arrive sorted by descending frequency, so `index` is the word's
     * rank: the largest ones are kept upright. They are what the cloud is read
     * as at a glance, and a headline term standing on its end costs more in
     * legibility than the variety buys — the rotation is there to break up the
     * long tail, which is where it now applies.
     */
    getRotation(word, index) {
        const { rotations, rotationProbability, uprightTop } = this.config.getLayoutOptions();

        if (index < uprightTop) {
            return 0;
        }

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
