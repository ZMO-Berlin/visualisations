/**
 * UI strings, in the two languages the site is published in.
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
        series: 'Series',

        showMore: 'Show more',
        previousPage: 'Previous page',
        nextPage: 'Next page',

        publicationList: 'Publications',
        noResults: 'No publication matches the current filters.',
        untyped: 'No document type',
        openOnZmo: 'View on zmo.de',

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

    fr: {
        title: 'Publications du ZMO',
        intro: 'Toutes les publications du répertoire du ZMO, par année, type, auteur et support.',
        source: 'Source',

        loading: 'Chargement des publications…',
        error: 'Les données de publication n’ont pas pu être chargées.',
        retry: 'Réessayer',

        publications: 'publications',
        authors: 'auteurs',
        years: 'années',
        ofTotal: 'sur',

        search: 'Rechercher un titre, un auteur, une revue…',
        from: 'De',
        to: 'À',
        clearFilters: 'Effacer les filtres',
        activeFilters: 'Filtres actifs',
        removeFilter: 'Retirer ce filtre',

        overTime: 'Publications par année',
        overTimeHint: 'Cliquez sur une colonne pour filtrer par année, ou sur une entrée de la légende pour filtrer par type. Les types les plus rares sont regroupés.',
        otherTypes: 'Autres types',
        documentTypes: 'Types de document',
        topAuthors: 'Auteurs les plus publiés',
        venues: 'Où le ZMO publie',
        coauthorship: 'Co-publication',
        coauthorshipHint: 'Auteurs ayant publié ensemble. Déplacez un nœud pour réorganiser ; cliquez pour filtrer.',
        noCoauthors: 'Aucune publication co-signée ne correspond aux filtres.',
        noData: 'Rien à afficher pour les filtres actifs.',

        journals: 'Revues',
        publishers: 'Éditeurs',
        series: 'Collections',

        showMore: 'Afficher plus',
        previousPage: 'Page précédente',
        nextPage: 'Page suivante',

        publicationList: 'Publications',
        noResults: 'Aucune publication ne correspond aux filtres.',
        untyped: 'Sans type de document',
        openOnZmo: 'Voir sur zmo.de',

        type: {
            'Monographs': 'Monographies',
            'Book reviews': 'Comptes rendus',
            'Contributions to an edited volume': 'Contributions à un ouvrage collectif',
            'Editorship of journal, book series': 'Direction de revue ou de collection',
            'Edited volumes': 'Ouvrages collectifs',
            'Journal articles': 'Articles de revue',
            'Other publications': 'Autres publications',
            'Special Issues': 'Numéros spéciaux',
            'Working Papers': 'Documents de travail'
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
