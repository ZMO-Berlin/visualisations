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
 * authors and grows a step at a time — and why the view pans and zooms.
 *
 * The force layout spreads nodes as far as it needs to, which is regularly
 * further than the fixed viewBox: an author pushed past the edge used to be
 * simply unreachable. A `d3.zoom` on the root SVG now moves a viewport group
 * holding all three layers, so the reader can drag the picture around and
 * magnify a crowded corner.
 */

import { svg, el, mount } from '../../utils/dom.js';
import { shortName } from '../../utils/format.js';

/** Iterations run before the first paint, so the graph never appears collapsed. */
const PRESETTLE_TICKS = 80;

/** Rough half-width reserved for a label, to keep neighbours from colliding. */
const LABEL_PADDING = 26;

/** How far out and in the view may be taken. */
const SCALE_EXTENT = [0.3, 6];

/** One press of the zoom buttons. */
const ZOOM_STEP = 1.4;

export class CoauthorNetwork {
    #simulation = null;
    #signature = null;
    #limit;
    #nodes = new Map();
    #labels = new Map();
    // Kept so "show more" can redraw without waiting for the next state change.
    #graph = { nodes: [], links: [] };
    #selected = new Set();
    #canvas = null;
    #zoom = null;

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
        // One group for the zoom to move. Transforming the three layers
        // separately would work, but this keeps the pan/zoom to a single
        // attribute write per frame and leaves the layers free to be reordered.
        const viewport = svg('g', { class: 'network__viewport' }, [linkLayer, nodeLayer, labelLayer]);
        const canvas = svg('svg', {
            class: 'network',
            viewBox: `0 0 ${width} ${height}`,
            preserveAspectRatio: 'xMidYMid meet',
            role: 'img',
            'aria-label': this.strings.coauthorship
        }, [viewport]);

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
        //
        // `d3.drag` stops the mousedown it claims from propagating, so a press
        // that reaches the zoom below is one that missed every node. That is
        // what lets "drag a node" and "drag the background" coexist without
        // either having to know about the other. The drag's own coordinates
        // stay in simulation space because it measures against the node's
        // parent, which is inside the transformed viewport.
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

        this.#canvas = canvas;
        this.#zoom = d3.zoom()
            .scaleExtent(SCALE_EXTENT)
            .filter(event => {
                // d3's default filter rejects anything with ctrlKey, which is
                // exactly the combination wanted here, so it has to be replaced
                // rather than extended.
                if (event.type === 'wheel') {
                    // A bare wheel keeps scrolling the page — a chart that ate
                    // the wheel would trap a reader on the way past it. Browsers
                    // report a trackpad pinch as a ctrl-wheel, so pinch-to-zoom
                    // comes along with the modifier.
                    return event.ctrlKey || event.metaKey;
                }
                return !event.button;
            })
            // d3 multiplies a ctrl-wheel by ten, on the assumption that ctrl
            // means a trackpad pinch and pinches arrive in tiny increments.
            // Here ctrl is *also* how a mouse asks to zoom, and one 100px notch
            // through that multiplier lands on the scale limit in a single
            // turn. So the boost is kept only for what a pinch actually sends:
            // pixel deltas, small ones. A line-mode wheel (Firefox reports ±3)
            // is small too, hence the deltaMode test.
            .wheelDelta(event => {
                const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
                const pinching = event.deltaMode === 0 && Math.abs(event.deltaY) < 50;
                return -event.deltaY * unit * (pinching ? 10 : 1);
            })
            .on('zoom', event => viewport.setAttribute('transform', event.transform))
            .on('start', () => canvas.classList.add('network--panning'))
            .on('end', () => canvas.classList.remove('network--panning'));

        d3.select(canvas)
            .call(this.#zoom)
            // Double-click already means "toggle this author twice" on a node;
            // having it also jump the zoom made the graph lurch under the
            // pointer.
            .on('dblclick.zoom', null);
    }

    /** Steps the zoom about the centre of the view. */
    #zoomBy(factor) {
        if (this.#canvas && this.#zoom) {
            this.d3.select(this.#canvas).call(this.#zoom.scaleBy, factor);
        }
    }

    #resetView() {
        if (this.#canvas && this.#zoom) {
            this.d3.select(this.#canvas).call(this.#zoom.transform, this.d3.zoomIdentity);
        }
    }

    /**
     * "60 of 214 authors" and the button for the next batch on the left; the
     * view controls on the right.
     *
     * The zoom buttons are not a convenience duplicating the wheel — they are
     * the only pointer-free way in, since the wheel needs a modifier and a
     * trackpad pinch is not something every reader has.
     */
    #footer(shown, total) {
        const progress = total > shown
            ? el('div', { class: 'network__progress' }, [
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
            ])
            : el('span', {});

        const step = (label, aria, onClick) => el('button', {
            class: 'network__zoom',
            type: 'button',
            'aria-label': aria,
            text: label,
            on: { click: onClick }
        });

        return el('div', { class: 'network__footer' }, [
            progress,
            el('div', { class: 'network__controls' }, [
                step('−', this.strings.zoomOut, () => this.#zoomBy(1 / ZOOM_STEP)),
                step('+', this.strings.zoomIn, () => this.#zoomBy(ZOOM_STEP)),
                el('button', {
                    class: 'link-button',
                    type: 'button',
                    text: this.strings.resetView,
                    on: { click: () => this.#resetView() }
                })
            ])
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
        // The SVG these refer to is about to be replaced; a stale zoom would
        // keep writing transforms into a detached node.
        this.#canvas = null;
        this.#zoom = null;
    }

    destroy() {
        this.#stop();
        this.#signature = null;
        this.container.replaceChildren();
    }
}
