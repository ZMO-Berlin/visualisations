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
import { accessOf } from '../store/filters.js';
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
    /**
     * @param {object} deps.enrichment Optional lookups from the enrichment
     *   layers: `person(name)` → zmo.de profile or undefined, `themeLabel(id)`,
     *   `themeSlot(id)`, `languageName(code)`, `onTheme(id)`.
     */
    constructor(container, { settings, strings, locale, formatLabel, seriesIndex, enrichment = {} }) {
        this.container = container;
        this.strings = strings;
        this.locale = locale;
        this.formatLabel = formatLabel;
        this.seriesIndex = seriesIndex;
        this.enrichment = enrichment;
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
        const authors = this.#authors(record.authors ?? []);

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
                (authors.length || venue) && el('p', { class: 'list__meta' }, [
                    ...authors,
                    authors.length && venue && ' · ',
                    venue && el('span', { class: 'list__venue', text: venue })
                ]),
                this.#tags(record)
            ])
        ]);
    }

    /** Names, each linked to its zmo.de page when one was matched. */
    #authors(names) {
        const parts = [];
        names.forEach((name, index) => {
            if (index) parts.push('; ');
            const person = this.enrichment.person?.(name);
            parts.push(person
                ? el('a', {
                    class: 'list__author', href: person.url, target: '_blank', rel: 'noopener noreferrer',
                    title: `${this.strings.zmoProfile}${person.position ? ` — ${person.position}` : ''}`,
                    text: name
                })
                : name);
        });
        return parts;
    }

    /** DOI, free copy, OpenAlex record, theme and language. */
    #tags(record) {
        const { themeLabel, themeSlot, languageName, onTheme, placeLabel, placeSlot, onPlace, headingLabel, onHeading } = this.enrichment;
        const chip = (text, title, onClick, swatch) => el('button', { type: 'button', class: 'tag tag--theme', title, on: { click: onClick } },
            [swatch && el('span', { class: `legend-swatch series-${swatch}`, 'aria-hidden': 'true' }), text]);
        const link = (href, text, extra = '') => el('a', {
            class: `tag tag--link${extra}`, href, target: '_blank', rel: 'noopener noreferrer', text
        });
        const tags = [
            record.doi && link(`https://doi.org/${record.doi}`, `DOI ${record.doi}`),
            accessOf(record) === 'open' && record.oaUrl && link(record.oaUrl, this.strings.freeToRead, ' tag--open'),
            accessOf(record) === 'open' && !record.oaUrl && el('span', { class: 'tag tag--open', text: this.strings.freeToRead }),
            record.openalex && link(`https://openalex.org/${record.openalex}`, this.strings.openalexRecord),
            record.theme && themeLabel && el('button', {
                type: 'button', class: 'tag tag--theme',
                title: this.strings.filterTheme,
                on: { click: () => onTheme(record.theme) }
            }, [el('span', { class: `legend-swatch series-${themeSlot(record.theme)}`, 'aria-hidden': 'true' }), themeLabel(record.theme)]),
            record.lang && languageName && el('span', { class: 'tag', text: languageName(record.lang) }),
            // No colour swatch on places: the theme tag beside them already uses
            // the palette, for areas, and one colour must not mean two things.
            ...(placeLabel ? (record.places ?? []).slice(0, 5).map(id => chip(placeLabel(id), this.strings.chipPlace, () => onPlace(id))) : []),
            ...(headingLabel ? (record.gnd ?? []).slice(0, 5).map(id => chip(headingLabel(id), this.strings.chipSubject, () => onHeading(id))) : [])
        ].filter(Boolean);
        return tags.length ? el('p', { class: 'list__tags' }, tags) : null;
    }

    destroy() {
        this.container.replaceChildren();
    }
}
