/**
 * Search, year range, and one removable chip per active filter.
 *
 * Document types, authors and venues are chosen by clicking their charts rather
 * than from duplicate dropdowns here; the chips are what makes those choices
 * visible and undoable from one place.
 *
 * The controls are built once and then only updated, never rebuilt. Moving a
 * focused element in the DOM blurs it, so re-rendering this bar from scratch on
 * every state change threw the caret out of the search box after the first
 * character it debounced — the reader had to type faster than the debounce to
 * get a second one in. Reusing the input node is not enough on its own: it was
 * being reparented into a fresh wrapper each time, which is a move.
 */

import { el, mount } from '../utils/dom.js';
import { countActive, parseVenueKey } from '../store/filters.js';
import { translateType } from '../utils/translations.js';

const SEARCH_DEBOUNCE_MS = 180;

export class FilterBar {
    #searchTimer = null;
    #searchInput = null;
    #controlsRow = null;
    #chipsRow = null;
    #clearButton = null;
    /** `{ from, to }` once the dataset's year span is known. */
    #yearSelects = null;
    #extent = null;

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

        this.#build(extent);

        // Only written back when the reader is not in the box: they are ahead
        // of the debounced state by up to one word, and overwriting what they
        // have typed with what the store last heard would lose it.
        if (document.activeElement !== this.#searchInput) {
            this.#searchInput.value = filters.search;
        }

        if (this.#yearSelects) {
            this.#yearSelects.from.value = filters.years ? String(filters.years[0]) : '';
            this.#yearSelects.to.value = filters.years ? String(filters.years[1]) : '';
        }

        this.#clearButton.disabled = countActive(filters) === 0;

        const chips = this.#chips(filters);
        this.#chipsRow.replaceChildren(...chips);
        this.#chipsRow.hidden = chips.length === 0;
    }

    /**
     * Creates the parts that are missing, and touches nothing that already
     * exists.
     *
     * The year options are the whole dataset's span, which never changes once
     * the data has loaded, so the selects are built the first time it is known
     * and then left alone. `extent` is null only when no record carries a year.
     */
    #build(extent) {
        if (!this.#controlsRow) {
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

            this.#clearButton = el('button', {
                class: 'button',
                type: 'button',
                text: this.strings.clearFilters,
                on: { click: () => this.store.clearFilters() }
            });

            this.#controlsRow = el('div', { class: 'controls' }, [
                el('div', { class: 'control control--grow' }, [this.#searchInput]),
                this.#clearButton
            ]);

            this.#chipsRow = el('div', {
                class: 'chips',
                role: 'list',
                'aria-label': this.strings.activeFilters,
                hidden: true
            });

            mount(this.container, el('div', {}, [this.#controlsRow, this.#chipsRow]));
        }

        if (extent && !this.#yearSelects) {
            this.#extent = extent;
            this.#yearSelects = {
                from: this.#yearSelect('from'),
                to: this.#yearSelect('to')
            };
            // Before the button, so the row reads search · from · to · clear.
            this.#clearButton.before(
                el('div', { class: 'control' }, [this.#yearSelects.from]),
                el('div', { class: 'control' }, [this.#yearSelects.to])
            );
        }
    }

    #yearSelect(edge) {
        const [first, last] = this.#extent;
        const years = [];
        for (let year = last; year >= first; year -= 1) {
            years.push(year);
        }

        return el('select', {
            class: 'control__select',
            'aria-label': this.strings[edge],
            on: {
                change: event => {
                    const value = event.target.value ? Number(event.target.value) : null;
                    const range = this.store.getState().filters.years ?? [first, last];
                    const next = edge === 'from' ? [value ?? first, range[1]] : [range[0], value ?? last];
                    // Back to the full span means no year filter at all, so the
                    // chip disappears instead of showing a range that excludes
                    // nothing.
                    this.store.setYears(next[0] === first && next[1] === last ? null : next);
                }
            }
        }, [
            el('option', { value: '', text: this.strings[edge] }),
            ...years.map(year => el('option', { value: String(year), text: String(year) }))
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
        this.#controlsRow = null;
        this.#chipsRow = null;
        this.#clearButton = null;
        this.#yearSelects = null;
        this.container.replaceChildren();
    }
}
