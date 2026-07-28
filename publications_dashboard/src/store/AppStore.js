/**
 * Application state and the only actions that change it.
 *
 * State flows one way: a control calls an action, the store produces a new
 * state object and notifies subscribers, and views re-render from what they are
 * handed. No view reads the DOM to find out what is selected.
 */

import { applyFilters, cloneFilters, createFilters, indexForSearch, isEmpty } from './filters.js';

export class AppStore {
    #listeners = new Set();
    #cache = new Map();

    constructor({ settings, service }) {
        this.settings = settings;
        this.service = service;

        this.state = {
            status: 'loading',   // 'loading' | 'ready' | 'error'
            error: null,
            publications: [],
            meta: {},
            filters: createFilters()
        };
    }

    getState() {
        return this.state;
    }

    /** @returns {() => void} unsubscribe */
    subscribe(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    async load() {
        this.#update({ status: 'loading', error: null });

        try {
            const { publications, meta } = await this.service.load();
            this.#update({
                status: 'ready',
                publications: indexForSearch(publications),
                meta
            });
        } catch (error) {
            console.error('Failed to load publications', error);
            this.#update({ status: 'error', error });
        }
    }

    // --- Filter actions -----------------------------------------------------

    /** Adds or removes one value of a Set-valued dimension. */
    toggle(dimension, value) {
        const filters = cloneFilters(this.state.filters);
        const values = filters[dimension];

        if (values.has(value)) {
            values.delete(value);
        } else {
            values.add(value);
        }

        this.#setFilters(filters);
    }

    /**
     * Adds every value if any is missing, otherwise removes them all.
     *
     * Used by the timeline legend, where one entry stands for several document
     * types folded into a bucket: clicking it has to behave like one choice,
     * not leave the reader half-selected.
     */
    toggleMany(dimension, values) {
        const filters = cloneFilters(this.state.filters);
        const target = filters[dimension];
        const missing = values.filter(value => !target.has(value));

        for (const value of values) {
            if (missing.length) {
                target.add(value);
            } else {
                target.delete(value);
            }
        }

        this.#setFilters(filters);
    }

    setSearch(text) {
        if (text === this.state.filters.search) {
            return;
        }
        this.#setFilters({ ...cloneFilters(this.state.filters), search: text });
    }

    /** `null` clears the range. Reversed bounds are put back in order. */
    setYears(range) {
        const years = range ? [Math.min(...range), Math.max(...range)] : null;
        this.#setFilters({ ...cloneFilters(this.state.filters), years });
    }

    /** Clicking the bar for a single year toggles that year on its own. */
    toggleYear(year) {
        const current = this.state.filters.years;
        const isOnlyThisYear = current && current[0] === year && current[1] === year;
        this.setYears(isOnlyThisYear ? null : [year, year]);
    }

    clearFilters() {
        if (isEmpty(this.state.filters)) {
            return;
        }
        this.#setFilters(createFilters());
    }

    // --- Selectors ----------------------------------------------------------

    /**
     * The records passing the current filters.
     *
     * @param {string} [except] Dimension to ignore, so a chart can show the
     *   alternatives to the choice already made in it.
     */
    select(except) {
        const key = except ?? '*';
        if (!this.#cache.has(key)) {
            this.#cache.set(key, applyFilters(this.state.publications, this.state.filters, { except }));
        }
        return this.#cache.get(key);
    }

    destroy() {
        this.#listeners.clear();
        this.#cache.clear();
    }

    // --- Internals ----------------------------------------------------------

    #setFilters(filters) {
        this.#update({ filters });
    }

    #update(patch) {
        const previous = this.state;
        this.state = { ...previous, ...patch };
        // Every filtered view is derived from state, so the memo cannot outlive
        // a state change.
        this.#cache.clear();

        if (this.settings.debug) {
            console.debug('[store]', Object.keys(patch).join(', '), this.state);
        }

        // A subscriber that throws must not take the store with it. Without
        // this, an exception in a view escapes through the `#update` inside
        // `load()`'s try block and is caught there — reporting a rendering bug
        // to the reader as "the data could not be loaded", which sends anyone
        // debugging it to the network tab for a problem that is not there.
        for (const listener of this.#listeners) {
            try {
                listener(this.state, previous);
            } catch (error) {
                console.error('A subscriber threw while rendering state', error);
            }
        }
    }
}
