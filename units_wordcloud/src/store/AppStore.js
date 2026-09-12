/** Actions own validation, request ordering, and notification. */
export class AppStore {
    constructor({ config, errorManager, wordCloudService }) {
        Object.assign(this, { config, errorManager, wordCloudService });
        this.state = { selectedUnit: wordCloudService.getDefaultUnit(), wordCount: wordCloudService.getDefaultWordCount(),
            currentWords: [], dimensions: { ...config.get('wordcloud.dimensions') }, isLoading: false, error: null };
        this.listeners = new Set(); this.requestId = 0;
    }
    getState() { return { ...this.state }; }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    setState(patch) {
        if (this.destroyed) return;
        const previous = this.state;
        this.state = { ...previous, ...patch };
        for (const listener of [...this.listeners]) {
            try { listener(this.state, previous); }
            catch (error) { this.errorManager.handleError(error, { component: 'AppStore' }); }
        }
    }
    async updateWordCloud(unit, wordCount) {
        if (!this.config.getUnits().some(item => item.value === unit)) throw new Error('Unknown research unit');
        wordCount = Math.min(this.config.get('data.maxWords'), Math.max(this.config.get('data.minWords'), Math.round(wordCount)));
        if (!Number.isFinite(wordCount)) throw new Error('Invalid word count');
        const request = ++this.requestId;
        this.setState({ selectedUnit: unit, wordCount, isLoading: true, error: null });
        try {
            const words = await this.wordCloudService.loadData(unit, wordCount);
            if (!this.destroyed && request === this.requestId) this.setState({ currentWords: words, isLoading: false });
            return words;
        } catch (error) {
            if (!this.destroyed && request === this.requestId) {
                this.setState({ error: error.message, isLoading: false });
                this.errorManager.handleError(error, { component: 'AppStore', unit });
            }
            throw error;
        }
    }
    updateDimensions(dimensions) {
        if (dimensions.width !== this.state.dimensions.width || dimensions.height !== this.state.dimensions.height) {
            this.setState({ dimensions: { ...this.state.dimensions, ...dimensions } });
        }
    }
    destroy() { this.destroyed = true; this.requestId++; this.listeners.clear(); }
}
