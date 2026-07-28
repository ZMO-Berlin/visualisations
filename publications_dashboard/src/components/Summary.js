/**
 * What the current filters leave, written as one line inside the command bar.
 *
 * This used to be three 28px figures in their own bordered strip above the
 * filters. That gave the most prominent position on the page to a number that
 * is a *consequence* of the controls below it — and pushed the first chart
 * below the fold on a laptop. The figures are the same; they now sit beside the
 * chips, at the size of a caption, where a reader looks after changing a filter
 * rather than before.
 *
 * The totals stay alongside the filtered count rather than replacing it: "214
 * of 1,962" says something "214" on its own does not.
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
        const number = value => formatNumber(value, this.locale);

        const parts = [
            el('span', { class: 'counts__figure', text: number(filtered.length) }),
            el('span', {
                text: isFiltered
                    ? `${this.strings.ofTotal} ${number(all.length)} ${this.strings.publications}`
                    : this.strings.publications
            }),
            this.#dot(),
            el('span', { text: `${number(authors.size)} ${this.strings.authors}` })
        ];

        if (extent) {
            parts.push(
                this.#dot(),
                el('span', {
                    text: extent[0] === extent[1] ? String(extent[0]) : `${extent[0]}–${extent[1]}`
                })
            );
        }

        mount(this.container, el('p', {
            class: 'counts',
            // Announced when the figures settle. The charts below say the same
            // thing visually, so a reader who cannot see them still learns what
            // a filter did.
            role: 'status',
            'aria-live': 'polite'
        }, parts));
    }

    /** The separator between two figures — punctuation, not content. */
    #dot() {
        return el('span', { class: 'counts__dot', 'aria-hidden': 'true', text: '·' });
    }

    destroy() {
        this.container.replaceChildren();
    }
}
