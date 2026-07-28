import { getTranslations } from '../utils/translations.js';

const DOWNLOAD_ICON = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <path d="M13.5 11V14.5H2.5V11H1V14.5C1 15.33 1.67 16 2.5 16H13.5C14.33 16 15 15.33 15 14.5V11H13.5Z" fill="currentColor"/>
        <path d="M8.75 11.19L12.22 7.72L11.28 6.78L8.75 9.31V0H7.25V9.31L4.72 6.78L3.78 7.72L7.25 11.19C7.44 11.38 7.69 11.47 7.94 11.47C8.19 11.47 8.44 11.38 8.63 11.19H8.75Z" fill="currentColor"/>
    </svg>
`;

/**
 * Export button.
 *
 * Presentation only: it reports clicks through `onClick` and exposes a busy
 * state. The actual export is owned by Menu, so there is exactly one save code
 * path. (This component previously ran its own duplicate save routine *and*
 * exposed an `onClick` hook that Menu assigned but nothing ever invoked.)
 */
export class SaveButton {
    /**
     * @param {HTMLElement} container
     * @param {object} [deps]
     * @param {import('../config/ConfigManager.js').ConfigManager} [deps.config]
     */
    constructor(container, { config } = {}) {
        this.container = container;
        this.config = config;
        this.translations = getTranslations();
        this.onClick = null;
        this.button = null;
        this.render();
    }

    render() {
        const wrapper = document.createElement('div');
        wrapper.className = 'button-container';

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'saveButton';
        button.className = 'save-button font-medium';
        button.setAttribute('aria-label', this.translations.saveAsPNG);

        const icon = document.createElement('span');
        icon.className = 'save-icon';
        icon.innerHTML = DOWNLOAD_ICON;

        const text = document.createElement('span');
        text.className = 'button-text font-medium';
        text.textContent = this.translations.saveAsPNG;

        button.append(icon, text);
        button.addEventListener('click', () => this.onClick?.());

        wrapper.appendChild(button);
        this.container.appendChild(wrapper);

        this.button = button;
    }

    setBusy(isBusy) {
        if (!this.button) return;
        this.button.disabled = isBusy;
        this.button.setAttribute('aria-busy', String(isBusy));
    }

    destroy() {
        this.onClick = null;
        this.button = null;
    }
}
