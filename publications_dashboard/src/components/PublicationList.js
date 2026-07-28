/**
 * The publications behind the charts, newest first.
 *
 * A filter that produces a surprising bar is only checkable if you can see
 * which records made it, so the list is not an extra: it is what makes the
 * charts falsifiable. It pages rather than growing, so the DOM holds twenty
 * entries whatever the filter selects — the unfiltered register is ~2,000.
 */

import { el, mount } from '../utils/dom.js';
import { citation, formatNumber } from '../utils/format.js';
import { translateType } from '../utils/translations.js';
import { Pager } from './Pager.js';

export class PublicationList {
    #records = [];

    constructor(container, { settings, strings, locale }) {
        this.container = container;
        this.strings = strings;
        this.locale = locale;
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

    #item(record) {
        const title = [record.title, record.subtitle].filter(Boolean).join(': ')
            || record.slug;

        return el('li', { class: 'list__item' }, [
            el('a', {
                class: 'list__title',
                href: record.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: this.strings.openOnZmo,
                text: title
            }),
            el('p', { class: 'list__meta', text: citation(record) }),
            el('p', { class: 'list__tags' }, [
                record.type && el('span', { class: 'tag', text: translateType(this.strings, record.type) }),
                record.doi && el('a', {
                    class: 'tag tag--link',
                    href: `https://doi.org/${record.doi}`,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    text: `DOI ${record.doi}`
                })
            ])
        ]);
    }

    destroy() {
        this.container.replaceChildren();
    }
}
