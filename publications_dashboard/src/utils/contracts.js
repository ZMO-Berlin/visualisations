export function safeURL(value) {
    try { return ['https:', 'http:'].includes(new URL(value).protocol); }
    catch { return false; }
}
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
        for (const key of ['title', 'subtitle', 'journal', 'publisher', 'series', 'type', 'doi']) {
            if (record[key] != null && typeof record[key] !== 'string') throw new Error(`Invalid ${key}`);
        }
    }
    if (!meta || !safeURL(meta.source) || meta.counts?.publications !== records.length || meta.schemaVersion !== 1) {
        throw new Error('Publication metadata does not match dataset');
    }
    return { publications: records, meta };
}
