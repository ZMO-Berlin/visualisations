/**
 * Application root: the one place where dependencies are constructed and wired.
 *
 * Every component below receives what it needs through its constructor, so
 * nothing reaches for a global or a singleton and any piece can be built in
 * isolation. State flows one way — controls call actions on the store, the
 * store publishes a new state, and `render` redraws from it.
 */

import { createSettings } from './config/settings.js';
import { getLocale, getTranslations, translateType } from './utils/translations.js';
import { PublicationService } from './services/PublicationService.js';
import { AppStore } from './store/AppStore.js';
import { isEmpty } from './store/filters.js';
import {
    coauthorGraph, countValues, rank, stackedYearSeries, topKeysWithOther, yearExtent
} from './utils/aggregate.js';
import { el, mount, panel } from './utils/dom.js';
import { Tooltip } from './components/Tooltip.js';
import { Summary } from './components/Summary.js';
import { FilterBar } from './components/FilterBar.js';
import { Timeline } from './components/charts/Timeline.js';
import { BarChart } from './components/charts/BarChart.js';
import { VenueChart } from './components/charts/VenueChart.js';
import { CoauthorNetwork } from './components/charts/CoauthorNetwork.js';
import { PublicationList } from './components/PublicationList.js';

/**
 * The key a publication with no document type is counted under.
 *
 * Empty string rather than a sentinel because it is also the *filter* value:
 * `filters.type.has(record.type ?? '')` is what makes "No document type"
 * selectable like any other type.
 */
const UNTYPED = '';

/** The stacked timeline's bucket for the types below the palette's eighth slot. */
const OTHER_TYPES = '__other__';

/**
 * Type counts, with the untyped records under their own key.
 *
 * `countValues` drops empty keys, which is right for a missing journal name but
 * wrong here: "no document type" is 35 real publications and an answer a reader
 * can act on, not an absence to hide.
 */
function countTypes(records) {
    const counts = countValues(records, record => record.type);
    const untyped = records.filter(record => !record.type).length;
    if (untyped) {
        counts.set(UNTYPED, untyped);
    }
    return counts;
}

/**
 * Resolves the app root from this module's own URL.
 *
 * `main.js` lives at `<root>/src/main.js`, so one level up is the app root.
 * Deriving it means the same files work from a local server, a user site or a
 * project page at any path, with nothing to configure per deployment.
 */
function resolveBasePath() {
    return new URL('../', import.meta.url).href.replace(/\/$/, '');
}

/** A titled frame plus the element its chart draws into. */
function makePanel(options) {
    const body = el('div', {});
    return { section: panel(options, body), body };
}

