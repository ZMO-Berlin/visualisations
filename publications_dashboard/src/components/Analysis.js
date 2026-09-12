import { validateFamilies } from '../../../shared/data-contracts.js';
import { el, mount } from '../utils/dom.js';
import { countValues, rank, yearExtent } from '../utils/aggregate.js';
import { Pager } from '../../../shared/pager.js';

/** Expanded views are rendered on demand; every pattern links to source records. */
export class Analysis {
    constructor(container, { store, strings, typeLabel }) {
        Object.assign(this, { container, store, s: strings, typeLabel });
        this.mode = 'count';
        this.sections = new Map();
        this.pairPager = new Pager({ strings, pageSize: 15, onChange: () => this.collaborators() });
        this.familyPager = new Pager({ strings, pageSize: 15, onChange: () => this.families() });
        for (const [key, title] of [['trends', strings.trends], ['authors', strings.authorsOverTime], ['collaborators', strings.collaborators], ['families', strings.families]]) {
            const body = el('div');
            const details = el('details', { class: 'analysis-section', on: { toggle: () => { if (details.open) this[key](); } } }, [el('summary', { text: title }), body]);
            this.sections.set(key, { details, body }); container.append(details);
        }
    }
    render(records, all, filters) {
        this.records = records; this.all = all; this.filters = filters;
        this.pairPager.reset(); this.familyPager.reset();
        for (const [key, { details }] of this.sections) if (details.open) this[key]();
    }
    sourceList(records) {
        return el('ul', {}, records.map(record => el('li', {}, [el('a', { href: record.url, target: '_blank', rel: 'noopener noreferrer', text: `${record.year ? `${record.year} · ` : ''}${record.title || record.slug}` })])));
    }
    trends() {
        if (!this.records) return;
        const extent = yearExtent(this.all);
        if (!extent) return;
        const years = Array.from({ length: extent[1] - extent[0] + 1 }, (_, i) => extent[0] + i);
        const types = rank(countValues(this.records, r => r.type ?? '')).map(row => row.key);
        if (this.records.some(r => !r.type)) types.push('');
        const totals = countValues(this.records, r => String(r.year ?? ''));
        const counts = new Map(types.map(type => [type, countValues(this.records.filter(r => (r.type ?? '') === type), r => String(r.year ?? ''))]));
        const peak = this.mode === 'percentage' ? 100 : Math.max(1, ...[...counts.values()].flatMap(map => years.map(year => map.get(String(year)) ?? 0)));
        const value = (type, year) => {
            const n = counts.get(type).get(String(year)) ?? 0;
            return this.mode === 'percentage' ? n / (totals.get(String(year)) || 1) * 100 : n;
        };
        mount(this.sections.get('trends').body, el('div', {}, [
            el('div', { class: 'explore-actions', role: 'group', 'aria-label': this.s.view }, ['count', 'percentage'].map(mode => el('button', { type: 'button', text: this.s[mode], 'aria-pressed': String(mode === this.mode), on: { click: () => { this.mode = mode; this.trends(); } } }))),
            el('p', { class: 'explore-hint', text: `${this.s.selected}: ${this.records.length} ${this.s.records}. ${this.mode === 'percentage' ? this.s.percentageHint : `${this.s.scaleMaximum}: ${peak}.`} ${this.s.datedOnly}` }),
            el('div', { class: 'trend-grid' }, types.map(type => el('div', {}, [el('h3', { text: this.typeLabel(type) }),
                el('div', { class: 'mini-chart', 'aria-hidden': 'true' }, years.map(year => el('span', { style: { height: `${value(type, year) / peak * 100}%` } }))),
                el('div', { class: 'mini-axis' }, [
                    el('span', { text: extent[0] }), el('span', { text: extent[1] })
                ])]))),
            el('details', {}, [el('summary', { text: this.s.list }), this.table([this.s.year, ...types.map(this.typeLabel)], years.map(year => [String(year), ...types.map(type => value(type, year).toFixed(this.mode === 'percentage' ? 1 : 0) + (this.mode === 'percentage' ? '%' : ''))]))])
        ]));
    }
    table(headings, rows, className = '') {
        return el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': headings[0] }, [el('table', { class: `explore-table ${className}` }, [
            el('thead', {}, [el('tr', {}, headings.map(h => el('th', { scope: 'col', text: h })))]),
            el('tbody', {}, rows.map(row => el('tr', {}, row.map((value, index) => el(index ? 'td' : 'th', index ? {} : { scope: 'row' }, [value])))))
        ])]);
    }
    authors() {
        if (!this.records) return;
        const records = this.store.select('author');
        const names = this.filters.author.size ? [...this.filters.author] : rank(countValues(records, r => r.authors), 6).map(r => r.key);
        const extent = yearExtent(this.all);
        if (!extent) return;
        const years = Array.from({ length: extent[1] - extent[0] + 1 }, (_, i) => extent[0] + i);
        const rows = names.map(name => {
            const counts = countValues(records.filter(r => r.authors?.includes(name)), r => String(r.year ?? ''));
            return [name, ...years.map(year => {
                const count = counts.get(String(year)) ?? 0;
                return count ? el('button', { type: 'button', text: count, 'aria-label': `${name}, ${year}: ${count}`, on: { click: () => {
                    this.store.focusPublications([name], [year, year]);
                    const results = document.getElementById('publication-results');
                    results.tabIndex = -1; results.scrollIntoView(); results.focus({ preventScroll: true });
                } } }) : '—';
            })];
        });
        mount(this.sections.get('authors').body, el('div', {}, [el('p', { class: 'explore-hint', text: this.s.authorHint }), this.table([this.s.authorsOverTime, ...years.map(String)], rows, 'timeline-matrix')]));
    }
    collaborators() {
        if (!this.records) return;
        const names = this.filters.author;
        const pairs = new Map();
        for (const record of this.store.select('author')) {
            const authors = [...new Set(record.authors ?? [])].sort();
            for (let i = 0; i < authors.length; i++) for (let j = i + 1; j < authors.length; j++) {
                if (names.size && !names.has(authors[i]) && !names.has(authors[j])) continue;
                const key = JSON.stringify([authors[i], authors[j]]);
                if (!pairs.has(key)) pairs.set(key, { names: [authors[i], authors[j]], records: [] });
                pairs.get(key).records.push(record);
            }
        }
        const rows = [...pairs.values()].sort((a, b) => b.records.length - a.records.length || a.names.join().localeCompare(b.names.join()));
        mount(this.sections.get('collaborators').body, el('div', {}, [el('p', { class: 'explore-hint', text: this.s.collaboratorHint }),
            !rows.length && el('p', { text: this.s.noResults }),
            ...this.pairPager.slice(rows).map(row => el('details', { class: 'family' }, [el('summary', { text: `${row.names.join(' · ')} — ${row.records.length}` }), this.sourceList(row.records)])),
            this.pairPager.control(rows.length)]));
    }
    async families() {
        if (!this.records) return;
        const body = this.sections.get('families').body;
        try {
            if (!this.familyData) {
                this.familyPromise ??= fetch(new URL('../../data/families.json', import.meta.url)).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
                this.familyData = validateFamilies(await this.familyPromise);
            }
            if (this.destroyed) return;
            const selected = new Set(this.records.map(r => r.slug));
            const rows = this.familyData.filter(f => selected.has(f.parent.slug) || f.children.some(c => selected.has(c.slug)));
            mount(body, el('div', {}, [el('p', { class: 'explore-hint', text: this.s.familyHint }),
                ...this.familyPager.slice(rows).map(f => el('details', { class: 'family' }, [
                    el('summary', { text: `${f.parent.title} (${f.children.length})` }),
                    el('a', { href: f.parent.url, target: '_blank', rel: 'noopener noreferrer', text: f.parent.registered ? f.parent.title : `${this.s.external}: ${f.parent.title}` }), this.sourceList(f.children)
                ])), !rows.length && el('p', { text: this.s.noResults }), this.familyPager.control(rows.length)]));
        } catch {
            this.familyPromise = null;
            if (!this.destroyed) mount(body, el('div', {}, [this.s.loadError, el('button', { type: 'button', text: this.s.retry, on: { click: () => this.families() } })]));
        }
    }
    destroy() { this.destroyed = true; this.container.replaceChildren(); }
}
