/**
 * Regions studied: the world map, the place ranking that cross-filters like
 * every other chart, a legend of regions that filters by region, and — always
 * on the panel, not behind a toggle — how places were found and what that
 * means: a place named is not always a place studied, and a record with an
 * abstract has more text to name one in.
 *
 * Below, the regional focus current researchers state on their zmo.de pages,
 * grouped by region: the institute's own description of where it works,
 * beside what its publications name.
 */

import { el, mount } from '../utils/dom.js';
import { countValues, rank } from '../utils/aggregate.js';
import { fill } from '../utils/translations.js';
import { BarChart } from './charts/BarChart.js';
import { WorldMap } from './charts/WorldMap.js';

export class RegionPanel {
    #built = false;

    constructor(container, { settings, strings, locale, tooltip, store, service }) {
        Object.assign(this, { container, settings, strings, locale, tooltip, store, service });
        this.legend = el('div', { class: 'map-legend', role: 'group', 'aria-label': strings.regions });
        this.mapBody = el('div', { class: 'theme-panel__map' }, [el('p', { class: 'view-status', text: strings.loadingLayer })]);
        this.rankingBody = el('div', { class: 'theme-panel__ranking' });
        this.count = el('p', { class: 'explore-hint' });
        this.notes = el('div', { class: 'theme-panel__notes' });
        this.focusBody = el('div');
        mount(container, el('div', { class: 'theme-panel' }, [
            this.legend,
            el('div', { class: 'theme-panel__grid' }, [
                this.mapBody,
                el('div', {}, [el('h3', { class: 'theme-panel__subtitle', text: strings.places }), this.rankingBody])
            ]),
            this.count,
            this.notes,
            el('details', { class: 'analysis-section' }, [el('summary', { text: strings.focus }), this.focusBody])
        ]));
    }

    configure(regions) {
        this.regions = regions;
        this.place = new Map(regions.places.map(place => [place.id, place]));
        this.macro = new Map(regions.macros.map(macro => [macro.id, macro]));
        this.label = id => this.place.get(id)?.label[this.locale] ?? this.place.get(id)?.label.en ?? id;
        this.macroLabel = id => this.macro.get(id)?.label[this.locale] ?? id;
        this.slotOf = macroId => this.macro.get(macroId)?.slot ?? null;
        this.placeSlot = id => this.slotOf(this.place.get(id)?.macro) ?? 'none';

        this.ranking = new BarChart(this.rankingBody, {
            settings: this.settings, strings: this.strings,
            onSelect: id => this.store.toggle('place', id),
            formatLabel: this.label,
            formatTitle: (id, count) => `${this.label(id)} — ${count}\n${this.macroLabel(this.place.get(id)?.macro)}`,
            seriesIndex: this.placeSlot
        });
        this.map = new WorldMap(this.mapBody, {
            d3: window.d3, topojson: window.topojson, strings: this.strings, tooltip: this.tooltip,
            label: this.label, slotOf: this.slotOf,
            onSelectPlace: id => this.store.toggle('place', id)
        });
    }

    render(state, records, filtered) {
        if (!this.regions) return;
        if (!this.#built) {
            this.#built = true;
            this.#renderNotes();
            this.#renderFocus();
            this.service.loadWorld()
                .then(world => {
                    if (!window.d3 || !window.topojson) throw new Error('d3 or topojson-client unavailable');
                    this.map.build(world, this.regions.places);
                    this.map.update(this.counts ?? new Map(), this.store.getState().filters.place);
                })
                .catch(error => { console.error(error); mount(this.mapBody, el('p', { class: 'view-status', text: this.strings.layerError })); });
        }
        this.counts = countValues(records, record => record.places);
        this.#renderLegend(state.filters.region);
        this.map.update(this.counts, state.filters.place);
        this.ranking.render(rank(this.counts), state.filters.place);
        this.count.textContent = fill(this.strings.regionsCount, {
            n: filtered.filter(record => record.places?.length).length, total: filtered.length
        });
    }

    #renderLegend(selected) {
        mount(this.legend, el('div', { class: 'map-legend__items' }, this.regions.macros.map(macro => {
            const on = selected.has(macro.id);
            return el('button', {
                type: 'button',
                class: `map-legend__item${on ? ' map-legend__item--on' : ''}`,
                'aria-pressed': String(on),
                dataset: { key: macro.id },
                on: { click: () => this.store.toggle('region', macro.id) }
            }, [
                el('span', { class: `map-legend__swatch series-${macro.slot ?? 'none'}`, 'aria-hidden': 'true' }),
                macro.label[this.locale] ?? macro.label.en
            ]);
        })));
    }

    #renderNotes() {
        const { attribution } = this.regions;
        const reviewed = attribution.reviewed ?? {};
        const date = reviewed.date ? new Intl.DateTimeFormat(this.locale, { dateStyle: 'long' }).format(new Date(reviewed.date)) : '';
        mount(this.notes, el('p', { class: 'provenance' }, [
            fill(this.strings.regionsProvenance, {
                count: attribution.gazetteer, by: reviewed.by ?? '—', date,
                scope: (this.locale === 'de' && reviewed.scope_de) || reviewed.scope || ''
            })
        ]));
    }

    #renderFocus() {
        const byMacro = new Map();
        for (const person of this.regions.focus) {
            for (const macro of new Set(person.places.map(id => this.place.get(id)?.macro).filter(Boolean))) {
                if (!byMacro.has(macro)) byMacro.set(macro, []);
                byMacro.get(macro).push(person);
            }
        }
        mount(this.focusBody, el('div', {}, [
            el('p', { class: 'explore-hint', text: this.strings.focusHint }),
            el('dl', { class: 'focus-list' }, this.regions.macros.filter(macro => byMacro.has(macro.id)).flatMap(macro => [
                el('dt', {}, [el('span', { class: `legend-swatch series-${macro.slot ?? 'none'}`, 'aria-hidden': 'true' }), macro.label[this.locale] ?? macro.label.en]),
                el('dd', {}, byMacro.get(macro.id).flatMap((person, index) => [
                    index ? ', ' : '',
                    el('a', {
                        href: person.url, target: '_blank', rel: 'noopener noreferrer', title: person.text,
                        text: person.name
                    })
                ]))
            ]))
        ]));
    }

    destroy() {
        this.map?.destroy();
        this.ranking?.destroy();
        this.container.replaceChildren();
    }
}
