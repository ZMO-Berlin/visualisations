import { createFilters, VENUE_FIELDS, parseVenueKey } from './filters.js';
export const FILTER_KEYS = ['type', 'author', 'venue', 'from', 'to', 'q'];
export function decodeFilters(search) {
    const params = new URLSearchParams(search);
    const filters = createFilters();
    for (const key of ['type', 'author', 'venue']) {
        filters[key] = new Set(params.getAll(key).filter(v => v.length <= 500));
    }
    filters.venue = new Set([...filters.venue].filter(v => VENUE_FIELDS.includes(parseVenueKey(v).field)));
    const years = [params.get('from'), params.get('to')];
    if (years.every(v => /^\d{4}$/.test(v ?? '') && +v >= 1000 && +v <= 9999)) {
        filters.years = years.map(Number).sort((a, b) => a - b);
    }
    filters.search = (params.get('q') ?? '').slice(0, 500);
    return filters;
}
export function encodeFilters(filters) {
    const pairs = [];
    for (const key of ['type', 'author', 'venue']) {
        for (const value of [...filters[key]].sort()) pairs.push([key, value]);
    }
    if (filters.years) pairs.push(['from', String(filters.years[0])], ['to', String(filters.years[1])]);
    if (filters.search) pairs.push(['q', filters.search]);
    return pairs;
}
