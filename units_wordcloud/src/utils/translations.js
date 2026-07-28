export const translations = {
    en: {
        allUnits: 'All units',
        allUnitsLong: 'All research units',
        numberOfWords: 'Number of words',
        saveAsPNG: 'Save as PNG',
        word: 'Word',
        frequency: 'Frequency',
        units: 'Research Units',
        selectUnit: 'Research unit',
        wordList: 'Ranked terms',

        // The context strip above the cloud.
        title: 'What ZMO writes about',
        intro: 'The terms that appear most often in the descriptions of the '
            + 'institute’s three research units, with common words removed and '
            + 'each term reduced to its dictionary form.',
        termsShown: 'Terms shown',
        // Not "words read": the data file holds only the terms that survived
        // filtering, so what can honestly be counted is how often those terms
        // occur — not how long the source texts were.
        occurrences: 'Occurrences',

        // The ranked list.
        listRange: (from, to, total) => `${from}–${to} of ${total}`,
        listHint: 'Hover a term to find it in the cloud',
        previousPage: 'Previous page',
        nextPage: 'Next page'
    },
    de: {
        allUnits: 'Alle',
        allUnitsLong: 'Alle Forschungseinheiten',
        numberOfWords: 'Anzahl der Wörter',
        saveAsPNG: 'Als PNG speichern',
        word: 'Wort',
        frequency: 'Häufigkeit',
        units: 'Forschungseinheiten',
        selectUnit: 'Forschungseinheit',
        wordList: 'Begriffe nach Häufigkeit',

        title: 'Worüber das ZMO schreibt',
        intro: 'Die Begriffe, die in den Beschreibungen der drei '
            + 'Forschungseinheiten des Instituts am häufigsten vorkommen — ohne '
            + 'Füllwörter und auf ihre Grundform zurückgeführt.',
        termsShown: 'Angezeigte Begriffe',
        occurrences: 'Nennungen',

        listRange: (from, to, total) => `${from}–${to} von ${total}`,
        listHint: 'Einen Begriff überfahren, um ihn in der Wolke zu finden',
        previousPage: 'Vorherige Seite',
        nextPage: 'Nächste Seite'
    }
};

export const DEFAULT_LOCALE = 'en';

/**
 * Resolves the active locale from the document language, falling back to the
 * URL path.
 *
 * `<html lang>` is the authoritative signal — each localised page already
 * declares it — and it keeps the app working if the pages are ever served from
 * paths other than `/en/` and `/de/`.
 */
export function getLocale() {
    const declared = document.documentElement.lang?.slice(0, 2).toLowerCase();
    if (declared && declared in translations) {
        return declared;
    }

    const fromPath = window.location.pathname.match(/\/([a-z]{2})\//i)?.[1]?.toLowerCase();
    return fromPath && fromPath in translations ? fromPath : DEFAULT_LOCALE;
}

export function getTranslations(locale = getLocale()) {
    return translations[locale] ?? translations[DEFAULT_LOCALE];
}
