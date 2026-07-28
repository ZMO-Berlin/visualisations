import { getTranslations } from '../utils/translations.js';

/**
 * Floating label showing a word's rank and frequency on hover.
 *
 * A single element is created per instance and reused; it is appended to
 * `document.body` so it is never clipped by the cloud's `overflow: hidden`.
 */
export class Tooltip {
    /**
     * @param {object} [deps]
     * @param {import('../config/ConfigManager.js').ConfigManager} [deps.config]
     */
    constructor({ config } = {}) {
        this.config = config;
        this.translations = getTranslations();
        this.tooltip = this.createElement();
    }

    createElement() {
        // The page ships an empty `#tooltip` placeholder; reuse it when present
        // so styling hooks stay stable, otherwise create one.
        const existing = document.getElementById('tooltip');
        if (existing) return existing;

        const tooltip = document.createElement('div');
        tooltip.id = 'tooltip';
        tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltip);
        return tooltip;
    }

    show(event, data) {
        if (!this.tooltip) {
            this.tooltip = this.createElement();
        }

        this.tooltip.replaceChildren(...this.buildRows(data));

        // Measure after content is in place, then flip the tooltip toward
        // whichever side has room.
        const { offsetWidth, offsetHeight } = this.tooltip;
        const margin = 10;

        let left = event.pageX + margin;
        let top = event.pageY - offsetHeight - margin;

        if (left + offsetWidth > window.innerWidth) {
            left = event.pageX - offsetWidth - margin;
        }
        if (top < 0) {
            top = event.pageY + margin;
        }

        this.tooltip.style.left = `${Math.max(left, 0)}px`;
        this.tooltip.style.top = `${top}px`;
        this.tooltip.classList.add('visible');
    }

    hide() {
        this.tooltip?.classList.remove('visible');
    }

    /** Builds the rows as nodes; word text is never interpolated into markup. */
    buildRows({ text, originalSize, rank, units }) {
        const content = document.createElement('div');
        content.className = 'tooltip-content';

        content.appendChild(Tooltip.createRow(`#${rank}`, text));
        content.appendChild(Tooltip.createRow(`${this.translations.frequency}:`, originalSize));

        if (Array.isArray(units) && units.length > 0) {
            content.appendChild(Tooltip.createRow(`${this.translations.units}:`, units.join(', ')));
        }

        return [content];
    }

    static createRow(label, value) {
        const row = document.createElement('div');
        row.className = 'tooltip-row';

        const labelEl = document.createElement('span');
        labelEl.textContent = label;

        const valueEl = document.createElement('strong');
        valueEl.textContent = value;

        row.append(labelEl, document.createTextNode(' '), valueEl);
        return row;
    }

    destroy() {
        this.tooltip?.remove();
        this.tooltip = null;
    }
}
