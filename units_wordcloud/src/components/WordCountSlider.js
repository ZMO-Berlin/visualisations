import { getTranslations } from '../utils/translations.js';

/**
 * Range input controlling how many words the cloud shows.
 */
export class WordCountSlider {
    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {import('../config/ConfigManager.js').ConfigManager} deps.config
     */
    constructor(container, { config }) {
        this.container = container;
        this.config = config;
        this.translations = getTranslations();
        this.onChange = null;
        this.slider = null;
        this.valueDisplay = null;
        this.render();
    }

    render() {
        const wrapper = document.createElement('div');
        wrapper.className = 'slider-container';

        const labelContainer = document.createElement('div');
        labelContainer.className = 'slider-label';

        const defaultCount = this.config.get('data.defaultWordCount');

        const label = document.createElement('label');
        label.setAttribute('for', 'wordCountSlider');
        label.textContent = this.translations.numberOfWords;

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'slider-value';
        valueDisplay.textContent = defaultCount;

        labelContainer.append(label, document.createTextNode(': '), valueDisplay);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = 'wordCountSlider';
        slider.min = this.config.get('data.minWords');
        slider.max = this.config.get('data.maxWords');
        slider.value = defaultCount;
        // Without this, browsers restore the previous position on reload, which
        // leaves the control disagreeing with the state the app actually loaded
        // (the store starts from the default or the `count` URL parameter).
        slider.autocomplete = 'off';

        slider.addEventListener('input', () => {
            valueDisplay.textContent = slider.value;
            this.onChange?.(this.getValue());
        });

        wrapper.append(labelContainer, slider);
        this.container.appendChild(wrapper);

        this.slider = slider;
        this.valueDisplay = valueDisplay;
    }

    getValue() {
        return parseInt(this.slider.value, 10);
    }

    /**
     * Syncs the control to external state without notifying listeners — see
     * the note on `UnitSelector.setValue`.
     */
    setValue(value) {
        if (value == null) return;
        const clamped = Math.min(Math.max(value, Number(this.slider.min)), Number(this.slider.max));
        this.slider.value = clamped;
        this.valueDisplay.textContent = clamped;
    }

    destroy() {
        this.onChange = null;
        this.slider = null;
        this.valueDisplay = null;
    }
}
