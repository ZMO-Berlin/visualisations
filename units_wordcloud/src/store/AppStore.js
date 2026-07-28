import { WORDCLOUD_EVENTS } from '../events/EventTypes.js';

/**
 * Single source of truth for what the UI is currently showing.
 *
 * Components read via `getState()` and react via `subscribe()`; nothing mutates
 * state directly. `updateWordCloud()` is the only action that performs I/O.
 */
export class AppStore {
    /**
     * @param {object} deps
     * @param {import('../config/ConfigManager.js').ConfigManager} deps.config
     * @param {import('../events/EventBus.js').EventBus} deps.eventBus
     * @param {import('../utils/ErrorManager.js').ErrorManager} deps.errorManager
     * @param {import('../services/WordCloudService.js').WordCloudService} deps.wordCloudService
     */
    constructor({ config, eventBus, errorManager, wordCloudService }) {
        this.config = config;
        this.eventBus = eventBus;
        this.errorManager = errorManager;
        this.wordCloudService = wordCloudService;

        this.state = {
            selectedUnit: wordCloudService.getDefaultUnit(),
            wordCount: wordCloudService.getDefaultWordCount(),
            currentWords: [],
            dimensions: {
                width: config.get('wordcloud.dimensions.width'),
                height: config.get('wordcloud.dimensions.height')
            },
            isLoading: false,
            error: null
        };

        this.listeners = new Set();

        // Monotonic token: only the most recent request may commit its results,
        // so a slow response for an earlier selection cannot overwrite a newer one.
        this.requestId = 0;
    }

    getState() {
        return { ...this.state };
    }

    setState(partial) {
        const oldState = this.state;
        this.state = { ...this.state, ...partial };
        this.notifyListeners(oldState);
    }

    /** @returns {() => void} Unsubscribe function. */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notifyListeners(oldState) {
        // Copy first: a listener may unsubscribe during iteration.
        [...this.listeners].forEach(listener => listener(this.state, oldState));
    }

    /**
     * Loads the given group and word count, then publishes the result.
     * Concurrent calls are safe; stale responses are discarded.
     */
    async updateWordCloud(unit, wordCount) {
        const requestId = ++this.requestId;

        this.setState({
            selectedUnit: unit,
            wordCount,
            isLoading: true,
            error: null
        });
        await this.eventBus.emit(WORDCLOUD_EVENTS.LOADING, { isLoading: true });

        try {
            const words = await this.wordCloudService.loadData(unit, wordCount);

            if (requestId !== this.requestId) {
                return words; // superseded by a newer request
            }

            this.setState({ currentWords: words, isLoading: false });
            await this.eventBus.emit(WORDCLOUD_EVENTS.UPDATE, { words });
            return words;
        } catch (error) {
            if (requestId === this.requestId) {
                this.setState({ error: error.message, isLoading: false });
                await this.eventBus.emit(WORDCLOUD_EVENTS.ERROR, { error });
            }
            this.errorManager.handleError(error, {
                component: 'AppStore',
                method: 'updateWordCloud',
                unit,
                wordCount
            });
            throw error;
        } finally {
            if (requestId === this.requestId) {
                await this.eventBus.emit(WORDCLOUD_EVENTS.LOADING, { isLoading: false });
            }
        }
    }

    updateDimensions(dimensions) {
        const { width, height } = this.state.dimensions;
        if (dimensions.width === width && dimensions.height === height) {
            return;
        }
        this.setState({ dimensions: { ...this.state.dimensions, ...dimensions } });
    }

    destroy() {
        this.listeners.clear();
    }
}
