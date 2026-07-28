import { DataProcessor } from '../utils/dataProcessor.js';
import { DATA_EVENTS } from '../events/EventTypes.js';

/**
 * Fetches and prepares frequency data for a group.
 *
 * Responses are cached per group: the files are static, so re-selecting a unit
 * or dragging the word-count slider re-slices data already in memory instead of
 * re-fetching it.
 */
export class WordCloudService {
    /**
     * @param {object} deps
     * @param {import('../config/ConfigManager.js').ConfigManager} deps.config
     * @param {import('../events/EventBus.js').EventBus} deps.eventBus
     */
    constructor({ config, eventBus }) {
        this.config = config;
        this.eventBus = eventBus;
        this.processor = new DataProcessor({ config });
        this.cache = new Map();
    }

    async loadData(unit, wordCount) {
        await this.eventBus.emit(DATA_EVENTS.LOAD_START, { unit, wordCount });

        const raw = await this.fetchGroup(unit);

        await this.eventBus.emit(DATA_EVENTS.LOAD_COMPLETE, { unit });

        const words = this.processor.process(DataProcessor.mergeGroups(raw), wordCount);

        await this.eventBus.emit(DATA_EVENTS.PROCESS_COMPLETE, { words });
        return words;
    }

    async fetchGroup(unit) {
        if (this.cache.has(unit)) {
            return this.cache.get(unit);
        }

        const url = this.config.getDataPath(unit);
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Could not load word frequencies for "${unit}" (${response.status} from ${url})`);
        }

        const data = await response.json();
        this.cache.set(unit, data);
        return data;
    }

    getDefaultUnit() {
        return this.config.get('data.defaultGroup');
    }

    getDefaultWordCount() {
        return this.config.get('data.defaultWordCount');
    }

    getWordCountLimits() {
        return {
            min: this.config.get('data.minWords'),
            max: this.config.get('data.maxWords')
        };
    }
}
