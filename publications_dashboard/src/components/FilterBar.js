/**
 * Search, year range, and one removable chip per active filter.
 *
 * Document types, authors and venues are chosen by clicking their charts rather
 * than from duplicate dropdowns here; the chips are what makes those choices
 * visible and undoable from one place.
 */

import { el, mount } from '../utils/dom.js';
import { countActive, parseVenueKey } from '../store/filters.js';
import { translateType } from '../utils/translations.js';

const SEARCH_DEBOUNCE_MS = 180;

export class FilterBar {
    #searchTimer = null;
    #searchInput = null;

    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {object} deps.strings
     * @param {import('../store/AppStore.js').AppStore} deps.store
     */
    constructor(container, { strings, store }) {
        this.container = container;
        this.strings = strings;
        this.store = store;
    }

    render(state, extent) {
        const { filters } = state;

        // Rebuilding the input would drop focus and the caret mid-typing, so
        // the existing node is reused and only its value reconciled.
        if (!this.#searchInput) {
            this.#searchInput = el('input', {
                class: 'control__input',
                type: 'search',
                placeholder: this.strings.search,
                'aria-label': this.strings.search,
                on: {
                    input: event => {
                        const { value } = event.target;
                        clearTimeout(this.#searchTimer);
                        this.#searchTimer = setTimeout(() => this.store.setSearch(value), SEARCH_DEBOUNCE_MS);
                    }
                }
            });
        }
        if (document.activeElement !== this.#searchInput) {
            this.#searchInput.value = filters.search;
        }

        const rows = [
            el('div', { class: 'controls' }, [
                el('div', { class: 'control control--grow' }, [this.#searchInput]),
                this.#yearSelect('from', extent, filters),
                this.#yearSelect('to', extent, filters),
                el('button', {
                    class: 'button',
                    type: 'button',
                    text: this.strings.clearFilters,
                    disabled: countActive(filters) === 0,
                    on: { click: () => this.store.clearFilters() }
                })
            ])
        ];

        const chips = this.#chips(filters);
        if (chips.length) {
            rows.push(el('div', { class: 'chips', role: 'list', 'aria-label': this.strings.activeFilters }, chips));
        }

        mount(this.container, el('div', {}, rows));
    }

    #yearSelect(edge, extent, filters) {
        if (!extent) {
            return null;
        }

        const [first, last] = extent;
        const years = [];
        for (let year = last; year >= first; year -= 1) {
            years.push(year);
        }

        const current = filters.years ? filters.years[edge === 'from' ? 0 : 1] : '';

        return el('div', { class: 'control' }, [
            el('select', {
                class: 'control__select',
                'aria-label': this.strings[edge],
                on: {
                    change: event => {
                        const value = event.target.value ? Number(event.target.value) : null;
                        const range = filters.years ?? [first, last];
                        const next = edge === 'from' ? [value ?? first, range[1]] : [range[0], value ?? last];
                        // Back to the full span means no year filter at all,
                        // so the chip disappears instead of showing a range
                        // that excludes nothing.
                        this.store.setYears(next[0] === first && next[1] === last ? null : next);
                    }
                }
            }, [
                el('option', { value: '', text: this.strings[edge], selected: current === '' }),
                ...years.map(year => el('option', {
                    value: String(year),
                    text: String(year),
                    selected: current === year
                }))
            ])
        ]);
    }

    #chips(filters) {
        const chips = [];

        const chip = (label, onRemove) => el('span', { class: 'chip', role: 'listitem' }, [
            el('span', { class: 'chip__label', text: label }),
            el('button', {
                class: 'chip__remove',
                type: 'button',
                'aria-label': `${this.strings.removeFilter}: ${label}`,
                text: '×',
                on: { click: onRemove }
            })
        ]);

        if (filters.search.trim()) {
            chips.push(chip(`“${filters.search.trim()}”`, () => {
                this.#searchInput.value = '';
                this.store.setSearch('');
            }));
        }

        if (filters.years) {
            const [from, to] = filters.years;
            chips.push(chip(from === to ? String(from) : `${from}–${to}`, () => this.store.setYears(null)));
        }

        for (const type of filters.type) {
            chips.push(chip(type ? translateType(this.strings, type) : this.strings.untyped,
                () => this.store.toggle('type', type)));
        }

        for (const author of filters.author) {
            chips.push(chip(author, () => this.store.toggle('author', author)));
        }

        for (const key of filters.venue) {
            chips.push(chip(parseVenueKey(key).value, () => this.store.toggle('venue', key)));
        }

        return chips;
    }

    destroy() {
        clearTimeout(this.#searchTimer);
        this.#searchInput = null;
        this.container.replaceChildren();
    }
}
