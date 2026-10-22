/**
 * Research themes: the map, the ranking that cross-filters like every other
 * chart, and — always visible, never behind a toggle — where the themes came
 * from.
 *
 * The provenance line is part of the view rather than a footnote because the
 * names on this panel were written by a language model. A reader who takes
 * "The Gulf states" for ZMO's own heading would be misled; the sentence under
 * the legend is what prevents that.
 */

import { el, mount } from '../utils/dom.js';
import { countValues, rank } from '../utils/aggregate.js';
import { fill } from '../utils/translations.js';
import { BarChart } from './charts/BarChart.js';
import { ThemeMap } from './charts/ThemeMap.js';

export class ThemePanel {
    #built = false;

    constructor(container, { settings, strings, locale, tooltip, store }) {
        Object.assign(this, { container, settings, strings, locale, tooltip, store });
        this.legend = el('div', { class: 'map-legend', role: 'group', 'aria-label': strings.areas });
        this.mapBody = el('div', { class: 'theme-panel__map' });
        this.rankingBody = el('div', { class: 'theme-panel__ranking' });
        this.notes = el('div', { class: 'theme-panel__notes' });
        // Pointing at a theme or an area beside the map lights its points.
        const highlight = (selector, idsOf) => ({
            pointerover: event => { const key = event.target.closest?.(selector)?.dataset.key; if (key) this.map?.highlight(idsOf(key)); },
            pointerleave: () => this.map?.highlight(null),
            focusin: event => { const key = event.target.closest?.(selector)?.dataset.key; if (key) this.map?.highlight(idsOf(key)); },
            focusout: () => this.map?.highlight(null)
        });
        for (const [type, handler] of Object.entries(highlight('.bar', key => [key]))) this.rankingBody.addEventListener(type, handler);
        for (const [type, handler] of Object.entries(highlight('.map-legend__item', key => this.themes.areas.find(a => a.id === key)?.themes ?? []))) {
            this.legend.addEventListener(type, handler);
        }
        mount(container, el('div', { class: 'theme-panel' }, [
            this.legend,
            el('div', { class: 'theme-panel__grid' }, [
                this.mapBody,
                el('div', {}, [el('h3', { class: 'theme-panel__subtitle', text: strings.themeRanking }), this.rankingBody])
            ]),
            this.notes
        ]));
    }

    /** Label, description and palette slot of a theme, in the page's language. */
    configure(themes) {
        this.themes = themes;
        this.byId = new Map(themes.themes.map(theme => [theme.id, theme]));
        this.slotOf = new Map();
        themes.areas.forEach((area, index) => area.themes.forEach(id => this.slotOf.set(id, index + 1)));
        const text = value => value?.[this.locale] ?? value?.en ?? '';
        this.label = id => text(this.byId.get(id)?.label) || id;
        this.describe = id => text(this.byId.get(id)?.description);

        this.map = new ThemeMap(this.mapBody, {
            settings: this.settings, strings: this.strings, locale: this.locale, tooltip: this.tooltip,
            themeLabel: this.label, areaSlot: id => this.slotOf.get(id) ?? 8,
            onSelectTheme: id => this.store.toggle('theme', id)
        });
        // All themes on one page: beside the map the ranking is a legend as
        // much as a chart, and a legend that pages hides half its key.
        const settings = { ...this.settings, charts: { ...this.settings.charts, pageSize: themes.themes.length } };
        this.ranking = new BarChart(this.rankingBody, {
            settings, strings: this.strings,
            onSelect: id => this.store.toggle('theme', id),
            formatLabel: this.label,
            formatTitle: (id, count) => `${this.label(id)} — ${count}\n${this.describe(id)}`,
            seriesIndex: id => this.slotOf.get(id) ?? 8
        });
    }

    render(state, rankingRecords, filtered) {
        if (!this.themes) return;
        if (!this.#built) {
            this.#built = true;
            this.map.build(state.publications, this.themes);
            this.#renderNotes();
        }
        this.#renderLegend(state.filters.theme);
        this.map.update(filtered);
        this.ranking.render(rank(countValues(rankingRecords, record => record.theme)), state.filters.theme);
    }

    /** One button per area; it selects all of the area's themes, or clears them. */
    #renderLegend(selected) {
        mount(this.legend, el('div', { class: 'map-legend__items' }, this.themes.areas.map((area, index) => {
            const on = area.themes.every(id => selected.has(id));
            return el('button', {
                type: 'button',
                class: `map-legend__item${on ? ' map-legend__item--on' : ''}`,
                'aria-pressed': String(on),
                dataset: { key: area.id },
                title: area.description[this.locale] ?? area.description.en,
                on: { click: () => this.store.toggleMany('theme', area.themes) }
            }, [
                el('span', { class: `map-legend__swatch series-${index + 1}`, 'aria-hidden': 'true' }),
                area.label[this.locale] ?? area.label.en
            ]);
        })));
    }

    #renderNotes() {
        const { attribution, points } = this.themes;
        const date = new Intl.DateTimeFormat(this.locale, { dateStyle: 'long' }).format(new Date(attribution.labels.date));
        mount(this.notes, el('div', {}, [
            el('p', { class: 'provenance' }, [
                el('span', { class: 'provenance__badge', text: 'AI' }),
                fill(this.strings.themeProvenance, { model: 'EmbeddingGemma 2', date }),
                ' ',
                el('a', { href: attribution.embedding.url, target: '_blank', rel: 'noopener noreferrer', text: attribution.embedding.model })
            ]),
            points.added.length ? el('p', { class: 'explore-hint', text: fill(this.strings.themesAdded, { n: points.added.length }) }) : null
        ]));
    }

    destroy() {
        this.map?.destroy();
        this.ranking?.destroy();
        this.container.replaceChildren();
    }
}
