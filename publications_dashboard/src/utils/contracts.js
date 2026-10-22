export function safeURL(value) {
    try { return ['https:', 'http:'].includes(new URL(value).protocol); }
    catch { return false; }
}
const isString = value => typeof value === 'string';
const isIndex = (value, length) => Number.isInteger(value) && value >= 0 && value < length;
export function validateDataset(records, meta) {
    if (!Array.isArray(records) || !records.length) throw new Error('Empty publication dataset');
    const slugs = new Set();
    for (const record of records) {
        if (!record || typeof record.slug !== 'string' || !record.slug || slugs.has(record.slug)
            || !safeURL(record.url)) throw new Error('Invalid or duplicate publication identity');
        slugs.add(record.slug);
        if (record.year != null && (!Number.isInteger(record.year) || record.year < 1000 || record.year > 9999)) {
            throw new Error('Invalid publication year');
        }
        if (record.authors != null && (!Array.isArray(record.authors) || record.authors.some(v => typeof v !== 'string'))) {
            throw new Error('Invalid author list');
        }
        for (const key of ['title', 'subtitle', 'journal', 'publisher', 'series', 'type', 'doi', 'lang', 'theme', 'openalex', 'oa']) {
            if (record[key] != null && typeof record[key] !== 'string') throw new Error(`Invalid ${key}`);
        }
        if (record.oaUrl != null && !safeURL(record.oaUrl)) throw new Error('Invalid open-access URL');
    }
    if (!meta || !safeURL(meta.source) || meta.counts?.publications !== records.length || meta.schemaVersion !== 2) {
        throw new Error('Publication metadata does not match dataset');
    }
    return { publications: records, meta };
}
/** Matched authors → their zmo.de page. Only links to zmo.de are accepted. */
export function validatePeople(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid people data');
    for (const [name, entry] of Object.entries(data)) {
        if (!safeURL(entry?.url) || new URL(entry.url).hostname !== 'www.zmo.de' || typeof entry.current !== 'boolean'
            || (entry.units != null && !(Array.isArray(entry.units) && entry.units.every(isString)))
            || (entry.position != null && !isString(entry.position))
            || (entry.orcid != null && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(entry.orcid))) {
            throw new Error(`Invalid people entry: ${name}`);
        }
    }
    return data;
}
/**
 * Secondary files index into publications.json, so they must have been built
 * from the same dataset; a mismatch would put themes or institutions on the
 * wrong records rather than fail.
 */
function sameDataset(data, meta, name) {
    if (!data || data.datasetId !== meta.datasetId) throw new Error(`${name} was built for another dataset`);
}
export function validateThemes(data, meta, count) {
    sameDataset(data, meta, 'themes.json');
    const label = value => value && isString(value.en) && isString(value.de);
    const ids = new Set();
    for (const theme of data.themes ?? []) {
        if (!/^t\d{2}$/.test(theme.id) || !label(theme.label) || !label(theme.description)
            || !Array.isArray(theme.terms) || !Number.isInteger(theme.size)) throw new Error('Invalid theme');
        ids.add(theme.id);
    }
    const areas = data.areas ?? [];
    if (!ids.size || !areas.length || areas.length > 8 || areas.some(a => !label(a.label) || !a.themes.every(id => ids.has(id)))) {
        throw new Error('Invalid theme areas');
    }
    const { x, y, added } = data.points ?? {};
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== count || y.length !== count
        || ![...x, ...y].every(v => v === null || (typeof v === 'number' && Math.abs(v) <= 1.0001))
        || !Array.isArray(added) || !added.every(i => isIndex(i, count))) throw new Error('Invalid theme map');
    if (!safeURL(data.attribution?.embedding?.url) || !isString(data.attribution?.labels?.model)) {
        throw new Error('Theme attribution missing');
    }
    return data;
}
export function validateOpenAlex(data, meta, count) {
    sameDataset(data, meta, 'openalex.json');
    const institutions = data.institutions ?? [];
    if (!Array.isArray(institutions) || institutions.some(i => !/^I\d+$/.test(i.id) || !isString(i.name))) {
        throw new Error('Invalid OpenAlex institutions');
    }
    if (!Array.isArray(data.works) || data.works.some(([record, ids]) => !isIndex(record, count)
        || !ids.every(i => isIndex(i, institutions.length)))) throw new Error('Invalid OpenAlex works');
    if (!Array.isArray(data.references) || data.references.some(r => !/^W\d+$/.test(r.id) || !isString(r.title ?? '')
        || !r.by.every(i => isIndex(i, count)))) throw new Error('Invalid OpenAlex references');
    if (!Array.isArray(data.referenced) || !data.referenced.every(i => isIndex(i, count))) throw new Error('Invalid OpenAlex coverage');
    if (!Array.isArray(data.citations) || data.citations.some(pair => pair.length !== 2 || !pair.every(i => isIndex(i, count)))) {
        throw new Error('Invalid OpenAlex citations');
    }
    return data;
}
