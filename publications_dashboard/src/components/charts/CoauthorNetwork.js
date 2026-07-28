/**
 * Who has published with whom, as a force-directed graph.
 *
 * This is the one view that genuinely needs d3: `d3.forceSimulation` does the
 * layout. The drawing is plain SVG built by hand, and the simulation is only
 * restarted when the graph's shape actually changes — a filter that merely
 * changes which authors are *selected* re-styles the existing nodes instead of
 * throwing the layout away and letting it re-settle under the reader.
 *
 * Every node is labelled rather than only the hovered one: a network whose
 * names appear one at a time cannot be read as a picture, only queried. The
 * cost is that the labels crowd, which is why the graph opens on the busiest
 * authors and grows a step at a time.
 */

import { svg, el, mount } from '../../utils/dom.js';
import { shortName } from '../../utils/format.js';

/** Iterations run before the first paint, so the graph never appears collapsed. */
const PRESETTLE_TICKS = 80;

/** Rough half-width reserved for a label, to keep neighbours from colliding. */
const LABEL_PADDING = 26;

export class CoauthorNetwork {
    #simulation = null;
    #signature = null;
    #limit;
    #nodes = new Map();
    #labels = new Map();
    // Kept so "show more" can redraw without waiting for the next state change.
    #graph = { nodes: [], links: [] };
    #selected = new Set();

    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {object} deps.settings
     * @param {object} deps.strings
     * @param {object} deps.d3 The global d3 bundle, injected rather than reached for.
     * @param {import('../Tooltip.js').Tooltip} deps.tooltip
     * @param {(author: string) => void} deps.onSelect
     */
    constructor(container, { settings, strings, d3, tooltip, onSelect }) {
        this.container = container;
        this.settings = settings;
        this.strings = strings;
        this.d3 = d3;
        this.tooltip = tooltip;
        this.onSelect = onSelect;
        this.#limit = settings.network.maxNodes;
    }

    /**
     * @param {{nodes: object[], links: object[]}} graph Nodes ranked, busiest first.
     * @param {Set<string>} selected
     */
    render(graph, selected = new Set()) {
        this.#graph = graph;
        this.#selected = selected;

        if (!graph.nodes.length) {
            this.#stop();
            mount(this.container, el('p', { class: 'empty', text: this.strings.noCoauthors }));
            return;
        }

        // Keep the most-published authors and the edges that survive between
        // them; an edge to an author who was cut would dangle.
        const nodes = graph.nodes.slice(0, this.#limit);
        const shown = new Set(nodes.map(node => node.id));
        const links = graph.links.filter(link => shown.has(link.source) && shown.has(link.target));

        // The full node list, not just its length: two different filters can
        // easily yield the same number of authors, and treating those as the
        // same graph would leave the previous one on screen.
        const signature = [
            nodes.map(node => node.id).join('|'),
            links.length,
            links.reduce((sum, link) => sum + link.weight, 0)
        ].join('::');

        if (signature !== this.#signature) {
            this.#build({ nodes, links }, graph.nodes.length);
            this.#signature = signature;
        }

        this.#applySelection(selected);
    }

    #build(graph, totalAuthors) {
        this.#stop();

        const { d3 } = this;
        const width = this.container.clientWidth || 640;
        const height = this.settings.charts.networkHeight;
        const { radius, charge, linkDistance } = this.settings.network;

        const maxCount = Math.max(...graph.nodes.map(node => node.count), 1);
        const scale = count =>
            radius.min + (radius.max - radius.min) * Math.sqrt(count / maxCount);

        const linkLayer = svg('g', { class: 'network__links' });
        const nodeLayer = svg('g', { class: 'network__nodes' });
        const labelLayer = svg('g', { class: 'network__labels' });
        const canvas = svg('svg', {
            class: 'network',
            viewBox: `0 0 ${width} ${height}`,
            preserveAspectRatio: 'xMidYMid meet',
            role: 'img',
            'aria-label': this.strings.coauthorship
        }, [linkLayer, nodeLayer, labelLayer]);

        const lines = graph.links.map(link => svg('line', {
            class: 'network__link',
            'stroke-width': Math.min(1 + link.weight, 6)
        }));
        linkLayer.append(...lines);

        this.#nodes.clear();
        this.#labels.clear();

        const circles = [];
        const labels = [];

        for (const node of graph.nodes) {
            const circle = svg('circle', {
                class: 'network__node',
                r: scale(node.count),
                tabindex: '0',
                role: 'button',
                'aria-label': `${node.id}: ${node.count}`,
                on: {
                    click: () => this.onSelect(node.id),
                    keydown: event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            this.onSelect(node.id);
                        }
                    },
                    pointerenter: event => this.tooltip.show(
                        [node.id, `${node.count} ${this.strings.publications}`], event
                    ),
                    pointermove: event => this.tooltip.move(event),
                    pointerleave: () => this.tooltip.hide()
                }
            });

