/**
 * The "Explore patterns" sections built on the enrichment layers: themes and
 * languages over time, collaborating institutions, and citations.
 *
 * Each is a `{ key, title, render(body, context) }` handed to `Analysis`,
 * which opens and redraws it like its own sections. Everything is counted
 * against the current selection, and the two OpenAlex sections state, before
 * any figure, how much of that selection OpenAlex covers — the honest
 * denominator is the first thing on screen, not a footnote under the chart.
 */

import { el, mount } from '../utils/dom.js';
import { Pager } from '../../../shared/pager.js';
import { fill, languageName } from '../utils/translations.js';
import { CitationNetwork } from './charts/CitationNetwork.js';

const PERIOD = 5;

/** Five-year periods spanning the register, oldest first. */
function periods(all) {
    const years = all.map(record => record.year).filter(Boolean);
    if (!years.length) return [];
    const first = Math.floor(Math.min(...years) / PERIOD) * PERIOD;
    const last = Math.max(...years);
    const result = [];
    for (let start = first; start <= last; start += PERIOD) result.push([start, start + PERIOD - 1]);
    return result;
}

function periodLabel([start, end]) {
    return `${start}–${String(end).slice(-2)}`;
}

function sourceList(records) {
    return el('ul', {}, records.map(record => el('li', {}, [el('a', {
        href: record.url, target: '_blank', rel: 'noopener noreferrer',
        text: `${record.year ? `${record.year} · ` : ''}${[record.title, record.subtitle].filter(Boolean).join(': ') || record.slug}`
    })])));
}

/**
 * A row-per-category, column-per-period table whose cells are shaded by the
 * category's share of that period and labelled with the count.
 */
function shareTable({ caption, rows, columns, cell, header }) {
    return el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': caption }, [
        el('table', { class: 'explore-table share-table' }, [
            el('caption', { text: caption }),
            el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: '' }), ...columns.map(c => el('th', { scope: 'col', text: periodLabel(c) }))])]),
            el('tbody', {}, rows.map(row => el('tr', {}, [el('th', { scope: 'row' }, header(row)), ...columns.map(column => cell(row, column))])))
        ])
    ]);
}

