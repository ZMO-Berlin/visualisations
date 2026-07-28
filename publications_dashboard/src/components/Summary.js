/**
 * The three headline numbers, recounted against the current filters.
 *
 * The totals are shown alongside the filtered figures rather than replaced by
 * them: "218 of 1,973" says something "218" on its own does not.
 */

import { el, mount } from '../utils/dom.js';
import { formatNumber } from '../utils/format.js';
import { yearExtent } from '../utils/aggregate.js';

export class Summary {
    constructor(container, { strings, locale }) {
        this.container = container;
        this.strings = strings;
        this.locale = locale;
    }

    /**
     * @param {object[]} filtered
     * @param {object[]} all
     * @param {boolean} isFiltered
     */
    render(filtered, all, isFiltered) {
        const authors = new Set(filtered.flatMap(record => record.authors ?? []));
        const extent = yearExtent(filtered);

        mount(this.container, el('div', { class: 'summary__row' }, [
            this.#stat(
                formatNumber(filtered.length, this.locale),
                this.strings.publications,
                isFiltered ? `${this.strings.ofTotal} ${formatNumber(all.length, this.locale)}` : null
            ),
            this.#stat(formatNumber(authors.size, this.locale), this.strings.authors, null),
            this.#stat(
                extent ? (extent[0] === extent[1] ? String(extent[0]) : `${extent[0]}–${extent[1]}`) : '—',
                this.strings.years,
                null
            )
        ]));
    }

    #stat(value, label, note) {
        return el('div', { class: 'stat' }, [
            el('span', { class: 'stat__value', text: value }),
            el('span', { class: 'stat__label', text: label }),
            note && el('span', { class: 'stat__note', text: note })
        ]);
    }

    destroy() {
        this.container.replaceChildren();
    }
}
