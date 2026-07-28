import { UnitSelector } from './UnitSelector.js';
import { WordCountSlider } from './WordCountSlider.js';
import { SaveButton } from './SaveButton.js';
import { UI_EVENTS, ERROR_EVENTS } from '../events/EventTypes.js';

/**
 * The control bar: unit selector, word-count slider and export button.
 *
 * Owns the one-way flow `control input -> store action`, and mirrors store
 * changes back into the controls. Because the controls' `setValue` methods do
 * not re-fire their change handlers, that mirroring cannot loop back into
 * another store update.
 */
export class Menu {
    /**
     * @param {string|HTMLElement} containerId
     * @param {object} deps
     * @param {import('../config/ConfigManager.js').ConfigManager} deps.config
     * @param {import('../store/AppStore.js').AppStore} deps.store
     * @param {import('../events/EventBus.js').EventBus} deps.eventBus
     * @param {import('../utils/ErrorManager.js').ErrorManager} deps.errorManager
     * @param {import('../utils/saveUtils.js').SaveManager} deps.saveManager
     */
    constructor(containerId, { config, store, eventBus, errorManager, saveManager }) {
        this.container = typeof containerId === 'string'
            ? document.getElementById(containerId.replace(/^#/, ''))
            : containerId;

        if (!this.container) {
            throw new Error(`Menu: container "${containerId}" not found`);
        }

        this.config = config;
        this.store = store;
        this.eventBus = eventBus;
        this.errorManager = errorManager;
        this.saveManager = saveManager;

        this.init();
    }

    init() {
        const wrapper = document.createElement('div');
        wrapper.className = 'menu-wrapper';
        this.container.appendChild(wrapper);
        this.wrapper = wrapper;

        this.components = {
            unitSelector: new UnitSelector(wrapper, { config: this.config }),
            wordCountSlider: new WordCountSlider(wrapper, { config: this.config }),
            saveButton: new SaveButton(wrapper, { config: this.config })
        };

        this.bindControls();
        this.unsubscribe = this.store.subscribe(this.handleStateChange.bind(this));
        this.syncFromState();
    }

    bindControls() {
        this.components.unitSelector.onChange = unit => {
            this.eventBus.emit(UI_EVENTS.UNIT_CHANGE, { unit });
            this.requestUpdate();
        };

        this.components.wordCountSlider.onChange = count => {
            this.eventBus.emit(UI_EVENTS.WORD_COUNT_CHANGE, { count });
            this.requestUpdate();
        };

        this.components.saveButton.onClick = () => this.handleSave();
    }

    requestUpdate() {
        this.store
            .updateWordCloud(this.getUnit(), this.getWordCount())
            .catch(() => { /* already reported via ErrorManager and the store's error state */ });
    }

    async handleSave() {
        const { saveButton } = this.components;
        saveButton.setBusy(true);

        try {
            await this.eventBus.emit(UI_EVENTS.SAVE_REQUEST);

            const svg = document.querySelector('#wordcloud svg');
            if (!svg) {
                throw new Error('There is no word cloud to export yet');
            }

            await this.saveManager.saveAsPNG(svg);
            await this.eventBus.emit(UI_EVENTS.SAVE_COMPLETE);
        } catch (error) {
            this.errorManager.handleError(error, { component: 'Menu', method: 'handleSave' });
            await this.eventBus.emit(UI_EVENTS.SAVE_ERROR, { error });
            await this.eventBus.emit(ERROR_EVENTS.GENERAL, { error });
        } finally {
            saveButton.setBusy(false);
        }
    }

    /** Pushes current store values into the controls. */
    syncFromState() {
        const { selectedUnit, wordCount } = this.store.getState();
        this.setUnit(selectedUnit);
        this.setWordCount(wordCount);
    }

    handleStateChange(newState, oldState) {
        if (newState.selectedUnit !== oldState.selectedUnit) {
            this.setUnit(newState.selectedUnit);
        }
        if (newState.wordCount !== oldState.wordCount) {
            this.setWordCount(newState.wordCount);
        }
    }

    getUnit() {
        return this.components.unitSelector.getValue();
    }

    getWordCount() {
        return this.components.wordCountSlider.getValue();
    }

    setUnit(value) {
        this.components.unitSelector.setValue(value);
    }

    setWordCount(value) {
        this.components.wordCountSlider.setValue(value);
    }

    destroy() {
        this.unsubscribe?.();
        Object.values(this.components ?? {}).forEach(component => component.destroy?.());
        this.components = {};
        this.container?.replaceChildren();
    }
}
