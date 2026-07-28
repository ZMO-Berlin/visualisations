/**
 * Publications per year, each column stacked by document type.
 *
 * Every year between the first and the last gets a column, including the empty
 * ones. Dropping years with no publications would close the gaps and quietly
 * turn a chart about output over time into a chart about the years ZMO happened
 * to publish in — the flat stretches are part of the shape.
 *
 * The column is the click target and the segments inside it are not: a year is
 * one keyboard stop, not ten. Selecting a document type is what the legend
 * below the chart is for.
 */

import { el, mount } from '../../utils/dom.js';

/** Gap between stacked segments, so two adjacent fills never read as one. */
const SEGMENT_GAP = '2px';

export class Timeline {
    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {object} deps.strings
     * @param {import('../Tooltip.js').Tooltip} deps.tooltip
     * @param {(key: string) => string} deps.formatSeries
     * @param {(key: string) => number} deps.seriesIndex Palette slot, 1-based.
     * @param {(year: number) => void} deps.onSelectYear
     * @param {(key: string) => void} deps.onSelectSeries
     */
    constructor(container, {
        strings, tooltip, formatSeries, seriesIndex, onSelectYear, onSelectSeries
    }) {
        this.container = container;
        this.strings = strings;
        this.tooltip = tooltip;
        this.formatSeries = formatSeries;
        this.seriesIndex = seriesIndex;
        this.onSelectYear = onSelectYear;
        this.onSelectSeries = onSelectSeries;
    }

    /**
     * The series order arrives per render rather than at construction: it is
     * derived from the dataset, which is still loading when the components are
     * built.
     *
     * @param {object} view
     * @param {{year: number, total: number, segments: object[]}[]} view.series
     * @param {string[]} view.order Series keys, bottom of the stack first.
     * @param {[number, number]|null} view.selectedYears Inclusive range.
     * @param {Set<string>} view.selectedSeries
     */
    render({ series, order, selectedYears, selectedSeries = new Set() }) {
        this.order = order;

        if (!series.length) {
            mount(this.container, el('p', { class: 'empty', text: this.strings.noData }));
            return;
        }

        const max = Math.max(...series.map(entry => entry.total), 1);
        const inRange = year =>
            Boolean(selectedYears) && year >= selectedYears[0] && year <= selectedYears[1];

        mount(this.container, el('div', { class: 'timeline' }, [
            el('div', { class: 'timeline__columns' },
                series.map(entry => this.#column(entry, max, inRange(entry.year)))),
            el('div', { class: 'timeline__axis' }, this.#ticks(series)),
            this.#legend(selectedSeries)
        ]));
    }

    #column(entry, max, selected) {
        const { year, total, segments } = entry;

        // Segments are appended in series order; the stack is laid out
        // `column-reverse`, so the first — the largest series overall — sits at
        // the bottom against the baseline and the last is the one that gets the
        // rounded top.
        const fills = segments.map(segment => el('span', {
            class: `column__fill series-${this.seriesIndex(segment.key)}`,
            style: { height: `${(segment.count / total) * 100}%` },
            on: {
                pointerenter: event => this.tooltip.show([
                    String(year),
                    `${this.formatSeries(segment.key)}: ${segment.count}`,
                    `${this.strings.publications}: ${total}`
                ], event),
                pointermove: event => this.tooltip.move(event),
                pointerleave: () => this.tooltip.hide()
            }
        }));

        const label = `${year}: ${total} ${this.strings.publications}`;

        return el('button', {
            class: `column${selected ? ' column--selected' : ''}`,
            type: 'button',
            'aria-label': label,
            'aria-pressed': String(selected),
            on: {
                click: () => this.onSelectYear(year),
                // Focus has no pointer position, so the tooltip is anchored to
                // the column itself when the reader arrives by keyboard.
                focus: event => {
                    const box = event.target.getBoundingClientRect();
                    this.tooltip.show([String(year), `${total} ${this.strings.publications}`],
                        { clientX: box.left, clientY: box.top });
                },
                blur: () => this.tooltip.hide(),
                pointerleave: () => this.tooltip.hide()
            }
        }, [
            el('span', {
                class: 'column__stack',
                // An empty year still needs a visible baseline, or its column
                // becomes an invisible click target.
                style: { height: `${Math.max((total / max) * 100, 0.5)}%`, gap: SEGMENT_GAP }
            }, fills)
        ]);
    }

    /**
     * Decade labels, plus the first and last year.
     *
     * Ticks are positioned by percentage rather than laid out in a flex row, so
     * a label always sits over its own column no matter how many years the
     * span covers.
     */
    #ticks(series) {
        const span = series.length;
        const step = span > 40 ? 10 : span > 15 ? 5 : 1;

        return series
            .map((entry, index) => ({ ...entry, index }))
            .filter(({ year, index }) => year % step === 0 || index === 0 || index === span - 1)
            .map(({ year, index }) => el('span', {
                class: 'timeline__tick',
                text: String(year),
                style: { left: `${((index + 0.5) / span) * 100}%` }
            }));
    }

    /**
     * The legend, which is also the document-type filter.
     *
     * Three of the eight fills sit below 3:1 against a white panel, so the
     * written label beside each swatch is not decoration — it is what keeps the
     * series identifiable without relying on the colour.
     */
    #legend(selected) {
        return el('div', { class: 'legend' }, this.order.map(key => {
            const isSelected = selected.has(key);

            return el('button', {
                class: `legend__item${isSelected ? ' legend__item--selected' : ''}`,
                type: 'button',
                'aria-pressed': String(isSelected),
                // The visible label already names the series; stating it again
                // as the accessible name keeps the swatch — a span with no text
                // — from being part of what a screen reader announces.
                'aria-label': this.formatSeries(key),
                on: { click: () => this.onSelectSeries(key) }
            }, [
                el('span', { class: `legend__swatch series-${this.seriesIndex(key)}` }),
                el('span', { class: 'legend__label', text: this.formatSeries(key) })
            ]);
        }));
    }

    destroy() {
        this.container.replaceChildren();
    }
}
