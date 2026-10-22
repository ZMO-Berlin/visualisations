/**
 * Where the register's publications are about: one bubble per place, over
 * country outlines, sized by how many publications in the selection name it.
 *
 * The whole world is drawn, in the Natural Earth projection, but the map opens
 * on Africa, Europe and Asia — where nearly every place lies — so the Americas
 * and the Pacific do not take half the width. Drag the map to reach them, zoom
 * out, or press the globe to see every place at once. Continents and world
 * regions have no single location and are never drawn (`coord` is absent for
 * them in regions.json).
 *
 * Like the theme map, the bubbles are not focusable: the place ranking holds
 * the same counts as buttons, which is the keyboard route.
 *
 * Moving and zooming: the buttons; drag and Ctrl/⌘ + scroll with a mouse or
 * trackpad; two fingers on a touch screen. A plain scroll or a one-finger
 * swipe still moves the page, as everywhere else on it, and the map says how
 * to zoom instead of swallowing the gesture. On the full screen, where there
 * is no page to scroll, both work on the map directly. Bubbles, outlines and
 * names keep their size on screen as the map grows under them, and more names
 * find room the closer one looks.
 */

import { svg, el, mount } from '../../utils/dom.js';
import { wheelDelta } from '../../utils/zoom.js';

const MAX_ZOOM = 16;
const ZOOM_STEP = 1.6;

const WIDTH = 1000;
const HEIGHT = 560;
// The opening view: Africa, Europe and Asia.
const FRAME = { type: 'MultiPoint', coordinates: [[-24, -36], [150, -36], [150, 62], [-24, 62]] };
// How far the map moves north and south: no place lies in the Arctic Ocean or
// in Antarctica.
const NORTH = 84;
const SOUTH = -58;
const MAX_RADIUS = 26;
const MIN_RADIUS = 3;
const LABELS = 8;
// Rough width of a label character at the map's label size, for collisions.
const CHAR_WIDTH = 11;
// How long the "how to zoom" note stays after a gesture the map left alone.
const NUDGE_MS = 1800;
// A globe: outline, equator and one meridian, on a 24-unit grid.
const GLOBE = 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c-3 3-3 15 0 18M12 3c3 3 3 15 0 18';

export class WorldMap {
    #bubbles = new Map();
    #labels = new Map();
    #places = [];
    #canvas = null;
    #nudgeNote = null;
    #nudgeTimer = 0;

    constructor(container, { d3, topojson, strings, tooltip, label, slotOf, onSelectPlace }) {
        Object.assign(this, { container, d3, topojson, strings, tooltip, label, slotOf, onSelectPlace });
        this.transform = d3?.zoomIdentity;
    }

