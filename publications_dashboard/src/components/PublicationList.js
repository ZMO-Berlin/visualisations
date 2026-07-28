/**
 * The publications behind the charts, newest first.
 *
 * A filter that produces a surprising bar is only checkable if you can see
 * which records made it, so the list is not an extra: it is what makes the
 * charts falsifiable. It pages rather than growing, so the DOM holds twenty
 * entries whatever the filter selects — the unfiltered register is ~2,000.
 */

import { el, mount } from '../utils/dom.js';
import { formatNumber } from '../utils/format.js';
import { Pager } from './Pager.js';

export class PublicationList {
    #records = [];

    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {(key: string) => string} deps.formatLabel Document type, translated.
     * @param {(key: string) => number} deps.seriesIndex The type's palette slot,
     *   so a row's square is the same colour as its band in the timeline.
     */
    constructor(container, { settings, strings, locale, formatLabel, seriesIndex }) {
        this.container = container;
        this.strings = strings;
        this.locale = locale;
        this.formatLabel = formatLabel;
        this.seriesIndex = seriesIndex;
        this.pager = new Pager({
            strings,
            pageSize: settings.list.pageSize,
            onChange: () => this.#draw()
        });
    }

    /** @param {object[]} records Filtered, unsorted. */
    render(records) {
        // `?? ''` is not defensive padding: the register contains at least one
        // stub with no title at all, and `undefined.localeCompare` would take
        // the whole dashboard down for one bad row.
        this.#records = [...records].sort(
            (a, b) => (b.year ?? 0) - (a.year ?? 0) || (a.title ?? '').localeCompare(b.title ?? '')
        );
        this.#draw();
    }

    /** A new filter means a new list; showing page 4 of the old one would mislead. */
    resetPaging() {
        this.pager.reset();
    }

    #draw() {
        if (!this.#records.length) {
            mount(this.container, el('p', { class: 'empty', text: this.strings.noResults }));
            return;
        }

        const page = this.pager.slice(this.#records);

        mount(this.container, el('div', {}, [
            el('p', {
                class: 'list__count',
                text: `${formatNumber(this.#records.length, this.locale)} ${this.strings.publications}`
            }),
            el('ol', { class: 'list' }, page.map(record => this.#item(record))),
            this.pager.control(this.#records.length)
        ]));
    }

    /**
     * One record: the year in its own column, then the type, the title and who
     * published it where.
     *
     * The year is pulled out to the left rather than left at the end of the
     * citation line, because the list is sorted by it — a column of years is
     * the scale the reader is scrolling along. The type keeps the palette slot
     * it has in the timeline above, so a row and its band are the same colour.
     */
    #item(record) {
        const title = [record.title, record.subtitle].filter(Boolean).join(': ')
            || record.slug;
        const venue = record.journal || record.publisher || record.series;
        const authors = record.authors?.join('; ');

        return el('li', { class: 'list__item' }, [
            el('span', { class: 'list__year', text: record.year ?? '—' }),
            el('div', { class: 'list__body' }, [
                record.type && el('p', { class: 'list__type' }, [
                    el('span', {
                        class: `list__swatch series-${this.seriesIndex(record.type)}`,
                        'aria-hidden': 'true'
                    }),
                    this.formatLabel(record.type)
                ]),
                el('a', {
                    class: 'list__title',
                    href: record.url,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    title: this.strings.openOnZmo,
                    text: title
                }),
                (authors || venue) && el('p', { class: 'list__meta' }, [
                    authors,
                    authors && venue && ' · ',
                    venue && el('span', { class: 'list__venue', text: venue })
                ]),
                record.doi && el('p', { class: 'list__tags' }, [
                    el('a', {
                        class: 'tag tag--link',
                        href: `https://doi.org/${record.doi}`,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        text: `DOI ${record.doi}`
                    })
                ])
            ])
        ]);
    }

    destroy() {
        this.container.replaceChildren();
    }
}
