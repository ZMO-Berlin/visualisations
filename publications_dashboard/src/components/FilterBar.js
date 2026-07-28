/**
 * Search, year range, and one removable chip per active filter.
 *
 * Document types and venues are also chosen by clicking their charts; the chips
 * are what makes every choice, from wherever it was made, visible and undoable
 * from one place.
 *
 * The search box suggests as it types. Free text searches everything and is
 * what the box does on its own, but a reader looking for an author is usually
 * after *that author* rather than the string — and the charts, which is where
 * an author filter otherwise comes from, only rank the busiest sixty. Accepting
 * a suggestion applies the real filter, so someone with two publications is
 * reachable by name.
 *
 * The controls are built once and then only updated, never rebuilt. Moving a
 * focused element in the DOM blurs it, so re-rendering this bar from scratch on
 * every state change threw the caret out of the search box after the first
 * character it debounced — the reader had to type faster than the debounce to
 * get a second one in. Reusing the input node is not enough on its own: it was
 * being reparented into a fresh wrapper each time, which is a move.
 */

import { el, mount } from '../utils/dom.js';
import { countActive, parseVenueKey, venueKey } from '../store/filters.js';
import { countValues } from '../utils/aggregate.js';
import { fold } from '../utils/format.js';
import { translateType } from '../utils/translations.js';

const SEARCH_DEBOUNCE_MS = 180;

/** Below this, a query matches too much of the register to be a suggestion. */
const MIN_QUERY = 2;

/** Suggestions offered at once. */
const MAX_SUGGESTIONS = 8;

