/**
 * A two-handle year slider under the timeline.
 *
 * Two native range inputs over one track, so the keyboard, touch and screen
 * readers work as they do for any slider. It writes the same year filter as
 * the From/To selects and a click on a column, and reads it back on every
 * render, so the three never disagree. Dragging updates the labels at once and
 * the dashboard after a short pause, not on every pixel.
 */

import { el, mount } from '../utils/dom.js';

const SETTLE_MS = 200;

export class YearRange {
    #timer = null;

    constructor(container, { strings, store }) {
        this.container = container;
        this.strings = strings;
        this.store = store;
    }

    render(extent, years) {
        if (!extent) return;
        const [first, last] = extent;
        if (!this.from) this.#build(first, last);
        if (document.activeElement !== this.from && document.activeElement !== this.to) {
            this.from.value = String(years ? years[0] : first);
            this.to.value = String(years ? years[1] : last);
        }
        this.#paint();
    }

    #build(first, last) {
        this.extent = [first, last];
        const input = edge => el('input', {
            type: 'range', class: `year-range__input year-range__input--${edge}`,
            min: String(first), max: String(last), step: '1',
            'aria-label': this.strings[edge],
            on: { input: () => this.#moved(edge) }
        });
        this.from = input('from');
        this.to = input('to');
        this.fill = el('span', { class: 'year-range__fill', 'aria-hidden': 'true' });
        this.output = el('output', { class: 'year-range__output', 'aria-live': 'polite' });
        mount(this.container, el('div', { class: 'year-range', role: 'group', 'aria-label': this.strings.yearRange }, [
            el('div', { class: 'year-range__track' }, [this.fill, this.from, this.to]),
            this.output
        ]));
    }

    #moved(edge) {
        // The handles cannot cross: the one being moved stops at the other.
        let from = Number(this.from.value);
        let to = Number(this.to.value);
        if (from > to) {
            if (edge === 'from') this.from.value = String(from = to);
            else this.to.value = String(to = from);
        }
        this.#paint();
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => {
            const [first, last] = this.extent;
            this.store.setYears(from === first && to === last ? null : [from, to]);
        }, SETTLE_MS);
    }

    #paint() {
        const [first, last] = this.extent;
        const span = Math.max(1, last - first);
        const from = Number(this.from.value);
        const to = Number(this.to.value);
        this.fill.style.left = `${(from - first) / span * 100}%`;
        this.fill.style.right = `${(last - to) / span * 100}%`;
        this.from.setAttribute('aria-valuetext', String(from));
        this.to.setAttribute('aria-valuetext', String(to));
        this.output.textContent = from === to ? String(from) : `${from}–${to}`;
    }

    destroy() {
        clearTimeout(this.#timer);
        this.container.replaceChildren();
    }
}
