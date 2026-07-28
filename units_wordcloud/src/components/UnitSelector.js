import { getTranslations } from '../utils/translations.js';

/**
 * Dropdown for choosing which research unit's frequencies to display.
 */
export class UnitSelector {
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
        this.select = null;
        this.render();
    }

    render() {
        const wrapper = document.createElement('div');
        wrapper.className = 'select-container';

        const select = document.createElement('select');
        select.id = 'unitSelector';
        select.className = 'font-medium custom-select';
        select.setAttribute('aria-label', this.translations.selectUnit);
        // Prevent the browser restoring a previous selection on reload, which
        // would disagree with the unit the app actually loaded.
        select.autocomplete = 'off';

        this.config.getUnits().forEach(unit => {
            const option = document.createElement('option');
            option.value = unit.value;
            option.className = 'font-medium';
            option.textContent = unit.labelKey ? this.translations[unit.labelKey] : unit.label;
            select.appendChild(option);
        });

        select.value = this.config.get('data.defaultGroup');
        select.addEventListener('change', () => this.onChange?.(select.value));

        wrapper.appendChild(select);
        this.container.appendChild(wrapper);

        // Hold the reference rather than re-querying the document on every
        // read; the element is owned by this component.
        this.select = select;
    }

    getValue() {
        return this.select.value;
    }

    /**
     * Updates the control to reflect external state.
     *
     * Deliberately does *not* invoke `onChange`: this is called from the store
     * subscription, and firing the handler here would push the same value back
     * into the store and trigger a second, redundant data load.
     */
    setValue(value) {
        if (value != null && this.select.value !== value) {
            this.select.value = value;
        }
    }

    destroy() {
        this.onChange = null;
        this.select = null;
    }
}
