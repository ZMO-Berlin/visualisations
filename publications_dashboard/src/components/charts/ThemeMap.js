/**
 * The thematic map: every publication as a point, placed by the similarity of
 * its title to every other title.
 *
 * Positions come from `themes.json` — a UMAP projection computed offline by
 * `build_themes.py` — and colour from the theme's area, of which there are at
 * most eight so the categorical palette can carry them. The picture is drawn
 * once, when the data arrives: a filter only changes which points are lit, so
 * nothing moves under the reader and two thousand circles are not rebuilt on
 * every click.
 *
 * Points are not focusable. The theme ranking beside the map holds the same
 * information — every theme, its size, its area — as real buttons, which is
 * the keyboard and screen-reader route; the map is described as an image.
 *
 * There are no labels on the map itself. Areas are not compact — a theme of
 * one area can sit inside another's region — so a label at an area's middle
 * landed on someone else's points. Instead, hovering or focusing a theme or
 * area beside the map lights exactly its points (`highlight`).
 */

import { svg, el, mount } from '../../utils/dom.js';
import { fill } from '../../utils/translations.js';

const WIDTH = 1000;
const PADDING = 24;

export class ThemeMap {
    #circles = [];
    #records = [];
    #themeOf = new Map();
    #canvas = null;
    #status = null;

    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {(id: string) => string} deps.themeLabel
     * @param {(id: string) => number} deps.areaSlot Palette slot of a theme's area.
     * @param {(id: string) => void} deps.onSelectTheme
     */
    constructor(container, { settings, strings, locale, tooltip, themeLabel, areaSlot, onSelectTheme }) {
        Object.assign(this, { container, settings, strings, locale, tooltip, themeLabel, areaSlot, onSelectTheme });
    }

    /** Builds the picture. Called once, with the whole register. */
    build(records, themes) {
        this.#records = records;
        const height = Math.round(WIDTH * this.settings.map.height / 760);
        const scaleX = value => PADDING + (value + 1) / 2 * (WIDTH - 2 * PADDING);
        const scaleY = value => PADDING + (1 - value) / 2 * (height - 2 * PADDING);
        const { x, y } = themes.points;

        // Drawn area by area, so a small area is not buried under a large one
        // that happens to come later in the file.
        const order = records
            .filter(record => x[record.$index] != null && record.theme)
            .sort((a, b) => this.areaSlot(b.theme) - this.areaSlot(a.theme) || a.$index - b.$index);

        this.#circles = order.map(record => {
            const circle = svg('circle', {
                class: `map__point fill-${this.areaSlot(record.theme)}`,
                cx: scaleX(x[record.$index]).toFixed(1),
                cy: scaleY(y[record.$index]).toFixed(1),
                r: this.settings.map.radius,
                'data-index': record.$index
            });
            this.#themeOf.set(circle, record.theme);
            return circle;
        });

        this.#canvas = svg('svg', {
            class: 'map',
            viewBox: `0 0 ${WIDTH} ${height}`,
            role: 'img',
            'aria-label': fill(this.strings.mapLabel, { n: order.length }),
            on: {
                pointerover: event => this.#hover(event),
                pointermove: event => this.tooltip.move(event),
                pointerout: event => { if (event.target.matches?.('.map__point')) this.tooltip.hide(); },
                click: event => {
                    const theme = this.#themeOf.get(event.target);
                    if (theme) this.onSelectTheme(theme);
                }
            }
        }, [svg('g', { class: 'map__points' }, this.#circles)]);

        this.#status = el('p', { class: 'map__status', 'aria-live': 'polite' });
        mount(this.container, el('div', { class: 'map-frame' }, [this.#canvas, this.#status]));
    }

    /** Lights the points that pass the current filters. */
    update(selected) {
        if (!this.#canvas) return;
        const lit = new Set(selected.map(record => record.$index));
        const all = lit.size === this.#records.length;
        let shown = 0;
        for (const circle of this.#circles) {
            const on = all || lit.has(Number(circle.dataset.index));
            circle.classList.toggle('map__point--out', !on);
            if (on) shown += 1;
        }
        this.#canvas.classList.toggle('map--filtered', !all);
        this.#status.textContent = all ? '' : fill(this.strings.mapSelected, { n: shown, total: this.#circles.length });
    }

    /** Lights only the given themes' points; `null` restores the picture. */
    highlight(themeIds) {
        if (!this.#canvas) return;
        const ids = themeIds ? new Set(themeIds) : null;
        this.#canvas.classList.toggle('map--highlighting', Boolean(ids));
        for (const circle of this.#circles) {
            circle.classList.toggle('map__point--hl', Boolean(ids?.has(this.#themeOf.get(circle))));
        }
    }

    #hover(event) {
        const circle = event.target;
        const theme = this.#themeOf.get(circle);
        if (!theme) return;
        const record = this.#records[Number(circle.dataset.index)];
        const title = [record.title, record.subtitle].filter(Boolean).join(': ') || record.slug;
        this.tooltip.show([
            title.length > 140 ? `${title.slice(0, 139)}…` : title,
            [record.year, this.themeLabel(theme)].filter(Boolean).join(' · '),
            this.strings.filterTheme
        ], event);
    }

    destroy() {
        this.tooltip.hide();
        this.container.replaceChildren();
    }
}
