/**
 * The filter model, and the one function that decides whether a publication
 * passes it.
 *
 * Each dimension is tested independently, which is what lets a chart ask for
 * the set filtered by *everything except its own dimension*. Without that, the
 * document-type chart would collapse to a single bar the moment a type was
 * selected — technically correct, and useless for choosing a different one.
 */

import { fold } from '../utils/format.js';

/**
 * Venue charts and filters address one of these record fields.
 *
 * `series` is deliberately not one of them — 175 distinct values over 187
 * records is not something to rank — but it is still shown on individual
 * entries and still searched. See `VenueChart`.
 */
export const VENUE_FIELDS = ['journal', 'publisher'];

export function createFilters() {
    return {
        type: new Set(),
        author: new Set(),
        /** Entries are `field:value`, e.g. `journal:Ethnos`. */
        venue: new Set(),
        /** `[from, to]` inclusive, or null for the whole range. */
        years: null,
        search: ''
    };
}

export function venueKey(field, value) {
    return `${field}:${value}`;
}

export function parseVenueKey(key) {
    const separator = key.indexOf(':');
    return { field: key.slice(0, separator), value: key.slice(separator + 1) };
}

export function isEmpty(filters) {
    return !filters.type.size
        && !filters.author.size
        && !filters.venue.size
        && !filters.years
        && !filters.search.trim();
}

export function countActive(filters) {
    return filters.type.size
        + filters.author.size
        + filters.venue.size
        + (filters.years ? 1 : 0)
        + (filters.search.trim() ? 1 : 0);
}

/** A shallow clone; Sets are copied so state updates stay immutable. */
export function cloneFilters(filters) {
    return {
        type: new Set(filters.type),
        author: new Set(filters.author),
        venue: new Set(filters.venue),
        years: filters.years ? [...filters.years] : null,
        search: filters.search
    };
}

const PREDICATES = {
    type: (record, filters) =>
        !filters.type.size || filters.type.has(record.type ?? ''),

    author: (record, filters) =>
        !filters.author.size || (record.authors ?? []).some(name => filters.author.has(name)),

    venue: (record, filters) => {
        if (!filters.venue.size) {
            return true;
        }
        return VENUE_FIELDS.some(field => record[field] && filters.venue.has(venueKey(field, record[field])));
    },

    years: (record, filters) => {
        if (!filters.years) {
            return true;
        }
        // An undated record cannot satisfy a year range, so it drops out —
        // rather than being silently treated as "any year".
        const [from, to] = filters.years;
        return Boolean(record.year) && record.year >= from && record.year <= to;
    },

    search: (record, filters, needle) => {
        if (!needle) {
            return true;
        }
        return record.$haystack.includes(needle);
    }
};

/**
 * Filters a list of records.
 *
 * @param {object[]} records
 * @param {object} filters
 * @param {{except?: string}} [options] Dimension to ignore, for a chart that is
 *   drawing that dimension's own choices.
 */
export function applyFilters(records, filters, { except } = {}) {
    const needle = fold(filters.search.trim());
    const active = Object.entries(PREDICATES).filter(([dimension]) => dimension !== except);

    return records.filter(record =>
        active.every(([, predicate]) => predicate(record, filters, needle))
    );
}

/**
 * Precomputes the text the search box matches against.
 *
 * Folding accents on every record for every keystroke is the one place this app
 * could get slow — ~2,000 records × a dozen fields — so it is done once, when
 * the data arrives, and cached on the record under a `$`-prefixed key that
 * marks it as derived rather than part of the dataset.
 */
export function indexForSearch(records) {
    for (const record of records) {
        record.$haystack = fold([
            record.title,
            record.subtitle,
            (record.authors ?? []).join(' '),
            record.journal,
            record.publisher,
            record.series,
            record.type,
            record.year
        ].filter(Boolean).join(' '));
    }
    return records;
}
