import { getTranslations } from '../utils/translations.js';

/**
 * Segmented control for choosing which research unit's frequencies to show.
 *
 * This was a `<select>`. With four options that never change, a dropdown hid
 * three of them behind a click and gave no sense that the cloud was one of a
 * small set of views — a reader had to open the menu to learn what the
 * alternatives even were.
 *
 * Built as a radio group rather than as buttons with `aria-pressed`, because
 * that is what it is: one choice out of four, exactly one of which is always
 * active. That brings the expected keyboard behaviour with it — the group is a
 * single tab stop and the arrow keys move within it — implemented below as a
 * roving tabindex.
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
        this.buttons = [];
        this.value = null;
        this.render();
    }

    render() {
        const field = document.createElement('div');
        field.className = 'field';

        const label = document.createElement('span');
        label.className = 'field__label';
        label.id = 'unit-selector-label';
        label.textContent = this.translations.selectUnit;

        const group = document.createElement('div');
        group.className = 'segmented';
        group.id = 'unitSelector';
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-labelledby', label.id);

        this.buttons = this.config.getUnits().map(unit => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'segmented__option';
            button.dataset.value = unit.value;
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', 'false');
            button.tabIndex = -1;
            button.textContent = unit.labelKey ? this.translations[unit.labelKey] : unit.label;

            button.addEventListener('click', () => this.select(unit.value));
            button.addEventListener('keydown', event => this.handleKeyDown(event));

            group.appendChild(button);
            return button;
        });

        field.append(label, group);
        this.container.appendChild(field);
        this.group = group;

        this.setValue(this.config.get('data.defaultGroup'));
    }

    /**
     * Arrow keys move the selection, as the radio-group pattern requires: in a
     * radio group the arrows *choose*, they do not merely move focus.
     */
    handleKeyDown(event) {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];

        if (step) {
            event.preventDefault();
            const current = this.buttons.findIndex(button => button.dataset.value === this.value);
            const next = (current + step + this.buttons.length) % this.buttons.length;
            this.select(this.buttons[next].dataset.value);
            this.buttons[next].focus();
            return;
        }

        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const target = event.key === 'Home' ? this.buttons[0] : this.buttons.at(-1);
            this.select(target.dataset.value);
            target.focus();
        }
    }

    /** A choice made by the reader: updates the control *and* notifies. */
    select(value) {
        if (value === this.value) {
            return;
        }
        this.setValue(value);
        this.onChange?.(value);
    }

    getValue() {
        return this.value;
    }

    /**
     * Updates the control to reflect external state.
     *
     * Deliberately does *not* invoke `onChange`: this is called from the store
     * subscription, and firing the handler here would push the same value back
     * into the store and trigger a second, redundant data load.
     */
    setValue(value) {
        if (value == null || !this.buttons.some(button => button.dataset.value === value)) {
            return;
        }

        this.value = value;
        this.buttons.forEach(button => {
            const on = button.dataset.value === value;
            button.classList.toggle('segmented__option--on', on);
            button.setAttribute('aria-checked', String(on));
            // Only the checked option is in the tab order, so the group is one
            // tab stop rather than four.
            button.tabIndex = on ? 0 : -1;
        });
    }

    destroy() {
        this.onChange = null;
        this.buttons = [];
        this.group = null;
    }
}
