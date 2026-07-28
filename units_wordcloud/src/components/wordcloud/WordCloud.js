import { WordCloudRenderer } from './Renderer.js';
import { WordCloudLayoutManager } from './LayoutManager.js';
import { DimensionManager } from '../../utils/DimensionManager.js';
import { StyleManager } from '../../utils/StyleManager.js';
import { WordStyler } from '../../utils/WordStyler.js';

/**
 * The word cloud view: observes the store and the container's size, and
 * redraws when either changes.
 *
 * Coordination between this component's own parts (dimensions -> layout ->
 * render) is done with direct calls. The event bus is reserved for genuinely
 * cross-component signals such as word hover and click; routing internal steps
 * through it — as the previous WordCloudController did — added two async hops
 * and made the redraw path hard to follow.
 */
export class WordCloud {
    /**
     * @param {string|HTMLElement} containerId
     * @param {object} deps
     * @param {import('../../config/ConfigManager.js').ConfigManager} deps.config
     * @param {import('../../store/AppStore.js').AppStore} deps.store
     * @param {import('../../events/EventBus.js').EventBus} deps.eventBus
     */
    constructor(containerId, { config, store, eventBus } = {}) {
        this.container = typeof containerId === 'string'
            ? document.getElementById(containerId.replace(/^#/, ''))
            : containerId;

        if (!this.container) {
            throw new Error(`WordCloud: container "${containerId}" not found`);
        }

        this.config = config;
        this.store = store;
        this.eventBus = eventBus;

        this.wordStyler = new WordStyler({ config });
        this.dimensionManager = new DimensionManager(this.container, { config });
        this.renderer = new WordCloudRenderer(this.container, {
            config,
            eventBus,
            wordStyler: this.wordStyler
        });
        this.layoutManager = new WordCloudLayoutManager({
            config,
            wordStyler: this.wordStyler
        });

        this.redrawHandle = null;
        this.teardown = [];

        StyleManager.setupContainer(this.container);
        this.setupView();
    }

    setupView() {
        this.teardown.push(
            this.dimensionManager.subscribe(dimensions => {
                this.layoutManager.updateDimensions(dimensions);
                this.renderer.updateDimensions(dimensions.width, dimensions.height);
                this.store.updateDimensions(dimensions);
                this.scheduleRedraw();
            })
        );

        this.teardown.push(
            this.store.subscribe((newState, oldState) => {
                if (newState.currentWords !== oldState.currentWords) {
                    this.scheduleRedraw();
                }
            })
        );
    }

    /**
     * Coalesces redraw requests into one per frame.
     *
     * A resize drag emits dimension changes far faster than d3-cloud can place
     * words; without this, every intermediate size would start its own layout.
     */
    scheduleRedraw() {
        if (this.redrawHandle !== null) {
            return;
        }
        this.redrawHandle = requestAnimationFrame(() => {
            this.redrawHandle = null;
            this.redraw();
        });
    }

    async redraw() {
        const words = this.getCurrentWords();
        if (words.length === 0) {
            this.renderer.clear();
            return [];
        }

        const placed = await this.layoutManager.layoutWords(words);
        return this.draw(placed);
    }

    getCurrentWords() {
        return this.store.getState().currentWords || [];
    }

    draw(words) {
        const svg = this.renderer.createSVG();
        const wordGroup = this.renderer.createWordGroup(svg);
        this.renderer.renderWords(wordGroup, words);
        return words;
    }

    /**
     * Links the cloud to the word list so hovering either one highlights the
     * other. Each direction drives the other's *visual* state only, so there is
     * no handler that can bounce an event back to its origin.
     */
    setWordList(wordList) {
        this.wordList = wordList;
        this.renderer.setWordList(wordList);

        wordList.onWordHover = text => this.renderer.highlightWord(text);
        wordList.onWordHoverEnd = text => this.renderer.clearWordHighlight(text);
    }

    destroy() {
        if (this.redrawHandle !== null) {
            cancelAnimationFrame(this.redrawHandle);
            this.redrawHandle = null;
        }
        this.teardown.forEach(unsubscribe => unsubscribe());
        this.teardown = [];

        this.dimensionManager.destroy();
        this.layoutManager.destroy();
        this.renderer.destroy();
    }
}
