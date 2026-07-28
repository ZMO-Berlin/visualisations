/**
 * UI strings, in the two languages the site is published in: English and German.
 *
 * Document-type labels are the exception: they come from the register itself
 * (English, as ZMO publishes them) and are translated here by exact key so an
 * unknown type still renders — as its English label — instead of disappearing.
 */
export const translations = {
    en: {
        title: 'ZMO Publications',
        intro: 'Every publication in the ZMO register, by year, type, author and venue.',
        source: 'Source',

        loading: 'Loading publications…',
        error: 'The publication data could not be loaded.',
        retry: 'Try again',

        publications: 'publications',
        authors: 'authors',
        years: 'years',
        ofTotal: 'of',

        search: 'Search titles, authors, journals…',
        from: 'From',
        to: 'To',
        clearFilters: 'Clear filters',
        activeFilters: 'Active filters',
        removeFilter: 'Remove this filter',

        overTime: 'Publications per year',
        overTimeHint: 'Click a column to filter by year, or a legend entry to filter by document type. The smallest types are grouped.',
        otherTypes: 'Other types',
        documentTypes: 'Document types',
        topAuthors: 'Most published authors',
        venues: 'Where ZMO publishes',
        coauthorship: 'Co-authorship',
        coauthorshipHint: 'Authors who have published together. Drag a node to rearrange; click to filter.',
        noCoauthors: 'No co-authored publications match the current filters.',
        noData: 'Nothing to show for the current filters.',

        journals: 'Journals',
        publishers: 'Publishers',

        showMore: 'Show more',
        previousPage: 'Previous page',
        nextPage: 'Next page',

        publicationList: 'Publications',
        noResults: 'No publication matches the current filters.',
        untyped: 'No document type',
        openOnZmo: 'View on zmo.de',

        // The credit reads "<credit> Frédérick Madore"; the name is a link and
        // stays as it is written in every language.
        credit: 'Created by',

        // Document types, keyed by the register's own English label.
        type: {
            'Monographs': 'Monographs',
            'Book reviews': 'Book reviews',
            'Contributions to an edited volume': 'Contributions to an edited volume',
            'Editorship of journal, book series': 'Editorship of journal, book series',
            'Edited volumes': 'Edited volumes',
            'Journal articles': 'Journal articles',
            'Other publications': 'Other publications',
            'Special Issues': 'Special issues',
            'Working Papers': 'Working papers'
        }
    },

    de: {
        title: 'ZMO-Publikationen',
        intro: 'Alle Publikationen im Verzeichnis des ZMO, nach Jahr, Typ, Autorschaft und Publikationsorgan.',
        source: 'Quelle',

        loading: 'Publikationen werden geladen…',
        error: 'Die Publikationsdaten konnten nicht geladen werden.',
        retry: 'Erneut versuchen',

        publications: 'Publikationen',
        authors: 'Autorinnen und Autoren',
        years: 'Jahre',
        ofTotal: 'von',

        search: 'Titel, Autorschaft, Zeitschriften durchsuchen…',
        from: 'Von',
        to: 'Bis',
        clearFilters: 'Filter zurücksetzen',
        activeFilters: 'Aktive Filter',
        removeFilter: 'Diesen Filter entfernen',

        overTime: 'Publikationen pro Jahr',
        overTimeHint: 'Auf eine Säule klicken, um nach Jahr zu filtern, oder auf einen Legendeneintrag, um nach Dokumenttyp zu filtern. Die kleinsten Typen sind zusammengefasst.',
        otherTypes: 'Weitere Typen',
        documentTypes: 'Dokumenttypen',
        topAuthors: 'Meistpublizierte Autorinnen und Autoren',
        venues: 'Wo das ZMO publiziert',
        coauthorship: 'Ko-Autorschaft',
        coauthorshipHint: 'Autorinnen und Autoren, die gemeinsam publiziert haben. Einen Knoten ziehen, um das Netz umzuordnen; klicken, um zu filtern.',
        noCoauthors: 'Keine gemeinsam verfasste Publikation entspricht den aktuellen Filtern.',
        noData: 'Für die aktuellen Filter gibt es nichts anzuzeigen.',

        journals: 'Zeitschriften',
        publishers: 'Verlage',

        showMore: 'Mehr anzeigen',
        previousPage: 'Vorherige Seite',
        nextPage: 'Nächste Seite',

        publicationList: 'Publikationen',
        noResults: 'Keine Publikation entspricht den aktuellen Filtern.',
        untyped: 'Ohne Dokumenttyp',
        openOnZmo: 'Auf zmo.de ansehen',

        credit: 'Erstellt von',

        type: {
            'Monographs': 'Monografien',
            'Book reviews': 'Rezensionen',
            'Contributions to an edited volume': 'Beiträge in Sammelbänden',
            'Editorship of journal, book series': 'Herausgeberschaft von Zeitschriften und Reihen',
            'Edited volumes': 'Sammelbände',
            'Journal articles': 'Zeitschriftenaufsätze',
            'Other publications': 'Weitere Publikationen',
            'Special Issues': 'Sonderhefte',
            // Left in English: the ZMO publishes its own series under that name.
            'Working Papers': 'Working Papers'
        }
    }
};

export const DEFAULT_LOCALE = 'en';

/**
 * Resolves the active locale from the document language, falling back to the
 * URL path — the same rule the word cloud uses, so both apps behave alike when
 * embedded.
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

/** Translates a document type, leaving an unrecognised one as it came. */
export function translateType(strings, label) {
    return strings.type[label] ?? label;
}
