const url = value => { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
const strings = values => Array.isArray(values) && values.every(value => typeof value === 'string');
export function validateVocabulary(data) {
    if (data?.schemaVersion !== 1 || typeof data.datasetId !== 'string' || !Array.isArray(data.units) || !data.units.length
        || !Array.isArray(data.terms) || !Array.isArray(data.passages)) throw new Error('Invalid vocabulary schema');
    const stems = new Set();
    for (const unit of data.units) {
        if (typeof unit.stem !== 'string' || stems.has(unit.stem) || typeof unit.label !== 'string' || !url(unit.url)
            || !Number.isInteger(unit.tokens) || unit.tokens <= 0 || !Number.isInteger(unit.projects) || unit.projects < 0) throw new Error('Invalid vocabulary unit');
        stems.add(unit.stem);
    }
    for (const row of data.terms) {
        if (typeof row.term !== 'string' || !Array.isArray(row.counts) || row.counts.length !== data.units.length
            || row.counts.some(n => !Number.isInteger(n) || n < 0)) throw new Error('Invalid vocabulary counts');
    }
    for (const passage of data.passages) {
        if (!stems.has(passage.unit) || typeof passage.text !== 'string' || typeof passage.title !== 'string'
            || !url(passage.url) || !strings(passage.terms)) throw new Error('Invalid source passage');
    }
    return data;
}
export function validateFamilies(data) {
    const reference = node => node && typeof node.slug === 'string' && typeof node.title === 'string' && url(node.url);
    if (!Array.isArray(data) || data.some(f => !reference(f.parent) || !Array.isArray(f.children) || f.children.some(c => !reference(c)))) throw new Error('Invalid publication families');
    return data;
}