    /** Draws the outlines and one (hidden) bubble per mapped place. */
    build(world, places) {
        const { d3, topojson } = this;
        this.projection = d3.geoNaturalEarth1().fitExtent([[8, 8], [WIDTH - 8, HEIGHT - 8]], FRAME);
        const path = d3.geoPath(this.projection);
        const [[west], [east]] = path.bounds({ type: 'Sphere' });
        const north = this.projection([0, NORTH])[1];
        const south = this.projection([0, SOUTH])[1];
        const countries = topojson.feature(world, world.objects.countries).features;
        const outlines = svg('g', { class: 'world__countries' }, countries.map(feature => svg('path', { d: path(feature) || '' })));
        const sphere = svg('path', { class: 'world__sphere', d: path({ type: 'Sphere' }) });

        this.#places = places.filter(place => place.coord).map(place => {
            const [x, y] = this.projection(place.coord);
            return { ...place, x, y };
        });

        const bubbles = svg('g', { class: 'world__bubbles' });
        const labels = svg('g', { class: 'world__labels' });
        for (const place of this.#places) {
            const bubble = svg('circle', {
                class: `world__bubble fill-${this.slotOf(place.macro) ?? 'none'}`,
                cx: place.x.toFixed(1), cy: place.y.toFixed(1), r: 0, 'data-id': place.id
            });
            const text = svg('text', { class: 'world__label', x: place.x.toFixed(1), y: place.y.toFixed(1), text: this.label(place.id) });
            this.#bubbles.set(place.id, bubble);
            this.#labels.set(place.id, text);
            bubbles.append(bubble);
            labels.append(text);
        }

        const viewport = svg('g', {}, [sphere, outlines, bubbles, labels]);
        this.#canvas = svg('svg', {
            class: 'world', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': this.strings.regions,
            on: {
                pointerover: event => this.#hover(event),
                pointermove: event => this.tooltip.move(event),
                pointerout: event => { if (event.target.matches?.('.world__bubble')) this.tooltip.hide(); },
                click: event => { const id = event.target.dataset?.id; if (id) this.onSelectPlace(id); }
            }
        }, [viewport]);
        // Passive: a one-finger swipe scrolls the page, and the note must not delay it.
        this.#canvas.addEventListener('touchmove', event => {
            if (event.touches.length === 1 && !this.#onFullScreen()) this.#nudge(this.strings.mapTouchHint);
        }, { passive: true });

        // Zoomed out as far as the whole width of the world fits.
        const fit = Math.min(WIDTH / (east - west), HEIGHT / (south - north));
        this.whole = d3.zoomIdentity.translate((WIDTH - fit * (west + east)) / 2, (HEIGHT - fit * (north + south)) / 2).scale(fit);
        this.zoom = d3.zoom().scaleExtent([fit, MAX_ZOOM])
            .extent([[0, 0], [WIDTH, HEIGHT]]).translateExtent([[west, north], [east, south]])
            .wheelDelta(wheelDelta)
            .filter(event => this.#accepts(event))
            .on('zoom', event => {
                viewport.setAttribute('transform', event.transform);
                this.transform = event.transform;
                this.#canvas.style.setProperty('--k', event.transform.k);
                this.#paint();
            });
        const map = d3.select(this.#canvas).call(this.zoom);
        // Applied at once rather than animated: a transition waits on animation
        // frames, which a background tab or a reduced-motion setting withholds.
        const to = transform => map.call(this.zoom.transform, transform);
        const button = (content, label, action) => el('button', {
            type: 'button', class: 'network__zoom', 'aria-label': label, title: label, on: { click: action }
        }, [content]);
        const globe = svg('svg', { viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true', focusable: 'false' }, [
            svg('path', { d: GLOBE, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round' })
        ]);
        this.#nudgeNote = el('p', { class: 'world__nudge', 'aria-hidden': 'true' });
        mount(this.container, el('div', { class: 'map-frame' }, [
            this.#canvas,
            this.#nudgeNote,
            el('div', { class: 'world__controls' }, [
                button('+', this.strings.zoomIn, () => map.call(this.zoom.scaleBy, ZOOM_STEP)),
                button('−', this.strings.zoomOut, () => map.call(this.zoom.scaleBy, 1 / ZOOM_STEP)),
                button(globe, this.strings.wholeWorld, () => to(this.whole)),
                button('⟲', this.strings.resetView, () => to(d3.zoomIdentity))
            ])
        ]));
    }

    /**
     * Which gestures the map takes. d3's default refuses a Ctrl-click and takes
     * every wheel; here the wheel needs Ctrl/⌘ (a trackpad pinch sets it) and a
     * touch needs two fingers, except on the full screen.
     */
    #accepts(event) {
        if (event.type === 'wheel') {
            if (event.ctrlKey || event.metaKey || this.#onFullScreen()) return true;
            this.#nudge(this.strings.mapScrollHint);
            return false;
        }
        if (event.type === 'touchstart') return event.touches.length > 1 || this.#onFullScreen();
        return !event.button;
    }

    #onFullScreen() {
        return Boolean(document.fullscreenElement?.contains(this.#canvas));
    }

    #nudge(text) {
        this.#nudgeNote.textContent = text;
        this.#nudgeNote.classList.add('world__nudge--shown');
        clearTimeout(this.#nudgeTimer);
        this.#nudgeTimer = setTimeout(() => this.#nudgeNote.classList.remove('world__nudge--shown'), NUDGE_MS);
    }

    /**
     * @param {Map<string, number>} counts Publications per place in the selection.
     * @param {Set<string>} selected Places in the place filter.
     */
    update(counts, selected) {
        if (!this.#canvas) return;
        this.counts = counts;
        const peak = Math.max(1, ...this.#places.map(place => counts.get(place.id) ?? 0));
        this.radius = count => (count ? MIN_RADIUS + Math.sqrt(count / peak) * (MAX_RADIUS - MIN_RADIUS) : 0);

        // Largest drawn first, so a small place is never hidden under a large one.
        this.order = [...this.#places].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.id.localeCompare(b.id));
        const group = this.#bubbles.get(this.order[0]?.id)?.parentNode;
        for (const place of this.order) {
            const bubble = this.#bubbles.get(place.id);
            bubble.classList.toggle('world__bubble--selected', selected.has(place.id));
            group?.append(bubble);
        }
        this.#paint();
    }

    /**
     * Sizes in map units divided by the zoom, so they stay the same on screen;
     * then names for the largest bubbles in view that do not collide, more of
     * them the further in the reader has zoomed.
     */
    #paint() {
        if (!this.order) return;
        const { k } = this.transform;
        const [left, top] = this.transform.invert([0, 0]);
        const [right, bottom] = this.transform.invert([WIDTH, HEIGHT]);
        const placed = [];
        const limit = Math.max(4, Math.round(LABELS * k));
        for (const place of this.order) {
            const r = this.radius(this.counts.get(place.id) ?? 0) / k;
            this.#bubbles.get(place.id).setAttribute('r', r.toFixed(2));
            const text = this.#labels.get(place.id);
            const width = this.label(place.id).length * CHAR_WIDTH / k;
            const half = 12 / k;
            const box = [place.x + r + 4 / k, place.y - half, place.x + r + 4 / k + width, place.y + half];
            const show = r > 0 && placed.length < limit
                && box[0] >= left && box[2] <= right && box[1] >= top && box[3] <= bottom
                && placed.every(other => box[2] < other[0] || box[0] > other[2] || box[3] < other[1] || box[1] > other[3]);
            text.setAttribute('x', box[0].toFixed(2));
            text.setAttribute('y', (place.y + 6 / k).toFixed(2));
            text.classList.toggle('world__label--shown', show);
            if (show) placed.push(box);
        }
    }

    #hover(event) {
        const id = event.target.dataset?.id;
        if (!id) return;
        const count = this.counts?.get(id) ?? 0;
        this.tooltip.show([this.label(id), `${count} ${this.strings.publications}`, this.strings.filterPlace], event);
    }

    destroy() {
        clearTimeout(this.#nudgeTimer);
        this.tooltip.hide();
        this.container.replaceChildren();
    }
}
