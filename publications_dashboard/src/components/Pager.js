/**
 * Page-through state for a long list, and the control that drives it.
 *
 * The ranked charts run to hundreds of rows — roughly 500 journals and 400
 * authors — so a chart shows one page at a time. Only the current page is in
 * the DOM, and the range label ("13–24 of 487") is what stops a reader from
 * mistaking the visible page for the whole answer.
 *
 * The pager owns the page number but not the data: it is handed the full list
 * and returns the slice to draw, so a component never has to track both.
 */

import { el } from '../utils/dom.js';

export class Pager {
    #page = 0;

    /**
     * @param {object} options
     * @param {object} options.strings
     * @param {number} options.pageSize
     * @param {() => void} options.onChange Called after the page changes.
     */
    constructor({ strings, pageSize, onChange }) {
        this.strings = strings;
        this.pageSize = pageSize;
        this.onChange = onChange;
    }

    /** Back to the first page — call when the underlying list changes. */
    reset() {
        this.#page = 0;
    }

    /**
     * The slice to render.
     *
     * A filter can shrink the list under a reader who has paged forward, so the
     * page is clamped here rather than left pointing past the end and rendering
     * nothing.
     */
    slice(items) {
        const lastPage = Math.max(0, Math.ceil(items.length / this.pageSize) - 1);
        this.#page = Math.min(this.#page, lastPage);

        const start = this.#page * this.pageSize;
        return items.slice(start, start + this.pageSize);
    }

    /**
     * The prev/next control, or null when everything fits on one page.
     *
     * @param {number} total Length of the full list, not of the slice.
     */
    control(total) {
        if (total <= this.pageSize) {
            return null;
        }

        const lastPage = Math.ceil(total / this.pageSize) - 1;
        const from = this.#page * this.pageSize + 1;
        const to = Math.min(total, from + this.pageSize - 1);

        const step = delta => {
            this.#page = Math.min(Math.max(this.#page + delta, 0), lastPage);
            this.onChange();
        };

        return el('div', { class: 'pager' }, [
            el('button', {
                class: 'pager__button',
                type: 'button',
                text: '‹',
                'aria-label': this.strings.previousPage,
                disabled: this.#page === 0,
                on: { click: () => step(-1) }
            }),
            el('span', {
                class: 'pager__range',
                text: `${from}–${to} ${this.strings.ofTotal} ${total}`
            }),
            el('button', {
                class: 'pager__button',
                type: 'button',
                text: '›',
                'aria-label': this.strings.nextPage,
                disabled: this.#page >= lastPage,
                on: { click: () => step(1) }
            })
        ]);
    }
}
