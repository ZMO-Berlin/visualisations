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

/** The language key of a record whose title gave no confident answer. */
export const UNDETERMINED = 'und';

/** OpenAlex open-access statuses that mean a copy is free to read. */
const OPEN_STATUSES = new Set(['gold', 'diamond', 'hybrid', 'bronze', 'green']);

/**
 * `open`, `closed`, or `unknown` — the last for every record OpenAlex did not
 * match, which is most of them. Unknown is never folded into closed: a book
 * chapter missing from OpenAlex says nothing about whether it can be read.
 */
export function accessOf(record) {
    if (!record.oa) return 'unknown';
    return OPEN_STATUSES.has(record.oa) ? 'open' : 'closed';
}

/** Set-valued dimensions, in the order chips and URLs list them. */
export const SET_DIMENSIONS = ['type', 'author', 'venue', 'theme', 'lang', 'access', 'region', 'place', 'gnd'];

export function createFilters() {
    return {
        type: new Set(),
        author: new Set(),
        /** Entries are `field:value`, e.g. `journal:Ethnos`. */
        venue: new Set(),
        /** Theme ids from themes.json, e.g. `t07`. */
        theme: new Set(),
        /** ISO 639-1 codes, or `und`. */
        lang: new Set(),
        /** `open`, `closed`, `unknown`; see `accessOf`. */
        access: new Set(),
        /** Macro-region ids from regions.json, e.g. `north-africa`. */
        region: new Set(),
        /** Wikidata ids of places named, e.g. `Q858`. */
        place: new Set(),
        /** GND ids of a book's subject headings. */
        gnd: new Set(),
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
    return countActive(filters) === 0;
}

export function countActive(filters) {
    return SET_DIMENSIONS.reduce((sum, dimension) => sum + filters[dimension].size, 0)
        + (filters.years ? 1 : 0)
        + (filters.search.trim() ? 1 : 0);
}

/** A shallow clone; Sets are copied so state updates stay immutable. */
export function cloneFilters(filters) {
    // Same key order as createFilters, so a clone serialises like the original.
    const clone = {};
    for (const dimension of SET_DIMENSIONS) clone[dimension] = new Set(filters[dimension]);
    clone.years = filters.years ? [...filters.years] : null;
    clone.search = filters.search;
    return clone;
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

    theme: (record, filters) =>
        !filters.theme.size || filters.theme.has(record.theme ?? ''),

    lang: (record, filters) =>
        !filters.lang.size || filters.lang.has(record.lang ?? UNDETERMINED),

    access: (record, filters) =>
        !filters.access.size || filters.access.has(accessOf(record)),

    // `$regions` is derived on load from the record's places; see AppStore.
    region: (record, filters) =>
        !filters.region.size || (record.$regions ?? []).some(region => filters.region.has(region)),

    place: (record, filters) =>
        !filters.place.size || (record.places ?? []).some(place => filters.place.has(place)),

    gnd: (record, filters) =>
        !filters.gnd.size || (record.gnd ?? []).some(id => filters.gnd.has(id)),

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
export function indexForSearch(records, themes = null, regions = null, subjects = null) {
    // A theme's label in both languages is searchable, so "Swahili" finds the
    // theme's records even where no title says it; so are the places an
    // abstract names and a book's subject headings.
    const themeText = new Map((themes?.themes ?? []).map(theme => [theme.id, `${theme.label.en} ${theme.label.de}`]));
    const placeText = new Map((regions?.places ?? []).map(place => [place.id, `${place.label.en} ${place.label.de}`]));
    const headings = subjects?.headings ?? {};
    for (const record of records) {
        record.$haystack = fold([
            record.title,
            record.subtitle,
            (record.authors ?? []).join(' '),
            record.journal,
            record.publisher,
            record.series,
            record.type,
            record.year,
            themeText.get(record.theme),
            ...(record.places ?? []).map(id => placeText.get(id)),
            ...(record.gnd ?? []).map(id => headings[id]?.label)
        ].filter(Boolean).join(' '));
    }
    return records;
}
