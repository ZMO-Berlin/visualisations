/**
 * Where the register's publications are about: one bubble per place, over
 * country outlines, sized by how many publications in the selection name it.
 *
 * The projection is Natural Earth, fitted to Africa, Europe and Asia — where
 * nearly every place in the gazetteer lies — so the Americas and the Pacific do
 * not take half the width; the few places outside the frame are still in the
 * ranking beside the map. Continents, seas and "worlds" have no single
 * location and are never drawn (`coord` is absent for them in regions.json).
 *
 * Like the theme map, the bubbles are not focusable: the place ranking holds
 * the same counts as buttons, which is the keyboard route.
 */

import { svg, el, mount } from '../../utils/dom.js';

const WIDTH = 1000;
const HEIGHT = 560;
const FRAME = { type: 'MultiPoint', coordinates: [[-24, -36], [150, -36], [150, 62], [-24, 62]] };
const MAX_RADIUS = 26;
const MIN_RADIUS = 3;
const LABELS = 8;
// Rough width of a label character at the map's label size, for collisions.
const CHAR_WIDTH = 11;

export class WorldMap {
    #bubbles = new Map();
    #labels = new Map();
    #places = [];
    #canvas = null;

    constructor(container, { d3, topojson, strings, tooltip, label, slotOf, onSelectPlace }) {
        Object.assign(this, { container, d3, topojson, strings, tooltip, label, slotOf, onSelectPlace });
    }

    /** Draws the outlines and one (hidden) bubble per mapped place. */
    build(world, places) {
        const { d3, topojson } = this;
        this.projection = d3.geoNaturalEarth1().fitExtent([[8, 8], [WIDTH - 8, HEIGHT - 8]], FRAME);
        const path = d3.geoPath(this.projection);
        const countries = topojson.feature(world, world.objects.countries).features;
        const outlines = svg('g', { class: 'world__countries' }, countries.map(feature => svg('path', { d: path(feature) || '' })));

        this.#places = places.filter(place => place.coord).map(place => {
            const [x, y] = this.projection(place.coord);
            return { ...place, x, y, inside: x >= 0 && x <= WIDTH && y >= 0 && y <= HEIGHT };
        }).filter(place => place.inside);

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

        this.#canvas = svg('svg', {
            class: 'world', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': this.strings.regions,
            on: {
                pointerover: event => this.#hover(event),
                pointermove: event => this.tooltip.move(event),
                pointerout: event => { if (event.target.matches?.('.world__bubble')) this.tooltip.hide(); },
                click: event => { const id = event.target.dataset?.id; if (id) this.onSelectPlace(id); }
            }
        }, [outlines, bubbles, labels]);
        mount(this.container, el('div', { class: 'map-frame' }, [this.#canvas]));
    }

    /**
     * @param {Map<string, number>} counts Publications per place in the selection.
     * @param {Set<string>} selected Places in the place filter.
     */
    update(counts, selected) {
        if (!this.#canvas) return;
        this.counts = counts;
        const peak = Math.max(1, ...this.#places.map(place => counts.get(place.id) ?? 0));
        const radius = count => (count ? MIN_RADIUS + Math.sqrt(count / peak) * (MAX_RADIUS - MIN_RADIUS) : 0);

        // Largest drawn first, so a small place is never hidden under a large one.
        const order = [...this.#places].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.id.localeCompare(b.id));
        const group = this.#bubbles.get(order[0]?.id)?.parentNode;
        for (const place of order) {
            const bubble = this.#bubbles.get(place.id);
            bubble.setAttribute('r', radius(counts.get(place.id) ?? 0).toFixed(1));
            bubble.classList.toggle('world__bubble--selected', selected.has(place.id));
            group?.append(bubble);
        }

        // Names for the largest bubbles that do not collide with one already placed.
        const placed = [];
        for (const place of order) {
            const text = this.#labels.get(place.id);
            const r = radius(counts.get(place.id) ?? 0);
            const width = this.label(place.id).length * CHAR_WIDTH;
            const box = [place.x + r + 4, place.y - 12, place.x + r + 4 + width, place.y + 12];
            const show = r > 0 && placed.length < LABELS && box[2] < WIDTH
                && placed.every(other => box[2] < other[0] || box[0] > other[2] || box[3] < other[1] || box[1] > other[3]);
            text.setAttribute('x', box[0].toFixed(1));
            text.setAttribute('y', (place.y + 6).toFixed(1));
            text.classList.toggle('world__label--shown', show);
            if (show) placed.push(box);
        }
    }

    #hover(event) {
        const id = event.target.dataset?.id;
        if (!id) return;
        const count = this.counts?.get(id) ?? 0;
        this.tooltip.show([this.label(id), `${count} ${this.strings.publications}`, this.strings.regionsHint], event);
    }

    destroy() {
        this.tooltip.hide();
        this.container.replaceChildren();
    }
}