export function enrichedSections({ store, strings, locale, service, d3, tooltip, themePanel, regionPanel }) {
    let openalex = null;
    const loadOpenAlex = () => {
        const { meta, publications } = store.getState();
        return service.loadOpenAlex(meta, publications.length).then(data => (openalex = data));
    };

    /** Draws `draw(data)` once OpenAlex's file is in, with loading and failure states. */
    function withOpenAlex(body, draw) {
        if (openalex) return draw(openalex);
        mount(body, el('p', { class: 'view-status', text: strings.loadingLayer }));
        loadOpenAlex().then(draw).catch(error => {
            console.error(error);
            mount(body, el('div', {}, [el('p', { text: strings.layerError }),
                el('button', { type: 'button', class: 'button', text: strings.retry, on: { click: () => withOpenAlex(body, draw) } })]));
        });
    }

    const themesOverTime = {
        key: 'themesOverTime',
        title: strings.themesOverTime,
        available: () => Boolean(store.getState().themes),
        render(body, { all, filters }) {
            // Like the rankings, counted without its own filter, so choosing a
            // theme highlights its row instead of deleting the others.
            const records = store.select('theme');
            const columns = periods(all);
            const { themes } = store.getState();
            const ordered = themes.areas.flatMap(area => area.themes);
            const totals = new Map(columns.map(c => [c[0], 0]));
            const counts = new Map();
            for (const record of records) {
                if (!record.year || !record.theme) continue;
                const start = Math.floor(record.year / PERIOD) * PERIOD;
                totals.set(start, (totals.get(start) ?? 0) + 1);
                const key = `${record.theme}|${start}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            const rows = ordered.filter(id => columns.some(c => counts.get(`${id}|${c[0]}`)));
            mount(body, el('div', {}, [
                el('p', { class: 'explore-hint', text: strings.themesOverTimeHint }),
                rows.length ? shareTable({
                    caption: strings.themesOverTime,
                    rows, columns,
                    header: id => [el('span', { class: `legend-swatch series-${themePanel.slotOf.get(id) ?? 8}`, 'aria-hidden': 'true' }),
                        filters.theme.has(id) ? el('strong', { text: themePanel.label(id) }) : themePanel.label(id)],
                    cell: (id, column) => {
                        const count = counts.get(`${id}|${column[0]}`) ?? 0;
                        const share = count / (totals.get(column[0]) || 1) * 100;
                        return el('td', { class: 'matrix-cell number', style: { '--share': `${share.toFixed(1)}%` } }, [count
                            ? el('button', {
                                type: 'button', text: String(count),
                                'aria-label': `${themePanel.label(id)}, ${periodLabel(column)}: ${count} (${share.toFixed(0)}%)`,
                                on: { click: () => store.focusTheme(id, column) }
                            })
                            : '']);
                    }
                }) : el('p', { text: strings.noResults })
            ]));
        }
    };

    const languagesOverTime = {
        key: 'languagesOverTime',
        title: strings.languagesOverTime,
        available: () => true,
        render(body, { all, filters }) {
            const records = store.select('lang');
            const columns = periods(all);
            const totals = new Map();
            const counts = new Map();
            const overall = new Map();
            for (const record of records) {
                const lang = record.lang ?? 'und';
                overall.set(lang, (overall.get(lang) ?? 0) + 1);
                if (!record.year) continue;
                const start = Math.floor(record.year / PERIOD) * PERIOD;
                totals.set(start, (totals.get(start) ?? 0) + 1);
                counts.set(`${lang}|${start}`, (counts.get(`${lang}|${start}`) ?? 0) + 1);
            }
            const rows = [...overall.keys()].sort((a, b) => overall.get(b) - overall.get(a) || a.localeCompare(b));
            mount(body, el('div', {}, [
                el('p', { class: 'explore-hint', text: strings.languagesHint }),
                shareTable({
                    caption: strings.languagesOverTime, rows, columns,
                    header: code => [filters.lang.has(code) ? el('strong', { text: languageName(strings, locale, code) }) : languageName(strings, locale, code)],
                    cell: (code, column) => {
                        const count = counts.get(`${code}|${column[0]}`) ?? 0;
                        const share = count / (totals.get(column[0]) || 1) * 100;
                        return el('td', { class: 'matrix-cell number', style: { '--share': `${share.toFixed(1)}%` },
                            title: count ? `${share.toFixed(0)}%` : null, text: count ? String(count) : '' });
                    }
                })
            ]));
        }
    };

    const regionsOverTime = {
        key: 'regionsOverTime',
        title: strings.regionsOverTime,
        available: () => Boolean(store.getState().regions),
        render(body, { all, filters }) {
            // Without its own filter, like the rankings.
            const records = store.select('region');
            const columns = periods(all);
            const { regions } = store.getState();
            const totals = new Map();
            const counts = new Map();
            for (const record of records) {
                if (!record.year) continue;
                const start = Math.floor(record.year / PERIOD) * PERIOD;
                totals.set(start, (totals.get(start) ?? 0) + 1);
                for (const region of record.$regions ?? []) {
                    counts.set(`${region}|${start}`, (counts.get(`${region}|${start}`) ?? 0) + 1);
                }
            }
            const rows = regions.macros.map(macro => macro.id).filter(id => columns.some(c => counts.get(`${id}|${c[0]}`)));
            mount(body, el('div', {}, [
                el('p', { class: 'explore-hint', text: strings.regionsOverTimeHint }),
                shareTable({
                    caption: strings.regionsOverTime, rows, columns,
                    header: id => {
                        const macro = regions.macros.find(m => m.id === id);
                        const label = macro.label[locale] ?? macro.label.en;
                        return [el('span', { class: `legend-swatch series-${macro.slot ?? 'none'}`, 'aria-hidden': 'true' }),
                            filters.region.has(id) ? el('strong', { text: label }) : label];
                    },
                    cell: (id, column) => {
                        const count = counts.get(`${id}|${column[0]}`) ?? 0;
                        const share = count / (totals.get(column[0]) || 1) * 100;
                        return el('td', { class: 'matrix-cell number', style: { '--share': `${Math.min(share, 100).toFixed(1)}%` },
                            title: count ? `${share.toFixed(0)}%` : null, text: count ? String(count) : '' });
                    }
                })
            ]));
        }
    };

    const institutionPager = new Pager({ strings, pageSize: 15, onChange: () => institutions.redraw?.() });
    const institutions = {
        key: 'institutions',
        title: strings.institutions,
        available: () => true,
        reset: () => institutionPager.reset(),
        render(body, context) {
            institutions.redraw = () => institutions.render(body, context);
            withOpenAlex(body, data => {
                const { records } = context;
                const all = store.getState().publications;
                const selected = new Set(records.map(record => record.$index));
                const byInstitution = new Map();
                for (const [record, ids] of data.works) {
                    if (!selected.has(record)) continue;
                    for (const id of ids) {
                        if (!byInstitution.has(id)) byInstitution.set(id, []);
                        byInstitution.get(id).push(all[record]);
                    }
                }
                const ranked = [...byInstitution.entries()]
                    .map(([id, list]) => ({ institution: data.institutions[id], records: list }))
                    .sort((a, b) => b.records.length - a.records.length || a.institution.name.localeCompare(b.institution.name));
                const regions = new Intl.DisplayNames([locale], { type: 'region' });
                const country = code => { try { return regions.of(code); } catch { return code; } };
                const byCountry = new Map();
                for (const { institution, records: list } of ranked) {
                    if (!institution.country) continue;
                    if (!byCountry.has(institution.country)) byCountry.set(institution.country, new Set());
                    list.forEach(record => byCountry.get(institution.country).add(record.$index));
                }
                const countries = [...byCountry.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
                mount(body, el('div', {}, [
                    el('p', { class: 'explore-hint', text: fill(strings.institutionsHint, {
                        matched: records.filter(record => record.openalex).length, total: records.length
                    }) }),
                    !ranked.length && el('p', { text: strings.noResults }),
                    ...institutionPager.slice(ranked).map(({ institution, records: list }) => el('details', { class: 'family' }, [
                        el('summary', { text: `${institution.name}${institution.country ? ` (${country(institution.country)})` : ''} — ${list.length}` }),
                        sourceList(list)
                    ])),
                    institutionPager.control(ranked.length),
                    countries.length ? el('div', {}, [
                        el('h3', { class: 'theme-panel__subtitle', text: strings.countries }),
                        el('p', { class: 'inline-ranking', text: countries.map(([code, set]) => `${country(code)} ${set.size}`).join(' · ') })
                    ]) : null
                ]));
            });
        }
    };

    const literaturePager = new Pager({ strings, pageSize: 15, onChange: () => citations.redraw?.() });
    let network = null;
    const citations = {
        key: 'citations',
        title: strings.citations,
        available: () => true,
        reset: () => literaturePager.reset(),
        render(body, context) {
            citations.redraw = () => citations.render(body, context);
            withOpenAlex(body, data => {
                const { records } = context;
                const all = store.getState().publications;
                const selected = new Set(records.map(record => record.$index));
                const referenced = data.referenced.filter(index => selected.has(index)).length;
                const literature = data.references
                    .map(reference => ({ reference, by: reference.by.filter(index => selected.has(index)) }))
                    .filter(entry => entry.by.length)
                    .sort((a, b) => b.by.length - a.by.length || (a.reference.title ?? '').localeCompare(b.reference.title ?? ''));
                const edges = data.citations.filter(([a, b]) => selected.has(a) && selected.has(b));
                const graph = el('div', { class: 'citations-frame' });

                mount(body, el('div', {}, [
                    el('p', { class: 'caveat', role: 'note', text: fill(strings.citationsCaveat, {
                        matched: records.filter(record => record.openalex).length, total: records.length, refs: referenced
                    }) }),
                    el('h3', { class: 'theme-panel__subtitle', text: strings.internal }),
                    el('p', { class: 'explore-hint', text: strings.internalHint }),
                    el('p', { class: 'explore-hint', text: fill(strings.internalCount, { edges: edges.length, nodes: new Set(edges.flat()).size }) }),
                    graph,
                    edges.length ? el('details', { class: 'family' }, [
                        el('summary', { text: strings.citationList }),
                        el('ul', {}, edges.map(([a, b]) => el('li', {}, [
                            el('a', { href: all[a].url, target: '_blank', rel: 'noopener noreferrer', text: all[a].title || all[a].slug }),
                            ` ${strings.cites} `,
                            el('a', { href: all[b].url, target: '_blank', rel: 'noopener noreferrer', text: all[b].title || all[b].slug })
                        ])))
                    ]) : null,
                    el('h3', { class: 'theme-panel__subtitle', text: strings.literature }),
                    el('p', { class: 'explore-hint', text: strings.literatureHint }),
                    !literature.length && el('p', { text: strings.noResults }),
                    ...literaturePager.slice(literature).map(({ reference, by }) => el('details', { class: 'family' }, [
                        el('summary', { text: `${reference.title || reference.id}${reference.year ? ` (${reference.year})` : ''} — ${by.length}` }),
                        el('p', { class: 'list__meta' }, [
                            (reference.authors ?? []).join('; '),
                            ' · ',
                            el('a', {
                                href: reference.doi ? `https://doi.org/${reference.doi}` : `https://openalex.org/${reference.id}`,
                                target: '_blank', rel: 'noopener noreferrer',
                                text: reference.doi ? `DOI ${reference.doi}` : `OpenAlex ${reference.id}`
                            })
                        ]),
                        el('p', { class: 'explore-hint', text: `${strings.citedBy}:` }),
                        sourceList(by.map(index => all[index]))
                    ])),
                    literaturePager.control(literature.length)
                ]));

                network?.destroy();
                network = new CitationNetwork(graph, {
                    d3, strings, tooltip,
                    slotOf: id => themePanel?.slotOf?.get(id) ?? 8,
                    themeLabel: id => themePanel?.label?.(id) ?? id
                });
                network.render(all, edges);
            });
        },
        destroy: () => network?.destroy()
    };

    return [themesOverTime, regionsOverTime, languagesOverTime, institutions, citations];
}
