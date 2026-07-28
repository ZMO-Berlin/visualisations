/**
 * A ranked horizontal bar chart, drawn in HTML rather than SVG.
 *
 * The labels here are journal names, author names and document types — long,
 * multi-word, and different lengths in English and French. In HTML they wrap,
 * ellipsize and reflow for free; in SVG each one would need measuring and
 * truncating by hand at every breakpoint. Each row is a real `<button>`, so
 * keyboard navigation, focus rings and `aria-pressed` come from the platform.
 *
 * Bars are scaled against the largest count in the *whole* ranking, not the
 * largest on the current page: rescaling per page would make page 5 look like
 * page 1 and hide exactly the drop-off the ranking is there to show.
 */

import { el, mount } from '../../utils/dom.js';
import { Pager } from '../Pager.js';

export class BarChart {
    #data = [];
    #selected = new Set();

    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {object} deps.settings
     * @param {object} deps.strings
     * @param {(key: string) => void} deps.onSelect
     * @param {(key: string) => string} [deps.formatLabel]
     */
    constructor(container, { settings, strings, onSelect, formatLabel, seriesIndex }) {
        this.container = container;
        this.strings = strings;
        this.onSelect = onSelect;
        this.formatLabel = formatLabel ?? (key => key);
        // Only the document-type chart passes this: its bars share the stacked
        // timeline's colours, so one type is the same colour in both panels.
        // The author and venue rankings stay single-hue.
        this.seriesIndex = seriesIndex ?? null;

        this.pager = new Pager({
            strings,
            pageSize: settings.charts.pageSize,
            onChange: () => this.#draw()
        });
    }

    /**
     * @param {{key: string, count: number}[]} data Already ranked.
     * @param {Set<string>} selected
     */
    render(data, selected = new Set()) {
        // A different ranking is a different list, so paging starts over; the
        // same ranking redrawn (a selection changed elsewhere) keeps its place.
        if (!sameKeys(data, this.#data)) {
            this.pager.reset();
        }

        this.#data = data;
        this.#selected = selected;
        this.#draw();
    }

    #draw() {
        if (!this.#data.length) {
            mount(this.container, el('p', { class: 'empty', text: this.strings.noData }));
            return;
        }

        const max = this.#data[0].count;
        const rows = this.pager.slice(this.#data);

        mount(this.container, el('div', {}, [
            el('div', { class: 'bars' }, rows.map(row => this.#row(row, max))),
            this.pager.control(this.#data.length)
        ]));
    }

    #row({ key, count }, max) {
        const isSelected = this.#selected.has(key);
        const share = max ? (count / max) * 100 : 0;

        return el('button', {
            class: `bar${isSelected ? ' bar--selected' : ''}`,
            type: 'button',
            'aria-pressed': String(isSelected),
            title: `${this.formatLabel(key)} — ${count}`,
            on: { click: () => this.onSelect(key) }
        }, [
            el('span', { class: 'bar__label', text: this.formatLabel(key) }),
            el('span', { class: 'bar__track' }, [
                el('span', {
                    class: `bar__fill${this.seriesIndex ? ` series-${this.seriesIndex(key)}` : ''}`,
                    style: { width: `${share}%` }
                })
            ]),
            el('span', { class: 'bar__count', text: String(count) })
        ]);
    }

    destroy() {
        this.container.replaceChildren();
    }
}

/** True when two rankings list the same keys in the same order. */
function sameKeys(a, b) {
    return a.length === b.length && a.every((row, index) => row.key === b[index].key);
}