export class FilterBar {
    #searchTimer = null;
    #searchInput = null;
    #controlsRow = null;
    #chipsRow = null;
    #clearButton = null;
    /** `{ from, to }` once the dataset's year span is known. */
    #yearSelects = null;
    #extent = null;
    /** `[{ value, kind, count, folded }]`, built once from the whole dataset. */
    #index = null;
    #listbox = null;
    /** The entries currently offered, parallel to `#options`. */
    #shown = [];
    #options = [];
    #active = -1;
    #onDocumentPointerDown = null;

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
        this.#buildIndex(state.publications);

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
                // The combobox pattern, so the suggestions are announced rather
                // than being a visual-only affordance. `list` is deliberately
                // absent: a native <datalist> cannot carry the count, the kind,
                // or the click that applies a filter instead of a text search.
                role: 'combobox',
                'aria-autocomplete': 'list',
                'aria-expanded': 'false',
                'aria-controls': 'search-suggestions',
                autocomplete: 'off',
                on: {
                    input: event => {
                        const { value } = event.target;
                        clearTimeout(this.#searchTimer);
                        this.#searchTimer = setTimeout(() => this.store.setSearch(value), SEARCH_DEBOUNCE_MS);
                        // Not debounced: a suggestion list that lagged the
                        // caret by a fifth of a second would be read as broken.
                        this.#suggest(value);
                    },
                    keydown: event => this.#onKeyDown(event),
                    focus: event => this.#suggest(event.target.value)
                }
            });

            this.#listbox = el('ul', {
                id: 'search-suggestions',
                class: 'suggestions',
                role: 'listbox',
                'aria-label': this.strings.suggestions,
                hidden: true
            });

            this.#clearButton = el('button', {
                class: 'button',
                type: 'button',
                text: this.strings.clearFilters,
                on: { click: () => this.store.clearFilters() }
            });

            this.#controlsRow = el('div', { class: 'controls' }, [
                // Positioned, so the listbox can hang under the input rather
                // than pushing the rest of the dashboard down as it opens.
                el('div', { class: 'control control--grow control--combobox' }, [
                    this.#searchInput, this.#listbox
                ]),
                this.#clearButton
            ]);

            this.#chipsRow = el('div', {
                class: 'chips',
                role: 'list',
                'aria-label': this.strings.activeFilters,
                hidden: true
            });

            mount(this.container, el('div', {}, [this.#controlsRow, this.#chipsRow]));

            // A press anywhere else dismisses the list. `pointerdown` rather
            // than `click` so it closes on the way down, and capture so a
            // handler that stops propagation cannot leave it stuck open.
            this.#onDocumentPointerDown = event => {
                if (!this.#controlsRow.contains(event.target)) {
                    this.#closeSuggestions();
                }
            };
            document.addEventListener('pointerdown', this.#onDocumentPointerDown, true);
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

    // ---------------------------------------------------------- autocomplete

    /**
     * Every author, journal and publisher in the register, with how often each
     * appears and its folded form.
     *
     * Built once from the whole dataset — around 1,500 entries — so a keystroke
     * costs one pass over an array rather than a re-count of 2,000 records.
     * Folding here rather than per keystroke is the same trade the search
     * haystack makes.
     */
    #buildIndex(publications) {
        if (this.#index || !publications?.length) {
            return;
        }

        const kinds = [
            ['author', record => record.authors],
            ['journal', record => record.journal],
            ['publisher', record => record.publisher]
        ];

        this.#index = kinds.flatMap(([kind, accessor]) =>
            [...countValues(publications, accessor)].map(([value, count]) => ({
                value, kind, count, folded: fold(value)
            }))
        );
    }

    /**
     * The best matches for what has been typed.
     *
     * Ranked by where the match falls before how common the entry is: someone
     * typing "brill" wants the publisher Brill above a journal that merely
     * contains the word, however many more publications the journal has.
     */
    #matches(query) {
        const needle = fold(query.trim());
        if (needle.length < MIN_QUERY || !this.#index) {
            return [];
        }

        return this.#index
            .map(entry => ({ entry, at: entry.folded.indexOf(needle) }))
            .filter(({ at }) => at !== -1)
            .sort((a, b) => a.at - b.at
                || b.entry.count - a.entry.count
                || a.entry.value.localeCompare(b.entry.value))
            .slice(0, MAX_SUGGESTIONS)
            .map(({ entry }) => entry);
    }

    #suggest(query) {
        const matches = this.#matches(query);
        if (!matches.length) {
            this.#closeSuggestions();
            return;
        }

        const kindLabel = {
            author: this.strings.kindAuthor,
            journal: this.strings.kindJournal,
            publisher: this.strings.kindPublisher
        };

        this.#active = -1;
        this.#shown = matches;
        this.#options = matches.map((entry, index) => el('li', {
            id: `suggestion-${index}`,
            class: 'suggestion',
            role: 'option',
            'aria-selected': 'false',
            on: {
                // `mousedown` would blur the input before the click landed, and
                // the blur is what closes the list — so the click never
                // arrived. Preventing the default keeps focus in the box.
                mousedown: event => event.preventDefault(),
                click: () => this.#accept(entry)
            }
        }, [
            el('span', { class: 'suggestion__value', text: entry.value }),
            el('span', { class: 'suggestion__count', text: String(entry.count) }),
            el('span', { class: 'suggestion__kind', text: kindLabel[entry.kind] })
        ]));

        this.#listbox.replaceChildren(...this.#options);
        this.#listbox.hidden = false;
        this.#searchInput.setAttribute('aria-expanded', 'true');
        this.#searchInput.removeAttribute('aria-activedescendant');
    }

    #closeSuggestions() {
        if (!this.#listbox) {
            return;
        }
        this.#listbox.hidden = true;
        this.#listbox.replaceChildren();
        this.#options = [];
        this.#shown = [];
        this.#active = -1;
        this.#searchInput?.setAttribute('aria-expanded', 'false');
        this.#searchInput?.removeAttribute('aria-activedescendant');
    }

    /** Highlights one option, wrapping at both ends. */
    #moveActive(step) {
        if (!this.#options.length) {
            return;
        }

        const count = this.#options.length;
        this.#active = this.#active === -1 && step < 0
            ? count - 1
            : (this.#active + step + count) % count;

        this.#options.forEach((option, index) => {
            const on = index === this.#active;
            option.classList.toggle('suggestion--active', on);
            option.setAttribute('aria-selected', String(on));
        });
        this.#options[this.#active].scrollIntoView({ block: 'nearest' });
        this.#searchInput.setAttribute('aria-activedescendant', `suggestion-${this.#active}`);
    }

    /**
     * Turns a suggestion into the filter it stands for.
     *
     * The typed text is dropped rather than kept alongside it: "freitag" as
     * free text and the author Freitag as a filter would intersect to almost
     * the same set, and leaving both would put two chips on screen for one
     * choice the reader made once.
     */
    #accept(entry) {
        clearTimeout(this.#searchTimer);
        this.#searchInput.value = '';
        this.#closeSuggestions();
        this.store.setSearch('');

        if (entry.kind === 'author') {
            this.store.toggle('author', entry.value);
        } else {
            this.store.toggle('venue', venueKey(entry.kind, entry.value));
        }

        this.#searchInput.focus();
    }

    #onKeyDown(event) {
        const open = this.#options.length > 0;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (open) {
                    this.#moveActive(1);
                } else {
                    this.#suggest(this.#searchInput.value);
                }
                break;

            case 'ArrowUp':
                if (open) {
                    event.preventDefault();
                    this.#moveActive(-1);
                }
                break;

            case 'Enter':
                // With nothing highlighted, Enter means "search for what I
                // typed" — which the debounce is already doing — so the list is
                // only dismissed.
                if (open && this.#active !== -1) {
                    event.preventDefault();
                    this.#accept(this.#shown[this.#active]);
                } else {
                    this.#closeSuggestions();
                }
                break;

            case 'Escape':
                if (open) {
                    event.preventDefault();
                    this.#closeSuggestions();
                }
                break;

            default:
                break;
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
        if (this.#onDocumentPointerDown) {
            // Registered on `document`, so it outlives this element unless it
            // is taken off explicitly — and it closes over the whole component.
            document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true);
            this.#onDocumentPointerDown = null;
        }
        this.#searchInput = null;
        this.#controlsRow = null;
        this.#chipsRow = null;
        this.#clearButton = null;
        this.#yearSelects = null;
        this.#listbox = null;
        this.#options = [];
        this.#shown = [];
        this.#index = null;
        this.container.replaceChildren();
    }
}
