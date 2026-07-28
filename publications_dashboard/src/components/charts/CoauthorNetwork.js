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
 *
 * Filtering by an author moves the view onto them: the graph glides until that
 * author and their co-authors fill it, and their edges are the only ones left
 * at full strength. Two things follow from that. The author has to be drawn
 * wherever they rank, since a view centred on a node that the top-N cut is a
 * view centred on nothing. And an author who has never co-published is not in
 * this graph at all — `coauthorGraph` keeps only the connected — so filtering
 * by one says so in a sentence, rather than leaving a reader to hunt a dimmed
 * picture for a node that was never drawn.
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

/**
 * How close focusing may zoom, and the space left around what it frames.
 *
 * A pair of authors alone in the picture would otherwise be magnified until the
 * two circles were the size of coins, which tells a reader less than the same
 * pair seen with their surroundings.
 */
const FOCUS_MAX_SCALE = 2.2;
const FOCUS_PADDING = 56;

/** Length of the glide onto a focused author, and of the nudge after settling. */
const FOCUS_DURATION = 600;
const SETTLE_DURATION = 300;

/**
 * A link end as an id.
 *
 * d3's force layout rewrites every link's `source` and `target` from an id to
 * the node object itself, in place. The same graph can be handed to `render`
 * again — "show more" does exactly that — so an end is only reliably a string
 * the first time round, and is read back through this rather than assumed.
 */
function endId(end) {
    return typeof end === 'object' ? end.id : end;
}

/** Who each author has published with. */
function neighbourMap(links) {
    const neighbours = new Map();

    for (const link of links) {
        const source = endId(link.source);
        const target = endId(link.target);

        if (!neighbours.has(source)) {
            neighbours.set(source, new Set());
        }
        if (!neighbours.has(target)) {
            neighbours.set(target, new Set());
        }
        neighbours.get(source).add(target);
        neighbours.get(target).add(source);
    }

    return neighbours;
}

/**
 * The stylesheet already honours this preference, but the glide onto a focused
 * author is a d3 transition — JavaScript, which no CSS rule reaches.
 */
function reducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export class CoauthorNetwork {
    #simulation = null;
    #signature = null;
    #limit;
    #nodes = new Map();
    #labels = new Map();
    // The drawn links, and the line drawn for each, in the same order.
    #edges = [];
    #lines = [];
    // Node data, positions included, and the co-authors of every author in the
    // graph — what the view needs to know to frame one of them.
    #data = new Map();
    #neighbours = new Map();
    // Kept so "show more" can redraw without waiting for the next state change.
    #graph = { nodes: [], links: [] };
    #selected = new Set();
    #note = null;
    #canvas = null;
    #zoom = null;
    #size = { width: 0, height: 0 };
    // The selection the view was last moved for, and whether the reader has
    // taken hold of it since.
    #focused = [];
    #userMoved = false;

    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {object} deps.settings
     * @param {object} deps.strings
     * @param {string} deps.locale
     * @param {object} deps.d3 The global d3 bundle, injected rather than reached for.
     * @param {import('../Tooltip.js').Tooltip} deps.tooltip
     * @param {(author: string) => void} deps.onSelect
     */
    constructor(container, { settings, strings, locale, d3, tooltip, onSelect }) {
        this.container = container;
        this.settings = settings;
        this.strings = strings;
        this.locale = locale;
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

        const byId = new Map(graph.nodes.map(node => [node.id, node]));
        // Over the whole graph, not just the part drawn: it decides which nodes
        // have to be added to the drawing before there is a drawing.
        const neighbours = neighbourMap(graph.links);

        // A filtered author can be missing from this graph entirely, since only
        // those with a co-author are in it. Saying so is the answer to the
        // question the panel is being asked; the rest of the register with
        // nothing highlighted is not an answer at all.
        const solo = [...selected].filter(id => !byId.has(id));
        const focused = [...selected].filter(id => byId.has(id));

        if (selected.size && !focused.length) {
            this.#stop();
            mount(this.container, el('p', { class: 'empty', text: this.#soloMessage(solo) }));
            return;
        }

        // The busiest authors, plus whoever is filtered on and everyone they
        // have published with — an ego network is its edges, not its dot.
        const nodes = graph.nodes.slice(0, this.#limit);
        const shown = new Set(nodes.map(node => node.id));

        for (const id of focused) {
            for (const member of [id, ...(neighbours.get(id) ?? [])]) {
                if (!shown.has(member)) {
                    shown.add(member);
                    nodes.push(byId.get(member));
                }
            }
        }

        // The edges that survive between them; one to an author who was cut
        // would dangle. Copied rather than passed through, because the layout
        // writes node objects over the ids in whatever it is given.
        const links = graph.links
            .filter(link => shown.has(endId(link.source)) && shown.has(endId(link.target)))
            .map(link => ({
                source: endId(link.source), target: endId(link.target), weight: link.weight
            }));

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

        this.#neighbours = neighbours;
        this.#applySelection(selected, solo);
        this.#focus(focused);
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
        this.#data = new Map(graph.nodes.map(node => [node.id, node]));
        this.#edges = graph.links;
        this.#lines = lines;
        this.#size = { width, height };

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

        // Written by `#applySelection`, which is where it is known whether any
        // of the filtered authors are absent from the picture below it.
        this.#note = el('p', { class: 'network__note', hidden: true });

        mount(this.container, el('div', {}, [
            this.#note, canvas, this.#footer(graph.nodes.length, totalAuthors)
        ]));

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
            .on('tick', draw)
            // A layout is still drifting for a second or two after it is built,
            // so a view fitted to where the nodes were lands a little off where
            // they stop. Fit it again once they have — unless the reader has
            // taken hold of the view in the meantime, in which case the fit is
            // no longer the framing anyone asked for.
            .on('end', () => {
                if (this.#focused.length && !this.#userMoved) {
                    this.#frame(this.#focused, SETTLE_DURATION);
                }
            });

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
                    // Rearranging the graph by hand counts as holding the view:
                    // the refit above must not snatch it back when the nudged
                    // layout settles again.
                    this.#userMoved = true;
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
            .on('zoom', event => {
                // `sourceEvent` is null for the transitions this component runs
                // itself, which is what separates "the reader moved the view"
                // from "the view was moved for them".
                if (event.sourceEvent) {
                    this.#userMoved = true;
                }
                viewport.setAttribute('transform', event.transform);
            })
            .on('start', () => canvas.classList.add('network--panning'))
            .on('end', () => canvas.classList.remove('network--panning'));

        d3.select(canvas)
            .call(this.#zoom)
            // Double-click already means "toggle this author twice" on a node;
            // having it also jump the zoom made the graph lurch under the
            // pointer.
            .on('dblclick.zoom', null);

        // A fresh canvas starts at identity, and nothing has been framed in it.
        this.#focused = [];
        this.#userMoved = false;
    }

    /** Steps the zoom about the centre of the view. */
    #zoomBy(factor) {
        if (this.#canvas && this.#zoom) {
            this.#userMoved = true;
            this.d3.select(this.#canvas).call(this.#zoom.scaleBy, factor);
        }
    }

    #resetView(duration = 0) {
        this.#move(this.d3.zoomIdentity, duration);
    }

    /**
     * Moves the view onto the authors being filtered on, once per change of
     * selection.
     *
     * Once, because the store publishes a new state for every filter the reader
     * touches and most of them leave this graph alone: refitting on each would
     * undo a pan the reader had just made for reasons of their own. Clearing the
     * author filter is a change like any other, and takes the view back out.
     */
    #focus(focused) {
        if (focused.join('|') === this.#focused.join('|')) {
            return;
        }

        this.#focused = focused;
        this.#userMoved = false;

        if (focused.length) {
            this.#frame(focused, FOCUS_DURATION);
        } else {
            this.#resetView(FOCUS_DURATION);
        }
    }

    /** Fits the view to the given authors, their co-authors and the edges between. */
    #frame(ids, duration) {
        const ego = new Set(ids);
        for (const id of ids) {
            for (const neighbour of this.#neighbours.get(id) ?? []) {
                ego.add(neighbour);
            }
        }

        const points = [...ego].map(id => this.#data.get(id)).filter(Boolean);
        if (!points.length) {
            return;
        }

        const xs = points.map(point => point.x);
        const ys = points.map(point => point.y);
        const box = {
            left: Math.min(...xs) - FOCUS_PADDING,
            right: Math.max(...xs) + FOCUS_PADDING,
            top: Math.min(...ys) - FOCUS_PADDING,
            bottom: Math.max(...ys) + FOCUS_PADDING
        };

        const { width, height } = this.#size;
        const scale = Math.min(
            FOCUS_MAX_SCALE,
            Math.max(
                SCALE_EXTENT[0],
                Math.min(width / (box.right - box.left), height / (box.bottom - box.top))
            )
        );

        this.#move(
            this.d3.zoomIdentity
                .translate(width / 2, height / 2)
                .scale(scale)
                .translate(-(box.left + box.right) / 2, -(box.top + box.bottom) / 2),
            duration
        );
    }

    /** Applies a transform through the zoom, so its own state stays in step. */
    #move(transform, duration) {
        if (!this.#canvas || !this.#zoom) {
            return;
        }

        const view = this.d3.select(this.#canvas);
        const target = duration && !reducedMotion() ? view.transition().duration(duration) : view;
        target.call(this.#zoom.transform, transform);
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
                    on: {
                        click: () => {
                            this.#userMoved = true;
                            this.#resetView(FOCUS_DURATION);
                        }
                    }
                })
            ])
        ]);
    }

    /**
     * Three states, not two: the authors filtered on, the ones they have
     * published with, and the rest.
     *
     * The co-authors are the reason for looking, so they keep their full
     * strength while everyone else fades. The same goes for the edges — a
     * collaboration between two authors who merely happen to be neighbours of
     * the selection is not part of the answer, and dims with them.
     *
     * @param {Set<string>} selected
     * @param {string[]} solo Filtered authors this graph has no place for.
     */
    #applySelection(selected, solo = []) {
        const dim = selected.size > 0;
        const near = new Set();

        for (const id of selected) {
            for (const neighbour of this.#neighbours.get(id) ?? []) {
                near.add(neighbour);
            }
        }

        for (const [id, circle] of this.#nodes) {
            const chosen = selected.has(id);
            const faded = dim && !chosen && !near.has(id);
            circle.classList.toggle('network__node--selected', chosen);
            circle.classList.toggle('network__node--dimmed', faded);
            const label = this.#labels.get(id);
            label.classList.toggle('network__label--selected', chosen);
            label.classList.toggle('network__label--dimmed', faded);
        }

        this.#edges.forEach((edge, index) => {
            const own = selected.has(endId(edge.source)) || selected.has(endId(edge.target));
            this.#lines[index].classList.toggle('network__link--active', dim && own);
            this.#lines[index].classList.toggle('network__link--dimmed', dim && !own);
        });

        if (this.#note) {
            this.#note.textContent = solo.length ? this.#soloMessage(solo) : '';
            this.#note.hidden = !solo.length;
        }
    }

    /**
     * "Freitag, Ulrike has no co-authored publication in the current selection."
     *
     * A list format rather than a join: these names are written surname-first,
     * so two of them separated by a comma would read as four people.
     */
    #soloMessage(names) {
        const list = new Intl.ListFormat(this.locale, { style: 'long', type: 'conjunction' })
            .format(names);
        const template = names.length === 1
            ? this.strings.noCollaboration
            : this.strings.noCollaborationMany;
        return template.replace('{names}', list);
    }

    #stop() {
        this.#simulation?.stop();
        this.#simulation = null;
        this.#nodes.clear();
        this.#labels.clear();
        this.#data.clear();
        this.#edges = [];
        this.#lines = [];
        this.#note = null;
        // The SVG these refer to is about to be replaced; a stale zoom would
        // keep writing transforms into a detached node.
        this.#canvas = null;
        this.#zoom = null;
        // Whatever replaces it is not the graph this signature described, and
        // an empty state that kept it would refuse to rebuild the graph it was
        // standing in for.
        this.#signature = null;
        this.#focused = [];
    }

    destroy() {
        this.#stop();
        this.container.replaceChildren();
    }
}
