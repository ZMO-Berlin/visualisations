export const translations = {
    en: {
        allUnits: 'All Research Units',
        numberOfWords: 'Number of words',
        saveAsPNG: 'Save as PNG',
        word: 'Word',
        frequency: 'Frequency',
        units: 'Research Units',
        selectUnit: 'Select a research unit',
        wordList: 'Word List'
    },
    fr: {
        allUnits: 'Toutes les unités de recherche',
        numberOfWords: 'Nombre de mots',
        saveAsPNG: 'Enregistrer en PNG',
        word: 'Mot',
        frequency: 'Fréquence',
        units: 'Unités de recherche',
        selectUnit: 'Sélectionner une unité de recherche',
        wordList: 'Liste des mots'
    }
};

export const DEFAULT_LOCALE = 'en';

/**
 * Resolves the active locale from the document language, falling back to the
 * URL path.
 *
 * `<html lang>` is the authoritative signal — each localised page already
 * declares it — and it keeps the app working if the pages are ever served from
 * paths other than `/en/` and `/fr/`.
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
