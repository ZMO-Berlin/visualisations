/**
 * Citations between register publications, as OpenAlex records them.
 *
 * Unlike the co-authorship graph this one is small — a couple of hundred edges
 * at most — and directed, so it is laid out once, statically: the simulation
 * runs to rest before anything is drawn, and nothing drifts while the reader
 * looks. An arrow points from the citing publication to the cited one; colour
 * is the citing publication's theme area, size the number of times it is cited
 * within the selection.
 *
 * What is absent here is mostly absent from OpenAlex, not from the literature;
 * the caveat above the graph says so before the graph does anything else.
 */

import { svg, el, mount } from '../../utils/dom.js';

const WIDTH = 800;
const HEIGHT = 460;
const TICKS = 300;

export class CitationNetwork {
    constructor(container, { d3, strings, tooltip, slotOf, themeLabel }) {
        Object.assign(this, { container, d3, strings, tooltip, slotOf, themeLabel });
    }

    /**
     * @param {object[]} records The whole register, indexable by `$index`.
     * @param {[number, number][]} edges Citing → cited, both in the selection.
     */
    render(records, edges) {
        const d3 = this.d3;
        if (!d3 || !edges.length) {
            mount(this.container, el('p', { class: 'empty', text: this.strings.noCitations }));
            return;
        }

        const ids = [...new Set(edges.flat())].sort((a, b) => a - b);
        const cited = new Map();
        for (const [, target] of edges) cited.set(target, (cited.get(target) ?? 0) + 1);
        const nodes = ids.map(id => ({ id, record: records[id] }));
        const links = edges.map(([source, target]) => ({ source, target }));
        const radius = node => 4 + Math.sqrt(cited.get(node.id) ?? 0) * 2.2;

        d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(node => node.id).distance(36))
            .force('charge', d3.forceManyBody().strength(-45))
            .force('collide', d3.forceCollide(node => radius(node) + 2))
            .force('x', d3.forceX(WIDTH / 2).strength(0.06))
            .force('y', d3.forceY(HEIGHT / 2).strength(0.09))
            .stop()
            .tick(TICKS);

        const marker = svg('marker', {
            id: 'citation-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
            markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse'
        }, [svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'citations__arrowhead' })]);

        const lines = links.map(link => {
            // Stop the line at the cited node's edge so the arrowhead shows.
            const dx = link.target.x - link.source.x;
            const dy = link.target.y - link.source.y;
            const length = Math.hypot(dx, dy) || 1;
            const inset = radius(link.target) + 2;
            return svg('line', {
                class: 'citations__link',
                x1: link.source.x.toFixed(1), y1: link.source.y.toFixed(1),
                x2: (link.target.x - dx / length * inset).toFixed(1),
                y2: (link.target.y - dy / length * inset).toFixed(1),
                'marker-end': 'url(#citation-arrow)'
            });
        });

        const circles = nodes.map(node => {
            const { record } = node;
            const title = [record.title, record.subtitle].filter(Boolean).join(': ') || record.slug;
            const open = () => window.open(record.url, '_blank', 'noopener');
            return svg('circle', {
                class: `citations__node fill-${record.theme ? this.slotOf(record.theme) : 8}`,
                cx: node.x.toFixed(1), cy: node.y.toFixed(1), r: radius(node).toFixed(1),
                tabindex: '0', role: 'link',
                'aria-label': `${title} (${record.year ?? '—'})`,
                on: {
                    click: open,
                    keydown: event => { if (event.key === 'Enter') open(); },
                    pointerenter: event => this.tooltip.show([
                        title.length > 140 ? `${title.slice(0, 139)}…` : title,
                        [record.year, (record.authors ?? []).slice(0, 3).join('; ')].filter(Boolean).join(' · '),
                        record.theme ? this.themeLabel(record.theme) : null,
                        cited.get(node.id) ? `${this.strings.citedBy} ${cited.get(node.id)}` : null
                    ], event),
                    pointermove: event => this.tooltip.move(event),
                    pointerleave: () => this.tooltip.hide()
                }
            });
        });

        const viewport = svg('g', {}, [svg('g', {}, lines), svg('g', {}, circles)]);
        const canvas = svg('svg', { class: 'citations', viewBox: `0 0 ${WIDTH} ${HEIGHT}` },
            [svg('defs', {}, [marker]), viewport]);
        d3.select(canvas).call(d3.zoom().scaleExtent([0.4, 6])
            .filter(event => event.type !== 'wheel' || event.ctrlKey || event.metaKey)
            .on('zoom', event => viewport.setAttribute('transform', event.transform)));
        mount(this.container, canvas);
    }

    destroy() {
        this.tooltip.hide();
        this.container.replaceChildren();
    }
}
