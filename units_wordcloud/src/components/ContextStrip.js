import { getLocale, getTranslations } from '../utils/translations.js';

/**
 * The band between the site bar and the toolbar: what this page is, which unit
 * it is currently showing, and two figures describing what is on screen.
 *
 * The page used to open straight onto a floating strip of controls above an
 * unlabelled cloud. A reader arriving from zmo.de — or from an embed, where
 * this strip is the *only* thing above the cloud — had no way to learn what the
 * words were counted from, or that they were counted at all.
 *
 * The two figures are deliberately modest. "Words read" would be the natural
 * pair to "terms shown", but the data file holds only the terms that survived
 * stopword filtering and lemmatisation, so the length of the source texts is
 * not something this page can honestly claim to know. What it can count is how
 * often the terms it is showing occur, which is also the number that moves when
 * the slider does.
 */
export class ContextStrip {
    /**
     * @param {string|HTMLElement} container
     * @param {object} deps
     * @param {import('../config/ConfigManager.js').ConfigManager} deps.config
     * @param {import('../store/AppStore.js').AppStore} deps.store
     */
    constructor(container, { config, store }) {
        this.container = container instanceof HTMLElement
            ? container
            : document.getElementById(String(container).replace(/^#/, ''));

        if (!this.container) {
            throw new Error(`ContextStrip: container "${container}" not found`);
        }

        this.config = config;
        this.store = store;
        this.translations = getTranslations();
        this.number = new Intl.NumberFormat(getLocale());

        this.render();
        this.unsubscribe = this.store.subscribe(state => this.update(state));
        this.update(this.store.getState());
    }

    /** The unit's own name, spelled out — not the segmented control's short form. */
    unitLabel(value) {
        const unit = this.config.getUnits().find(candidate => candidate.value === value);
        if (!unit) {
            return this.translations.allUnitsLong;
        }
        return unit.labelKey
            ? (this.translations[`${unit.labelKey}Long`] ?? this.translations[unit.labelKey])
            : unit.label;
    }

    render() {
        this.container.className = 'context';

        const text = document.createElement('div');
        text.className = 'context__text';

        this.eyebrow = document.createElement('p');
        this.eyebrow.className = 'eyebrow';

        const heading = document.createElement('h1');
        heading.className = 'context__title';
        heading.textContent = this.translations.title;

        const intro = document.createElement('p');
        intro.className = 'context__intro';
        intro.textContent = this.translations.intro;

        text.append(this.eyebrow, heading, intro);

        const stats = document.createElement('div');
        stats.className = 'context__stats';

        this.termsValue = this.stat(stats, this.translations.termsShown);
        this.occurrencesValue = this.stat(stats, this.translations.occurrences);

        this.container.replaceChildren(text, stats);
    }

    /** One figure tile; returns the node its value is written into. */
    stat(parent, label) {
        const tile = document.createElement('div');
        tile.className = 'context__stat';

        const value = document.createElement('span');
        value.className = 'context__stat-value';

        const caption = document.createElement('span');
        caption.className = 'context__stat-label';
        caption.textContent = label;

        tile.append(value, caption);
        parent.appendChild(tile);
        return value;
    }

    update(state) {
        const words = state.currentWords ?? [];

        this.eyebrow.textContent = this.unitLabel(state.selectedUnit);
        this.termsValue.textContent = this.number.format(words.length);

        // `originalSize` is the raw count; `size` may have been rescaled for
        // layout. The same field the ranked list shows, so the two agree.
        const occurrences = words.reduce(
            (total, word) => total + (word.originalSize ?? word.size ?? 0), 0
        );
        this.occurrencesValue.textContent = this.number.format(occurrences);
    }

    destroy() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.container?.replaceChildren();
    }
}
