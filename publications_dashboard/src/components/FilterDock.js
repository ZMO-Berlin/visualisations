/**
 * The current selection, pinned to the top of the window once the filter bar
 * has scrolled out of sight.
 *
 * Filters are set from charts all the way down the page — a theme, a place, a
 * year — but undone only in the bar at the top, so a reader deep in the regions
 * map had to scroll back up to see what was selected or to clear it. This strip
 * appears only when it is needed: some filter is active and the bar is above
 * the window. It holds what the bar's second row holds, in one line — the
 * count, the chips (each removable), "Clear filters", and a button back to the
 * bar for anything more. On a phone the chips give way to "3 filters", so the
 * strip stays one short line.
 *
 * Fixed rather than sticky: a sticky element is in the flow, and appearing
 * would push the page down under the reader. It slides in and out instead, and
 * is invisible — out of the tab order and the accessibility tree — while
 * hidden. The count is not announced here; the bar's own line already is.
 */

import { el, replaceContent } from '../utils/dom.js';
import { countActive } from '../store/filters.js';
import { fill } from '../utils/translations.js';
import { formatNumber } from '../utils/format.js';

export class FilterDock {
    #root;
    #count;
    #active;
    #chips;
    #barAway = false;
    #filtered = false;
    #observer = null;

    /**
     * @param {object} deps
     * @param {import('./FilterBar.js').FilterBar} deps.filterBar
     */
    constructor({ filterBar, strings, extra, locale }) {
        Object.assign(this, { filterBar, strings, locale });
        this.#count = el('span', { class: 'filter-dock__count' });
        this.#active = el('span', { class: 'filter-dock__active' });
        this.#chips = el('div', { class: 'chips filter-dock__chips', role: 'list', 'aria-label': strings.activeFilters });
        this.#root = el('div', { class: 'filter-dock', role: 'region', 'aria-label': strings.activeFilters }, [
            el('div', { class: 'filter-dock__inner' }, [
                this.#count,
                this.#active,
                this.#chips,
                el('div', { class: 'filter-dock__actions' }, [
                    el('button', { type: 'button', class: 'button button--ghost', text: strings.clearFilters, on: { click: () => filterBar.clear() } }),
                    el('button', {
                        type: 'button', class: 'button button--ghost filter-dock__up', title: extra.backFilters,
                        'aria-label': extra.backFilters, on: { click: () => filterBar.reveal() }
                    }, [
                        el('span', { 'aria-hidden': 'true', text: '↑' }),
                        el('span', { class: 'filter-dock__up-label', 'aria-hidden': 'true', text: extra.backFilters })
                    ])
                ])
            ])
        ]);
        document.body.append(this.#root);
        this.#show(false);

        // Away means above the window: before the page has been scrolled to it,
        // the bar is not "out of sight" in the sense that matters here.
        this.#observer = new IntersectionObserver(([entry]) => {
            this.#barAway = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
            this.#update();
        });
        this.#observer.observe(filterBar.container);
    }

    /**
     * @param {object} filters
     * @param {number} shown Publications left by the filters.
     * @param {number} total Publications in the register.
     */
    render(filters, shown, total) {
        const active = countActive(filters);
        this.#filtered = active > 0;
        if (this.#filtered) {
            const number = value => formatNumber(value, this.locale);
            this.#count.textContent = `${number(shown)} ${this.strings.ofTotal} ${number(total)} ${this.strings.publications}`;
            this.#active.textContent = active === 1 ? this.strings.oneFilter : fill(this.strings.manyFilters, { n: number(active) });
            replaceContent(this.#chips, ...this.filterBar.chips(filters));
        }
        this.#update();
    }

    #update() {
        this.#show(this.#filtered && this.#barAway);
    }

    #show(on) {
        // "Clear filters" may hold focus as the strip leaves. Send it to the
        // bar, without scrolling: the reader stays where they were, and the
        // next Tab carries on from the filters rather than the top of the page.
        if (!on && this.#root.contains(document.activeElement)) {
            this.filterBar.container.setAttribute('tabindex', '-1');
            this.filterBar.container.focus({ preventScroll: true });
        }
        this.#root.classList.toggle('filter-dock--shown', on);
        this.#root.inert = !on;
    }

    destroy() {
        this.#observer?.disconnect();
        this.#root.remove();
    }
}
