/**
 * Owns everything about how a word *looks* and how it reacts to the pointer:
 * font sizing, colour assignment, and the hover transition.
 *
 * This replaces the former FontManager / ColorManager / WordStyleManager /
 * AnimationManager quartet, which split one concern across four files, bound
 * competing `mouseover` handlers to the same elements, and re-read the CSS
 * colour scheme once per word on every render.
 */
export class WordStyler {
    /**
     * @param {object} deps
     * @param {import('../config/ConfigManager.js').ConfigManager} deps.config
     */
    constructor({ config }) {
        this.config = config;
        this.schemeCache = null;
    }

    // ---------------------------------------------------------------- colours

    /**
     * Reads `--wordcloud-scheme-N` from the document root.
     *
     * Cached: `getComputedStyle` forces a style resolution, and the previous
     * implementation called it once per swatch per word (~1000 reads per render).
     */
    getScheme() {
        if (this.schemeCache) {
            return this.schemeCache;
        }

        const { schemeSize } = this.config.getColorConfig();
        const rootStyle = getComputedStyle(document.documentElement);
        const scheme = [];

        for (let i = 1; i <= schemeSize; i++) {
            const color = rootStyle.getPropertyValue(`--wordcloud-scheme-${i}`).trim();
            if (color) scheme.push(color);
        }

        // Never hand back an empty palette — d3 would render invisible words.
        this.schemeCache = scheme.length > 0 ? scheme : ['#264653'];
        return this.schemeCache;
    }

    /** Call when the stylesheet or theme changes. */
    invalidateScheme() {
        this.schemeCache = null;
    }

    getColorForWord(index, totalWords) {
        const scheme = this.getScheme();
        const { colorAssignment } = this.config.getColorConfig();

        switch (colorAssignment) {
            case 'frequency': {
                // Spread the palette across the ranking, most frequent first.
                const slot = Math.floor((index / Math.max(totalWords, 1)) * scheme.length);
                return scheme[Math.min(slot, scheme.length - 1)];
            }
            case 'random':
                return scheme[Math.floor(Math.random() * scheme.length)];
            case 'fixed':
            default:
                return scheme[index % scheme.length];
        }
    }

    // ------------------------------------------------------------------ fonts

    /**
     * Builds a font-size function for one layout pass.
     *
     * Returning a closure lets the per-word cost stay O(1): the area-derived
     * base size and the largest raw size are computed once, not once per word
     * as the previous `FontManager.calculateFontSize` did.
     *
     * @param {Array<{size: number}>} words
     * @param {number} area Cloud area in px².
     * @returns {(word: {size: number}) => number}
     */
    createSizer(words, area) {
        const { minSize, maxSize, scaleFactor } = this.config.getFontConfig();
        const upperBound = maxSize ?? Infinity;

        const largest = words.reduce((max, word) => Math.max(max, word.size), 0) || 1;
        const baseSize = Math.sqrt(area / (Math.max(words.length, 1) * scaleFactor));

        return word => {
            const scaled = baseSize * (word.size / largest);
            return Math.min(Math.max(scaled, minSize), upperBound);
        };
    }

    applyFontStyles(selection, size, weight) {
        const { family, weights } = this.config.getFontConfig();
        selection
            .style('font-family', family)
            .style('font-size', `${size}px`)
            .style('font-weight', weight ?? weights.normal);
    }

    /** Clamps a hover-scaled size back into the configured font range. */
    scaleFont(size, factor) {
        const { minSize, maxSize } = this.config.getFontConfig();
        return Math.min(Math.max(size * factor, minSize), maxSize ?? Infinity);
    }

    // --------------------------------------------------------------- painting

    /**
     * Applies colour, position and typography to a d3 selection of `<text>`
     * nodes. Pointer handlers are bound separately by the Renderer so that a
     * single `mouseover` listener owns the whole hover behaviour.
     */
    paint(wordElements) {
        const total = wordElements.size();
        const { opacity, transition } = this.config.getColorConfig();

        wordElements
            .attr('text-anchor', 'middle')
            .attr('transform', d => `translate(${d.x},${d.y})rotate(${d.rotate || 0})`)
            .style('fill', (d, i) => this.getColorForWord(i, total))
            .style('cursor', 'pointer')
            .style('opacity', opacity.normal)
            .style('transition', `opacity ${transition.duration}ms ease`)
            .text(d => d.text);

        const styler = this;
        wordElements.each(function (d) {
            styler.applyFontStyles(d3.select(this), d.size);
        });
    }

    // ------------------------------------------------------------- animations

    /** Grows and emphasises a word under the pointer. */
    wordEnter(element, size) {
        const { duration, scaleOnHover } = this.config.getAnimationConfig();
        const { weights } = this.config.getFontConfig();
        const { opacity } = this.config.getColorConfig();

        d3.select(element)
            .style('opacity', opacity.hover)
            .transition()
            .duration(duration)
            .call(selection => this.applyFontStyles(selection, this.scaleFont(size, scaleOnHover), weights.bold));
    }

    /** Restores a word to its resting appearance. */
    wordExit(element, size) {
        const { duration } = this.config.getAnimationConfig();
        const { weights } = this.config.getFontConfig();
        const { opacity } = this.config.getColorConfig();

        d3.select(element)
            .style('opacity', opacity.normal)
            .transition()
            .duration(duration)
            .call(selection => this.applyFontStyles(selection, size, weights.normal));
    }
}