            // "Holst, Birgitte" would be twice as wide as the graph can spare,
            // so the label is initialled and the full name stays in the
            // tooltip and the accessible name.
            const label = svg('text', {
                class: 'network__label',
                'text-anchor': 'middle',
                text: shortName(node.id)
            });

            circles.push(circle);
            labels.push(label);
            this.#nodes.set(node.id, circle);
            this.#labels.set(node.id, label);
        }

        nodeLayer.append(...circles);
        labelLayer.append(...labels);

        mount(this.container, el('div', {}, [canvas, this.#footer(graph.nodes.length, totalAuthors)]));

        const draw = () => {
            graph.links.forEach((link, index) => {
                const line = lines[index];
                line.setAttribute('x1', link.source.x);
                line.setAttribute('y1', link.source.y);
                line.setAttribute('x2', link.target.x);
                line.setAttribute('y2', link.target.y);
            });
            graph.nodes.forEach((node, index) => {
                circles[index].setAttribute('cx', node.x);
                circles[index].setAttribute('cy', node.y);
                labels[index].setAttribute('x', node.x);
                labels[index].setAttribute('y', node.y + scale(node.count) + 11);
            });
        };

        this.#simulation = d3.forceSimulation(graph.nodes)
            .force('link', d3.forceLink(graph.links).id(node => node.id)
                // Frequent collaborators sit closer together.
                .distance(link => linkDistance / Math.sqrt(link.weight)))
            .force('charge', d3.forceManyBody().strength(charge))
            .force('center', d3.forceCenter(width / 2, height / 2))
            // The collision radius covers the label, not just the circle, which
            // is what keeps neighbouring names from landing on top of one
            // another.
            .force('collide', d3.forceCollide(node => scale(node.count) + LABEL_PADDING))
            .on('tick', draw);

        // Settle the layout synchronously, then hand over to the animated
        // simulation. d3's timer runs on requestAnimationFrame, which a browser
        // does not fire for a tab that is not visible — so without this the
        // graph would sit stacked at the origin until the reader focused the
        // tab. `tick(n)` advances the simulation without dispatching events,
        // hence the explicit draw.
        this.#simulation.tick(PRESETTLE_TICKS);
        draw();

        // The circles were built by hand, so they carry no datum. Binding the
        // nodes here — by index, which matches the order they were appended in
        // — is what makes `event.subject` the dragged author rather than
        // undefined.
        d3.select(canvas).selectAll('circle').data(graph.nodes).call(
            d3.drag()
                .on('start', event => {
                    if (!event.active) {
                        this.#simulation.alphaTarget(0.2).restart();
                    }
                    event.subject.fx = event.subject.x;
                    event.subject.fy = event.subject.y;
                })
                .on('drag', event => {
                    event.subject.fx = event.x;
                    event.subject.fy = event.y;
                })
                .on('end', event => {
                    if (!event.active) {
                        this.#simulation.alphaTarget(0);
                    }
                    // Released rather than pinned: a dragged node stays where it
                    // was put only until the next nudge of the simulation.
                    event.subject.fx = null;
                    event.subject.fy = null;
                })
        );
    }

    /** "60 of 214 authors", and the button that asks for the next batch. */
    #footer(shown, total) {
        if (total <= shown) {
            return null;
        }

        return el('div', { class: 'network__footer' }, [
            el('span', {
                class: 'pager__range',
                text: `${shown} ${this.strings.ofTotal} ${total} ${this.strings.authors}`
            }),
            el('button', {
                class: 'link-button',
                type: 'button',
                text: this.strings.showMore,
                on: {
                    click: () => {
                        this.#limit += this.settings.network.nodeStep;
                        this.render(this.#graph, this.#selected);
                    }
                }
            })
        ]);
    }

    #applySelection(selected) {
        const dim = selected.size > 0;

        for (const [id, circle] of this.#nodes) {
            circle.classList.toggle('network__node--selected', selected.has(id));
            circle.classList.toggle('network__node--dimmed', dim && !selected.has(id));
            const label = this.#labels.get(id);
            label.classList.toggle('network__label--selected', selected.has(id));
            label.classList.toggle('network__label--dimmed', dim && !selected.has(id));
        }
    }

    #stop() {
        this.#simulation?.stop();
        this.#simulation = null;
        this.#nodes.clear();
        this.#labels.clear();
    }

    destroy() {
        this.#stop();
        this.#signature = null;
        this.container.replaceChildren();
    }
}
