import { validateVocabulary } from '../../../shared/data-contracts.js';
import { showFreshness } from '../../../shared/freshness.js';
import { el, mount } from '../../../shared/dom.js';
import { Pager } from '../../../shared/pager.js';
import { csv, download, copyView } from '../../../shared/download.js';
import { exploreStrings } from '../../../shared/explore-strings.js';

export class Explorer {
    constructor({ store, locale, onChange }) {
        Object.assign(this, { store, locale, onChange });
        this.s = exploreStrings(locale);
        this.view = 'cloud'; this.term = ''; this.query = ''; this.sort = 'frequent';
        this.pager = new Pager({ strings: this.s, pageSize: 25, onChange: () => this.draw() });
        this.nav = el('div', { class: 'explore-actions', role: 'group', 'aria-label': this.s.view });
        this.buttons = new Map(['cloud', 'list', 'compare', 'context'].map(view => {
            const button = el('button', { type: 'button', text: this.s[view], on: { click: () => this.setView(view) } });
            this.nav.append(button); return [view, button];
        }));
        this.nav.append(el('button', { type: 'button', text: this.s.copyLink, on: { click: e => copyView(e.currentTarget, this.s) } }));
        document.querySelector('.content-container').before(this.nav);
        this.section = el('section', { class: 'vocabulary-panel', hidden: true, tabindex: '-1', 'aria-label': this.s.context });
        this.controls = el('div', { class: 'explore-actions' });
        this.search = el('input', { type: 'search', 'aria-label': this.s.termSearch, placeholder: this.s.termSearch,
            on: { input: e => { this.query = e.target.value; this.pager.reset(); this.draw(); this.onChange(); } } });
        this.controls.append(this.search, el('label', {}, [this.s.sort, el('select', { on: { change: e => {
            this.sort = e.target.value; this.pager.reset(); this.draw(); this.onChange();
        } } }, ['frequent', 'distinctive'].map(key => el('option', { value: key, text: this.s[key] }))) ]),
        el('button', { type: 'button', text: this.s.csv, on: { click: () => this.export() } }));
        this.body = el('div');
        this.section.append(this.controls, this.body);
        document.querySelector('.content-container').after(this.section);
        const method = el('details', { class: 'methodology' }, [el('summary', { text: this.s.methodology }), el('p', { text: this.s.cloudMethod })]);
        this.section.after(method);
        showFreshness('word', method, locale, this.s.refresh);
        this.unsubscribe = store.subscribe((state, old) => {
            if (state.selectedUnit !== old.selectedUnit && this.view === 'context') { this.pager.reset(); this.draw(); }
        });
    }
    async load() {
        if (this.data) return;
        if (!this.loading) this.loading = fetch(new URL('../../data/vocabulary.json', import.meta.url))
            .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
            .then(data => { this.data = validateVocabulary(data); })
            .finally(() => { this.loading = null; });
        return this.loading;
    }
    setView(view, notify = true) {
        this.view = ['cloud', 'list', 'compare', 'context'].includes(view) ? view : 'cloud';
        document.body.dataset.view = this.view;
        for (const [key, button] of this.buttons) button.setAttribute('aria-pressed', String(key === this.view));
        this.section.hidden = !['compare', 'context'].includes(this.view);
        this.section.setAttribute('aria-label', this.s[this.view]);
        this.controls.hidden = this.view !== 'compare';
        this.pager.reset();
        if (!this.section.hidden) this.draw();
        if (notify) this.onChange();
    }
    selectTerm(term) { this.term = term; this.setView('context'); this.section.scrollIntoView({ block: 'start' }); this.section.focus({ preventScroll: true }); }
    rows() {
        const rows = this.data.terms.filter(row => row.term.includes(this.query.toLowerCase().trim()));
        const total = row => row.counts.reduce((a, b) => a + b, 0);
        const spread = row => { const rates = row.counts.map((n, i) => n / this.data.units[i].tokens); return Math.max(...rates) - Math.min(...rates); };
        return rows.filter(row => this.sort !== 'distinctive' || total(row) >= 5)
            .sort((a, b) => (this.sort === 'distinctive' ? spread(b) - spread(a) : total(b) - total(a)) || a.term.localeCompare(b.term));
    }
    async draw() {
        try { await this.load(); }
        catch {
            if (!this.destroyed) mount(this.body, el('div', { role: 'status' }, [this.s.loadError, el('button', { type: 'button', text: this.s.retry, on: { click: () => this.draw() } })]));
            return;
        }
        if (this.destroyed) return;
        if (this.view === 'context') {
            const unit = this.store.getState().selectedUnit;
            const rows = this.data.passages.filter(p => p.terms.includes(this.term) && (unit === 'combined' || unit === p.unit));
            mount(this.body, el('div', {}, [el('h2', { text: this.term || this.s.context }), el('p', { class: 'explore-hint', text: this.s.contextHint }),
                !rows.length && el('p', { text: this.term ? this.s.noResults : this.s.chooseTerm }),
                ...this.pager.slice(rows).map(p => el('article', { class: 'source-passage' }, [
                    el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: p.title }),
                    el('blockquote', { lang: 'en', text: p.text })
                ])), this.pager.control(rows.length)]));
        } else if (this.view === 'compare') {
            const rows = this.rows();
            const number = new Intl.NumberFormat(this.locale, { maximumFractionDigits: 1 });
            mount(this.body, el('div', {}, [el('h2', { text: this.s.compare }), el('p', { class: 'explore-hint', text: this.s.comparisonHint }),
                this.sort === 'distinctive' && el('p', { class: 'explore-hint', text: this.locale === 'de' ? 'Mindestens 5 Nennungen; sortiert nach größter minus kleinster normalisierter Häufigkeit.' : 'At least 5 occurrences; ranked by highest minus lowest normalized frequency.' }),
                el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': this.s.compare }, [el('table', { class: 'explore-table' }, [
                    el('caption', { text: `Dataset ${this.data.datasetId}` }),
                    el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: this.s.term }), ...this.data.units.map(u => el('th', { scope: 'col', text: u.label }))])]),
                    el('tbody', {}, this.pager.slice(rows).map(row => {
                        const rates = row.counts.map((n, i) => 1000 * n / this.data.units[i].tokens);
                        return el('tr', {}, [el('th', { scope: 'row' }, [el('button', { type: 'button', text: row.term, dataset: { key: row.term }, on: { click: () => this.selectTerm(row.term) } })]),
                            ...rates.map((rate, i) => el('td', { class: 'number matrix-cell', style: { '--share': `${rate / Math.max(...rates, 1) * 100}%` }, text: `${number.format(rate)} (${row.counts[i]})` }))]);
                    }))
                ])]), this.pager.control(rows.length),
                ...this.data.units.map(u => el('p', { class: 'explore-hint', text: `${u.label}: ${u.tokens} ${this.s.corpus} · ${u.projects} ${this.s.projects}` }))]));
        }
    }
    export() {
        if (!this.data) return;
        download(csv([[this.s.term, ...this.data.units.flatMap(u => [`${u.label} count`, `${u.label} /1000`]), 'dataset'],
            ...this.rows().map(row => [row.term, ...row.counts.flatMap((n, i) => [n, 1000 * n / this.data.units[i].tokens]), this.data.datasetId])]), 'zmo-vocabulary.csv');
    }
    destroy() { this.destroyed = true; this.unsubscribe(); }
}
