import { showFreshness } from '../../shared/freshness.js';
import { bindLifecycle, writeParams } from '../../shared/state-url.js';
import { exploreStrings } from '../../shared/explore-strings.js';
import { copyView, csv, download } from '../../shared/download.js';
import { exportTimeline } from '../../shared/chart-export.js';
import { decodeFilters, encodeFilters, FILTER_KEYS } from './store/url.js';
import { Analysis } from './components/Analysis.js';
import { AuthorProfiles } from './components/AuthorProfiles.js';
import { enrichedSections } from './components/EnrichedSections.js';
import { ThemePanel } from './components/ThemePanel.js';
import { RegionPanel } from './components/RegionPanel.js';
import { YearRange } from './components/YearRange.js';
/**
 * Application root: the one place where dependencies are constructed and wired.
 *
 * Every component below receives what it needs through its constructor, so
 * nothing reaches for a global or a singleton and any piece can be built in
 * isolation. State flows one way — controls call actions on the store, the
 * store publishes a new state, and `render` redraws from it.
 */

import { createSettings } from './config/settings.js';
import { fill, getLocale, getTranslations, languageName, translateType } from './utils/translations.js';
import { PublicationService } from './services/PublicationService.js';
import { AppStore } from './store/AppStore.js';
import { accessOf, isEmpty, UNDETERMINED } from './store/filters.js';
import {
    coauthorGraph, countValues, rank, stackedYearSeries, topKeysWithOther, yearExtent
} from './utils/aggregate.js';
import { el, fullscreenButton, mount, panel } from './utils/dom.js';
import { formatNumber } from './utils/format.js';
import { Tooltip } from './components/Tooltip.js';
import { Summary } from './components/Summary.js';
import { FilterBar } from './components/FilterBar.js';
import { FilterDock } from './components/FilterDock.js';
import { ReadingPlace } from './utils/reading-place.js';
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
    const extra = exploreStrings(locale);
    const settings = createSettings({ basePath: resolveBasePath() });
    const debug = new URLSearchParams(window.location.search).has('debug');

    const service = new PublicationService({ settings });
    const store = new AppStore({ settings: { ...settings, debug }, service });
    store.replaceFilters(decodeFilters(location.search));

    const header = document.getElementById('header');
    const status = document.getElementById('status');
    const panels = document.getElementById('panels');
    const place = new ReadingPlace(panels.closest('main') ?? document.body);
    const tooltip = new Tooltip();

    document.title = strings.title;

    // --- Static chrome ------------------------------------------------------

    // The language link that used to live here has moved to the shared site
    // bar, which carries it on all three pages — and knows how to send a reader
    // to the same view in the other language rather than to its front page.
    mount(header, el('div', { class: 'header__bar' }, [
        el('div', { class: 'header__text' }, [
            el('p', { class: 'eyebrow', text: strings.register }),
            el('h1', { class: 'header__title', text: strings.heading }),
            el('p', { class: 'header__intro', text: strings.intro })
        ]),
        // Filled by `renderSource` once the dataset says where it was crawled.
        el('div', { id: 'source', class: 'header__source' })
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

    // Every chart panel can be shown on the whole screen.
    const fullscreen = { enter: strings.fullscreen, exit: strings.exitFullscreen };
    const timelinePanel = makePanel({ title: strings.overTime, hint: strings.overTimeHint, fullscreen });
    const themesPanel = makePanel({ title: strings.themes, hint: strings.themesHint, fullscreen });
    const regionsPanel = makePanel({ title: strings.regions, hint: strings.regionsHint, fullscreen });
    const typePanel = makePanel({ title: strings.documentTypes, fullscreen });
    const authorPanel = makePanel({ title: strings.topAuthors, fullscreen });
    const languagePanel = makePanel({ title: strings.languages, hint: strings.languagesHint, fullscreen });
    const accessPanel = makePanel({ title: strings.access, hint: strings.accessHint, fullscreen });
    const subjectsPanel = makePanel({ title: strings.subjects, fullscreen });
    const venuePanel = makePanel({ title: strings.venues, fullscreen });
    const networkPanel = makePanel({ title: strings.coauthorship, hint: strings.coauthorshipHint });
    const listPanel = makePanel({ title: strings.publicationList });

    timelinePanel.section.classList.add('panel--wide');
    themesPanel.section.classList.add('panel--wide');
    themesPanel.section.hidden = true;
    regionsPanel.section.classList.add('panel--wide');
    regionsPanel.section.hidden = true;
    subjectsPanel.section.classList.add('panel--wide');
    subjectsPanel.section.hidden = true;
    networkPanel.section.classList.add('panel--wide');
    venuePanel.section.classList.add('panel--wide');
    listPanel.section.id = 'publication-results';
    listPanel.section.classList.add('panel--wide');

    panels.replaceChildren(
        timelinePanel.section, themesPanel.section, regionsPanel.section, typePanel.section, authorPanel.section,
        languagePanel.section, accessPanel.section, subjectsPanel.section,
        venuePanel.section, networkPanel.section, listPanel.section
    );

    // Under the timeline, inside its panel: a second way to set the same years.
    const yearRangeBox = el('div', { class: 'year-range-slot' });
    timelinePanel.section.append(yearRangeBox);
    const yearRange = new YearRange(yearRangeBox, { strings, store });

    // Built before the analysis sections and the list, which borrow its theme
    // labels and colours; configured once the themes file has arrived.
    const themePanel = new ThemePanel(themesPanel.body, { settings, strings, locale, tooltip, store });
    const themeLabel = id => themePanel.label?.(id) ?? id;
    const themeSlot = id => themePanel.slotOf?.get(id) ?? 8;
    const personOf = name => store.getState().people[name];

    const regionPanel = new RegionPanel(regionsPanel.body, { settings, strings, locale, tooltip, store, service });
    const placeLabel = id => regionPanel.label?.(id) ?? id;
    const headingLabel = id => store.getState().subjects?.headings?.[id]?.label ?? id;

    const analysisBody = el('div');
    const analysisPanel = panel({ title: extra.analysis, fullscreen }, analysisBody);
    analysisPanel.classList.add('panel--wide');
    networkPanel.section.before(analysisPanel);
    const analysis = new Analysis(analysisBody, {
        store, strings: extra, typeLabel,
        sections: enrichedSections({ store, strings, locale, service, d3: window.d3, tooltip, themePanel, regionPanel })
    });
    const networkContent = networkPanel.section.querySelector('.panel__body');
    const disclosure = el('details', { class: 'analysis-section' }, [el('summary', { text: strings.coauthorship }), networkContent]);
    networkPanel.section.append(disclosure);
    networkPanel.section.querySelector('.panel__head').hidden = true;
    networkContent.prepend(
        // The panel's own head is hidden behind the disclosure, so its
        // full-screen button sits with the graph.
        el('div', { class: 'fullscreen-row' }, [fullscreenButton(networkPanel.section, fullscreen)]),
        el('p', { class: 'explore-hint', text: `${extra.networkLegend} ${strings.networkZmo}` })
    );
    disclosure.addEventListener('toggle', () => {
        if (disclosure.open) renderNetwork(); else network.suspend();
    });
    const methods = el('details', { class: 'methodology' }, [el('summary', { text: extra.methodology }), el('p', { text: extra.publicationMethod })]);
    const sources = el('p');
    const coverage = el('p'); methods.append(sources, coverage);
    header.after(methods);
    showFreshness('publication', methods, locale, extra.refresh);
    const actions = el('div', { class: 'explore-actions' });
    const exportStatus = el('span', { role: 'status' });
    const scope = () => encodeFilters(store.getState().filters).map(([key, value]) => `${key}: ${value}`).join(' · ') || extra.publications;
    actions.append(el('a', { href: '#publication-results', text: extra.viewRecords }),
        el('button', { type: 'button', text: extra.copyLink, on: { click: e => copyView(e.currentTarget, extra) } }),
        el('button', { type: 'button', text: extra.csv, dataset: { export: '' }, on: { click: () => {
            const state = store.getState();
            download(csv([['title', 'authors', 'year', 'type', 'journal', 'publisher', 'doi', 'url', 'language_detected', 'theme_ai_label', 'places_named', 'gnd_subjects', 'open_access_openalex', 'openalex', 'dataset', 'scope'],
                ...store.select().map(r => [r.title, r.authors?.join('; '), r.year, r.type, r.journal, r.publisher, r.doi, r.url,
                    r.lang ?? UNDETERMINED, r.theme ? themeLabel(r.theme) : '', (r.places ?? []).map(placeLabel).join('; '),
                    (r.gnd ?? []).map(headingLabel).join('; '), accessOf(r), r.openalex, state.meta.datasetId, scope()])]), 'zmo-publications.csv');
        } } }));
    for (const format of ['svg', 'png']) actions.append(el('button', { type: 'button', text: extra[format], dataset: { export: '' }, on: { click: async e => {
        const button = e.currentTarget; button.disabled = true;
        try {
            const state = store.getState(); const span = yearExtent(store.select());
            const rows = span ? stackedYearSeries(store.select(), span, () => '*', ['*']) : [];
            await exportTimeline(rows, { title: strings.overTime, source: state.meta.source, datasetId: state.meta.datasetId, scope: scope(), locale }, format);
            exportStatus.textContent = '';
        } catch { exportStatus.textContent = extra.exportError; }
        finally { button.disabled = false; }
    } } }));
    actions.append(exportStatus);
    const profilesSlot = el('div', { class: 'profiles-slot', hidden: true });
    document.getElementById('filters').after(profilesSlot, actions, el('p', { class: 'explore-hint', text: extra.scope }));
    const profiles = new AuthorProfiles(profilesSlot, { strings });
    listPanel.section.append(el('a', { href: '#filters', text: extra.backFilters }));

    // Order matters: the filter bar owns the command panel, and the summary is
    // written into a slot inside it.
    const filterBar = new FilterBar(document.getElementById('filters'), {
        strings, store,
        labels: {
            theme: themeLabel,
            lang: code => languageName(strings, locale, code),
            access: value => strings.accessLabel[value] ?? value,
            region: id => regionPanel.macroLabel?.(id) ?? id,
            place: placeLabel,
            gnd: headingLabel
        }
    });
    const summary = new Summary(filterBar.countsSlot, { strings, locale });
    const filterDock = new FilterDock({ filterBar, strings, extra, locale });

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

    const languageChart = new BarChart(languagePanel.body, {
        settings, strings,
        onSelect: code => store.toggle('lang', code),
        formatLabel: code => languageName(strings, locale, code)
    });

    // Fixed order rather than ranked: unknown is the largest bar and would
    // otherwise come first, reading as the headline.
    const ACCESS = ['open', 'closed', 'unknown'];
    const accessChart = new BarChart(accessPanel.body, {
        settings, strings,
        onSelect: value => store.toggle('access', value),
        formatLabel: value => strings.accessLabel[value] ?? value
    });

    const network = new CoauthorNetwork(networkPanel.body, {
        settings, strings, locale, tooltip,
        // d3 is loaded by the page as a global; injecting it here keeps the
        // component free of that assumption and testable with a stub.
        d3: window.d3,
        onSelect: author => store.toggle('author', author),
        personOf
    });

    const subjectsHint = el('p', { class: 'explore-hint' });
    const subjectsBars = el('div');
    subjectsPanel.body.append(subjectsHint, subjectsBars);
    const subjectChart = new BarChart(subjectsBars, {
        settings, strings,
        onSelect: id => store.toggle('gnd', id),
        formatLabel: headingLabel
    });

    const list = new PublicationList(listPanel.body, {
        settings, strings, locale,
        formatLabel: typeLabel,
        seriesIndex: typeSlot,
        enrichment: {
            person: personOf,
            themeLabel, themeSlot,
            languageName: code => languageName(strings, locale, code),
            onTheme: id => store.toggle('theme', id),
            placeLabel, placeSlot: id => regionPanel.placeSlot?.(id) ?? 'none',
            onPlace: id => store.toggle('place', id),
            headingLabel,
            onHeading: id => store.toggle('gnd', id)
        }
    });

    // --- Rendering ----------------------------------------------------------

    /** The whole register's year span: the slider's limits and the default axis. */
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
                el('span', { class: 'source__label', text: strings.source }),
                el('a', {
                    class: 'source__link', href: url,
                    target: '_blank', rel: 'noopener noreferrer',
                    // The scheme is noise in a caption; the link carries it.
                    text: url.replace(/^https?:\/\/(www\.)?/, '')
                })
            ])
        );
    }

    const derived = new WeakMap();
    function memo(records, key, calculate) {
        if (!derived.has(records)) derived.set(records, new Map());
        const cache = derived.get(records);
        if (!cache.has(key)) cache.set(key, calculate(records));
        return cache.get(key);
    }
    function safely(component, fn) {
        try { fn(); }
        catch (error) {
            console.error(error);
            mount(component.container, el('p', { role: 'status', text: extra.chartFailed }));
        }
    }
    function renderNetwork() {
        if (store.getState().status !== 'ready') return;
        safely(network, () => {
            if (!window.d3) throw new Error('D3 unavailable');
            network.render(memo(store.select('author'), 'graph', records => coauthorGraph(records, settings.network)), store.getState().filters.author);
            network.resume();
        });
    }
    function render(state, previous) {
        for (const button of actions.querySelectorAll('[data-export]')) button.disabled = state.status !== 'ready';
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
        coverage.textContent = `${extra.missing}: ${state.meta.counts.withoutYear} ${extra.undated}; ${state.meta.counts.untyped} ${extra.untyped}. Dataset ${state.meta.datasetId}.`;
        sources.textContent = fill(strings.sourcesNote, Object.fromEntries(Object.entries(state.meta.coverage ?? {})
            .map(([key, value]) => [key, typeof value === 'number' ? formatNumber(value, locale) : value])));
        if (state.themes && !themePanel.themes) {
            themePanel.configure(state.themes);
            themesPanel.section.hidden = false;
        }
        if (state.regions && !regionPanel.regions) {
            regionPanel.configure(state.regions);
            regionsPanel.section.hidden = false;
        }
        if (state.subjects && subjectsPanel.section.hidden) {
            subjectsPanel.section.hidden = false;
            subjectsHint.textContent = fill(strings.subjectsHint, {
                with: formatNumber(state.subjects.coverage.withHeadings, locale),
                books: formatNumber(state.subjects.coverage.books, locale)
            });
        }
        writeParams(encodeFilters(state.filters), FILTER_KEYS);

        const filtered = store.select();
        if (previous && previous.filters !== state.filters) {
            list.resetPaging();
        }

        summary.render(filtered, state.publications, !isEmpty(state.filters));
        filterBar.render(state, fullExtent);
        filterDock.render(state.filters, filtered.length, state.publications.length);

        // Each chart is counted against everything *except* its own dimension,
        // so selecting one bar leaves the alternatives visible to switch to.
        // The timeline is split by document type but filters by year, so it is
        // the year dimension it excludes.
        //
        // A range of several years — from the slider or the selects — zooms
        // the axis to it, as a reader dragging a slider expects. A single year,
        // usually a clicked column, keeps the whole axis with that column
        // marked, so the next year is still there to click.
        if (fullExtent) {
            const years = state.filters.years;
            const zoomed = Boolean(years && years[0] < years[1]);
            safely(timeline, () => timeline.render({
                series: stackedYearSeries(
                    store.select('years'), zoomed ? years : fullExtent,
                    record => types.keyOf(record.type || UNTYPED), types.order
                ),
                order: types.order,
                selectedYears: zoomed ? null : years,
                selectedSeries: legendSelection(state.filters.type)
            }));
        }

        safely(typeChart, () => typeChart.render(memo(store.select('type'), 'types', r => rank(countTypes(r))), state.filters.type));

        safely(authorChart, () => authorChart.render(memo(store.select('author'), 'authors', r => rank(countValues(r, record => record.authors))), state.filters.author));

        safely(venueChart, () => venueChart.render(store.select('venue'), state.filters.venue));

        safely(themePanel, () => themePanel.render(state, store.select('theme'), filtered));
        safely(regionPanel, () => regionPanel.render(state, store.select('place'), filtered));
        safely(subjectChart, () => subjectChart.render(memo(store.select('gnd'), 'gnd', r => rank(countValues(r, record => record.gnd))), state.filters.gnd));
        yearRange.render(fullExtent, state.filters.years);
        safely(languageChart, () => languageChart.render(memo(store.select('lang'), 'langs', r => rank(countValues(r, record => record.lang ?? UNDETERMINED))), state.filters.lang));
        safely(accessChart, () => accessChart.render(memo(store.select('access'), 'access', r => {
            const counts = countValues(r, accessOf);
            return ACCESS.filter(key => counts.get(key)).map(key => ({ key, count: counts.get(key) }));
        }), state.filters.access));
        profiles.render(state.filters.author, state.people);

        // Like the author ranking, the network excludes the author filter: the
        // whole graph stays on screen instead of collapsing to the one author
        // and their co-authors, which would leave nothing to click next. The
        // selection is what it moves and dims the picture around — see the head
        // of CoauthorNetwork.js.
        if (disclosure.open) renderNetwork();
        safely(analysis, () => analysis.render(filtered, state.publications, state.filters));

        safely(list, () => list.render(filtered));
        if (!filtered.length) list.container.append(el('button', { type: 'button', class: 'button', text: extra.reset, on: { click: () => store.clearFilters() } }));
    }

    // A filter change re-lays the page above the reader: keep their place
    // (see utils/reading-place.js).
    const unsubscribe = store.subscribe((state, previous) => {
        const chain = previous && previous.filters !== state.filters && state.status === 'ready' ? place.mark() : null;
        render(state, previous);
        place.restore(chain);
    });
    render(store.getState(), null);
    store.load();

    const restore = () => store.replaceFilters(decodeFilters(location.search));
    window.addEventListener('popstate', restore);
    bindLifecycle({ suspend: () => network.suspend(), resume: () => { if (disclosure.open) network.resume(); }, destroy: () => {
        window.removeEventListener('popstate', restore);
        unsubscribe();
        [place, summary, filterBar, filterDock, timeline, typeChart, authorChart, venueChart, themePanel, regionPanel, subjectChart, yearRange,
            languageChart, accessChart, profiles, network, list, tooltip, analysis].forEach(component => component.destroy());
        store.destroy();
    } });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
else bootstrap();
