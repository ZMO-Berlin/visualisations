/**
 * Where ZMO publishes: journals or publishers, one at a time.
 *
 * The two are separate fields in the register and are not comparable — a
 * journal article has a journal, a chapter has a publisher — so they are shown
 * as two views of one panel rather than merged into a single misleading
 * ranking. The register's `series` field used to be a third tab and is not one
 * any more: it is filled on 187 of 1,962 records and holds 175 distinct values
 * among them, so the "ranking" was a list of ones that said more about the
 * field's coverage than about where ZMO publishes. The field itself is
 * untouched — it still names the venue on individual entries in the list below,
 * and is still searched.
 */

import { el, mount } from '../../utils/dom.js';
import { countValues, rank } from '../../utils/aggregate.js';
import { venueKey } from '../../store/filters.js';
import { BarChart } from './BarChart.js';

export class VenueChart {
    #field = 'journal';
    #bars;
    #barsContainer;
    #tabsContainer;

    constructor(container, { settings, strings, store }) {
        this.container = container;
        this.settings = settings;
        this.strings = strings;
        this.store = store;

        this.#tabsContainer = el('div', { class: 'tabs', role: 'tablist' });
        this.#barsContainer = el('div', {});
        this.#bars = new BarChart(this.#barsContainer, {
            settings,
            strings,
            onSelect: value => store.toggle('venue', venueKey(this.#field, value))
        });

        mount(container, el('div', {}, [this.#tabsContainer, this.#barsContainer]));
    }

    /** @param {object[]} records Filtered by everything except venue. */
    render(records, selected) {
        const labels = {
            journal: this.strings.journals,
            publisher: this.strings.publishers
        };

        this.#tabsContainer.replaceChildren(...Object.entries(labels).map(([field, label]) =>
            el('button', {
                class: `tab${field === this.#field ? ' tab--active' : ''}`,
                type: 'button',
                role: 'tab',
                'aria-selected': String(field === this.#field),
                text: label,
                on: {
                    click: () => {
                        this.#field = field;
                        this.render(records, selected);
                    }
                }
            })
        ));

        // Selection is stored as `field:value`, so the bars are matched against
        // the keys for this tab only.
        const chosen = new Set(
            [...selected]
                .filter(key => key.startsWith(`${this.#field}:`))
                .map(key => key.slice(this.#field.length + 1))
        );

        this.#bars.render(rank(countValues(records, record => record[this.#field])), chosen);
    }

    destroy() {
        this.#bars.destroy();
        this.container.replaceChildren();
    }
}
