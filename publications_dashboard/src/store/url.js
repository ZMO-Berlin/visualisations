import { createFilters, VENUE_FIELDS, parseVenueKey } from './filters.js';
export const FILTER_KEYS = ['type', 'author', 'venue', 'theme', 'lang', 'access', 'from', 'to', 'q'];
/** Values a hand-edited or stale link may carry, checked before they reach the store. */
const VALID = {
    type: () => true,
    author: () => true,
    venue: value => VENUE_FIELDS.includes(parseVenueKey(value).field),
    theme: value => /^t\d{2}$/.test(value),
    lang: value => /^[a-z]{2,3}$/.test(value),
    access: value => ['open', 'closed', 'unknown'].includes(value)
};
export function decodeFilters(search) {
    const params = new URLSearchParams(search);
    const filters = createFilters();
    for (const [key, valid] of Object.entries(VALID)) {
        filters[key] = new Set(params.getAll(key).filter(v => v.length <= 500 && valid(v)));
    }
    const years = [params.get('from'), params.get('to')];
    if (years.every(v => /^\d{4}$/.test(v ?? '') && +v >= 1000 && +v <= 9999)) {
        filters.years = years.map(Number).sort((a, b) => a - b);
    }
    filters.search = (params.get('q') ?? '').slice(0, 500);
    return filters;
}
export function encodeFilters(filters) {
    const pairs = [];
    for (const key of Object.keys(VALID)) {
        for (const value of [...filters[key]].sort()) pairs.push([key, value]);
    }
    if (filters.years) pairs.push(['from', String(filters.years[0])], ['to', String(filters.years[1])]);
    if (filters.search) pairs.push(['q', filters.search]);
    return pairs;
}