function bootstrap() {
    const locale = getLocale();
    const strings = getTranslations(locale);
    const settings = createSettings({ basePath: resolveBasePath() });
    const debug = new URLSearchParams(window.location.search).has('debug');

    const service = new PublicationService({ settings });
    const store = new AppStore({ settings: { ...settings, debug }, service });

    const header = document.getElementById('header');
    const status = document.getElementById('status');
    const panels = document.getElementById('panels');
    const tooltip = new Tooltip();

    document.title = strings.title;

    // --- Static chrome ------------------------------------------------------

    const other = locale === 'de' ? 'en' : 'de';
    mount(header, el('div', {}, [
        el('div', { class: 'header__bar' }, [
            el('h1', { class: 'header__title', text: strings.title }),
            el('a', { class: 'header__lang', href: `../${other}/`, lang: other, hreflang: other,
                text: other === 'de' ? 'Deutsch' : 'English' })
        ]),
        el('p', { class: 'header__intro', text: strings.intro })
    ]));

    // Written once, outside `render`, so it is on the page while the data is
    // still loading and stays there if the fetch fails. `target="_blank"`
    // because the dashboard is also embedded in an iframe on zmo.de, where a
    // same-tab link would replace it with a personal site.
    document.getElementById('credit').append(
        el('p', { class: 'credit' }, [
            `${strings.credit} `,
            el('a', {
                href: 'https://www.frederickmadore.com/',
                target: '_blank', rel: 'noopener noreferrer',
                text: 'Frédérick Madore'
            })
        ])
    );

    // --- Panels -------------------------------------------------------------

    const timelinePanel = makePanel({ title: strings.overTime, hint: strings.overTimeHint });
    const typePanel = makePanel({ title: strings.documentTypes });
    const authorPanel = makePanel({ title: strings.topAuthors });
    const venuePanel = makePanel({ title: strings.venues });
    const networkPanel = makePanel({ title: strings.coauthorship, hint: strings.coauthorshipHint });
    const listPanel = makePanel({ title: strings.publicationList });

    timelinePanel.section.classList.add('panel--wide');
    networkPanel.section.classList.add('panel--wide');
    listPanel.section.classList.add('panel--wide');

    panels.replaceChildren(
        timelinePanel.section, typePanel.section, authorPanel.section,
        venuePanel.section, networkPanel.section, listPanel.section
    );

    const summary = new Summary(document.getElementById('summary'), { strings, locale });
    const filterBar = new FilterBar(document.getElementById('filters'), { strings, store });

    /**
     * Document types in a fixed order, with the smallest folded into one
     * bucket, and the palette slot each one owns.
     *
     * Built once from the whole dataset the first time it renders, then never
     * rebuilt: the colour has to follow the document type, not its rank within
     * whatever the reader has currently filtered to.
     */
    let types = null;

    function typeLabel(key) {
        if (key === OTHER_TYPES) {
            return strings.otherTypes;
        }
        return key ? translateType(strings, key) : strings.untyped;
    }

    /** 1-based palette slot; anything unranked falls into the last one. */
    function typeSlot(key) {
        const index = types.order.indexOf(types.keyOf(key));
        return (index === -1 ? types.order.length : index) + 1;
    }

    /**
     * Which legend entries read as selected.
     *
     * The filter holds real document types, so the folded bucket has to be
     * derived: it is on only when every type inside it is.
     */
    function legendSelection(selectedTypes) {
        const selection = new Set(selectedTypes);
        if (types.folded.length && types.folded.every(key => selectedTypes.has(key))) {
            selection.add(OTHER_TYPES);
        }
        return selection;
    }

    const timeline = new Timeline(timelinePanel.body, {
        strings, tooltip,
        get order() { return types.order; },
        formatSeries: typeLabel,
        seriesIndex: typeSlot,
        onSelectYear: year => store.toggleYear(year),
        // The bucket stands for several real types, so selecting it selects all
        // of them — the alternative would be a legend entry that filters to
        // something the type ranking below cannot show.
        onSelectSeries: key => (key === OTHER_TYPES
            ? store.toggleMany('type', types.folded)
            : store.toggle('type', key))
    });

    const typeChart = new BarChart(typePanel.body, {
        settings, strings,
        onSelect: type => store.toggle('type', type),
        formatLabel: typeLabel,
        seriesIndex: typeSlot
    });

    const authorChart = new BarChart(authorPanel.body, {
        settings, strings,
        onSelect: author => store.toggle('author', author)
    });

    const venueChart = new VenueChart(venuePanel.body, { settings, strings, store });

    const network = new CoauthorNetwork(networkPanel.body, {
        settings, strings, tooltip,
        // d3 is loaded by the page as a global; injecting it here keeps the
        // component free of that assumption and testable with a stub.
        d3: window.d3,
        onSelect: author => store.toggle('author', author)
    });

    const list = new PublicationList(listPanel.body, { settings, strings, locale });

    // --- Rendering ----------------------------------------------------------

    /** The year axis stays fixed to the whole dataset so bars keep their place. */
    let fullExtent = null;

    /**
     * Credits the register the data came from.
     *
     * Every number on this page is a reading of someone else's list, and the
     * link is what lets a reader check one. Written once, from the dataset's
     * own record of where it was crawled from.
     */
    let sourceShown = false;
    function renderSource(url) {
        if (sourceShown || !url) {
            return;
        }
        sourceShown = true;
        document.getElementById('source').append(
            el('p', { class: 'source' }, [
                `${strings.source}: `,
                el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url })
            ])
        );
    }

    function render(state, previous) {
        if (state.status === 'loading') {
            status.hidden = false;
            status.replaceChildren(el('p', { class: 'status', text: strings.loading }));
            panels.hidden = true;
            return;
        }

        if (state.status === 'error') {
            status.hidden = false;
            status.replaceChildren(el('div', { class: 'status status--error' }, [
                el('p', { text: strings.error }),
                el('button', {
                    class: 'button', type: 'button', text: strings.retry,
                    on: { click: () => store.load() }
                })
            ]));
            panels.hidden = true;
            return;
        }

        status.hidden = true;
        status.replaceChildren();
        panels.hidden = false;

        fullExtent ??= yearExtent(state.publications);
        types ??= topKeysWithOther(
            countTypes(state.publications), settings.charts.seriesLimit, OTHER_TYPES
        );
        renderSource(state.meta.source);

        const filtered = store.select();
        if (previous && previous.filters !== state.filters) {
            list.resetPaging();
        }

        summary.render(filtered, state.publications, !isEmpty(state.filters));
        filterBar.render(state, fullExtent);

        // Each chart is counted against everything *except* its own dimension,
        // so selecting one bar leaves the alternatives visible to switch to.
        // The timeline is split by document type but filters by year, so it is
        // the year dimension it excludes.
        if (fullExtent) {
            timeline.render({
                series: stackedYearSeries(
                    store.select('years'), fullExtent,
                    record => types.keyOf(record.type || UNTYPED), types.order
                ),
                order: types.order,
                selectedYears: state.filters.years,
                selectedSeries: legendSelection(state.filters.type)
            });
        }

        typeChart.render(rank(countTypes(store.select('type'))), state.filters.type);

        authorChart.render(
            rank(countValues(store.select('author'), record => record.authors)),
            state.filters.author
        );

        venueChart.render(store.select('venue'), state.filters.venue);

        // Like the author ranking, the network excludes the author filter:
        // selecting a node dims the rest instead of collapsing the graph to the
        // one author and their co-authors, which would leave nothing to click
        // next.
        network.render(coauthorGraph(store.select('author'), settings.network), state.filters.author);

        list.render(filtered);
    }

    const unsubscribe = store.subscribe(render);
    render(store.getState(), null);
    store.load();

    // `pagehide` rather than `unload`: `unload` is deprecated, blocks the
    // back/forward cache, and does not fire reliably on mobile Safari.
    window.addEventListener('pagehide', () => {
        unsubscribe();
        [summary, filterBar, timeline, typeChart, authorChart, venueChart, network, list, tooltip]
            .forEach(component => component.destroy());
        store.destroy();
    }, { once: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}
