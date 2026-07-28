import { Tooltip } from '../Tooltip.js';
import { StyleManager } from '../../utils/StyleManager.js';
import { WORDCLOUD_EVENTS } from '../../events/EventTypes.js';

/**
 * Draws laid-out words into an SVG and owns their pointer interactions.
 *
 * The renderer is the *only* place that binds `mouseover`/`mouseout` to word
 * nodes. d3 replaces a listener when the same event name is bound twice, so
 * splitting hover behaviour across several modules — as the previous
 * WordStyleManager/Renderer pair did — silently dropped whichever bound first.
 */
export class WordCloudRenderer {
    /**
     * @param {HTMLElement} container
     * @param {object} deps
     * @param {import('../../config/ConfigManager.js').ConfigManager} deps.config
     * @param {import('../../events/EventBus.js').EventBus} deps.eventBus
     * @param {import('../../utils/WordStyler.js').WordStyler} deps.wordStyler
     */
    constructor(container, { config, eventBus, wordStyler }) {
        this.container = container;
        this.config = config;
        this.eventBus = eventBus;
        this.wordStyler = wordStyler;

        this.svg = null;
        this.wordGroup = null;
        this.tooltip = new Tooltip({ config });
        this.wordList = null;
    }

    setWordList(wordList) {
        this.wordList = wordList;
    }

    /** Replaces any previous SVG with a fresh one sized to the current config. */
    createSVG() {
        this.clear();

        const wrapper = document.createElement('div');
        StyleManager.setupWrapper(wrapper);
        this.container.appendChild(wrapper);

        const { width, height } = this.config.get('wordcloud.dimensions');

        this.svg = d3.select(wrapper)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', `0 0 ${width} ${height}`)
            .attr('role', 'img')
            .attr('aria-label', 'Word cloud of the most frequent terms');

        StyleManager.setupSVG(this.svg);
        return this.svg;
    }

    createWordGroup(svg) {
        const { width, height } = this.config.get('wordcloud.dimensions');
        // d3-cloud lays words out around the origin, so shift to the centre.
        this.wordGroup = svg.append('g')
            .attr('transform', `translate(${width / 2},${height / 2})`);
        return this.wordGroup;
    }

    updateDimensions(width, height) {
        if (!width || !height) return;

        this.config.updateDimensions(width, height);

        this.svg?.attr('viewBox', `0 0 ${width} ${height}`);
        this.wordGroup?.attr('transform', `translate(${width / 2},${height / 2})`);
    }

    renderWords(wordGroup, words) {
        if (!words || words.length === 0) return null;

        const wordElements = wordGroup.selectAll('text')
            .data(words, d => d.text)
            .join('text')
            .attr('data-word', d => d.text);

        this.wordStyler.paint(wordElements);
        this.bindWordInteractions(wordElements);

        return wordElements;
    }

    bindWordInteractions(wordElements) {
        wordElements
            .on('mouseover', (event, d) => {
                this.tooltip.show(event, d);
                this.wordStyler.wordEnter(event.currentTarget, d.size);
                this.wordList?.highlightWord(d.text);
                this.eventBus.emit(WORDCLOUD_EVENTS.WORD_HOVER, { word: d });
            })
            .on('mouseout', (event, d) => {
                this.tooltip.hide();
                this.wordStyler.wordExit(event.currentTarget, d.size);
                this.wordList?.clearHighlight();
            })
            .on('click', (event, d) => {
                this.eventBus.emit(WORDCLOUD_EVENTS.WORD_CLICK, { word: d });
            });
    }

    /**
     * Applies the hover appearance to a word by name, for hovers originating
     * outside the cloud (currently the word list).
     */
    highlightWord(text) {
        const node = this.findWordNode(text);
        if (node) {
            this.wordStyler.wordEnter(node, d3.select(node).datum().size);
        }
    }

    clearWordHighlight(text) {
        const node = this.findWordNode(text);
        if (node) {
            this.wordStyler.wordExit(node, d3.select(node).datum().size);
        }
    }

    findWordNode(text) {
        if (!this.wordGroup) return null;
        return this.wordGroup
            .selectAll('text')
            .nodes()
            .find(node => node.getAttribute('data-word') === text) ?? null;
    }

    /** Empties the drawing surface. The tooltip survives across redraws. */
    clear() {
        this.tooltip.hide();
        this.container.replaceChildren();
        this.svg = null;
        this.wordGroup = null;
    }

    destroy() {
        this.clear();
        this.tooltip.destroy();
        this.wordList = null;
    }
}
