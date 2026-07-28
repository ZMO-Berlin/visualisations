/** Small formatting and text helpers shared by the components. */

/**
 * Lowercases and strips accents, so a search for "cetin" finds "Çetin".
 *
 * Names in the register carry diacritics from a dozen transliteration systems;
 * requiring an exact match would make the search box useless for exactly the
 * names people look for.
 */
export function fold(value) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
}

/** Groups thousands using the page's locale. */
export function formatNumber(value, locale) {
    return new Intl.NumberFormat(locale).format(value);
}

/** "Holst, Birgitte" → "B. Holst", for tight axis labels. */
export function shortName(name) {
    const [surname, given = ''] = name.split(',').map(part => part.trim());
    const initials = given
        .split(/\s+/)
        .filter(Boolean)
        .map(part => `${part[0]}.`)
        .join(' ');
    return initials ? `${initials} ${surname}` : surname;
}

/** The citation line under a title: authors, venue and year, as available. */
export function citation(record) {
    const venue = record.journal || record.publisher || record.series;
    return [record.authors?.join('; '), venue, record.year]
        .filter(Boolean)
        .join(' · ');
}
