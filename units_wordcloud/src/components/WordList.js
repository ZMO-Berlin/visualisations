import { getLocale, getTranslations } from '../utils/translations.js';

/**
 * Paginated ranking of the words currently in the cloud.
 *
 * Hovering a row highlights the matching word in the cloud and vice versa. The
 * list-to-cloud direction reports through the `onWordHover` / `onWordHoverEnd`
 * callbacks; it previously synthesised `MouseEvent`s and dispatched them at the
 * SVG nodes, which re-entered the cloud's own hover handler and could
 * re-paginate the list out from under the pointer.
 *
 * Each row carries its frequency twice: as a figure on the right, and as a tint
 * filling the row from the left. The cloud shows relative frequency through
 * type size, which is hard to compare across a hundred words scattered over a
 * canvas; the bars put the same quantity on one baseline, where the shape of
 * the distribution — a steep head and a long flat tail — can actually be read.
 */
export class WordList {
    /**
     * @param {string|HTMLElement} container
     * @param {object} [deps]
     * @param {import('../config/ConfigManager.js').ConfigManager} [deps.config]
     * @param {number} [deps.wordsPerPage]
     */
    constructor(container, { config, wordsPerPage = 14 } = {}) {
        this.container = container instanceof HTMLElement
            ? container
            : document.getElementById(container);

        if (!this.container) {
            throw new Error(`WordList: container "${container}" not found`);
        }

        this.config = config;
        this.translations = getTranslations();
        this.number = new Intl.NumberFormat(getLocale());
        this.words = [];
        this.currentPage = 1;
        this.wordsPerPage = wordsPerPage;

        this.onWordHover = null;
        this.onWordHoverEnd = null;

        this.render();
    }

    render() {
        const listContainer = document.createElement('div');
        listContainer.className = 'word-list-container';

        // --- header: what the panel is, and where in it you are -------------
        const header = document.createElement('div');
        header.className = 'word-list-header';

        const title = document.createElement('h2');
        title.className = 'word-list-title';
        title.textContent = this.translations.wordList;

        const range = document.createElement('span');
        range.className = 'word-list-range';

        header.append(title, range);

        const list = document.createElement('div');
        list.className = 'word-list';

        // --- footer: the hint, and the pager -------------------------------
        const footer = document.createElement('div');
        footer.className = 'word-list-footer';

        const hint = document.createElement('p');
        hint.className = 'word-list-hint';
        hint.textContent = this.translations.listHint;

        const pagination = document.createElement('div');
        pagination.className = 'word-list-pagination';

        footer.append(hint, pagination);
        listContainer.append(header, list, footer);
        this.container.appendChild(listContainer);

        this.listElement = list;
        this.rangeElement = range;
        this.paginationElement = pagination;

        this.bindHoverDelegation();
    }

    /**
     * One delegated listener per direction, rather than two per row rebound on
     * every page change.
     */
    bindHoverDelegation() {
        const rowFor = event => event.target.closest('.word-list-item');

        this.listElement.addEventListener('mouseover', event => {
            const row = rowFor(event);
            if (!row || row.contains(event.relatedTarget)) return;
            row.classList.add('hover');
            this.onWordHover?.(row.dataset.word);
        });

        this.listElement.addEventListener('mouseout', event => {
            const row = rowFor(event);
            if (!row || row.contains(event.relatedTarget)) return;
            row.classList.remove('hover');
            this.onWordHoverEnd?.(row.dataset.word);
        });
    }

    updateWords(words) {
        if (!Array.isArray(words)) {
            console.warn('WordList: expected an array of words, got', words);
            return;
        }
        this.words = words;
        this.currentPage = 1;
        this.renderCurrentPage();
    }

    /** The raw count a row shows, and that its bar is drawn from. */
    static countOf(word) {
        return word.originalSize ?? word.size ?? 0;
    }

    renderCurrentPage() {
        const startIndex = (this.currentPage - 1) * this.wordsPerPage;
        const pageWords = this.words.slice(startIndex, startIndex + this.wordsPerPage);

        // Bars are shares of the commonest word in the whole selection, not of
        // the commonest on this page: a per-page maximum would make page four's
        // rare words look as frequent as page one's.
        const peak = this.words.reduce(
            (most, word) => Math.max(most, WordList.countOf(word)), 0
        );

        const rows = pageWords.map((word, index) => {
            const count = WordList.countOf(word);

            const row = document.createElement('div');
            row.className = 'word-list-item';
            row.dataset.word = word.text;

            // Decorative: the figure beside it says the same thing in words.
            const fill = document.createElement('span');
            fill.className = 'word-fill';
            fill.style.width = peak ? `${(count / peak) * 100}%` : '0';

            // textContent throughout: word text comes from a generated data
            // file, and building this markup by interpolating into innerHTML
            // would make that file a script-injection vector.
            const rank = document.createElement('span');
            rank.className = 'word-rank';
            rank.textContent = word.rank ?? startIndex + index + 1;

            const text = document.createElement('span');
            text.className = 'word-text';
            text.textContent = word.text;

            const frequency = document.createElement('span');
            frequency.className = 'word-frequency';
            frequency.textContent = this.number.format(count);

            row.append(fill, rank, text, frequency);
            return row;
        });

        this.listElement.replaceChildren(...rows);
        this.renderRange(startIndex, pageWords.length);
        this.renderPagination();
    }

    renderRange(startIndex, shown) {
        if (!shown) {
            this.rangeElement.textContent = '';
            return;
        }
        this.rangeElement.textContent = this.translations.listRange(
            this.number.format(startIndex + 1),
            this.number.format(startIndex + shown),
            this.number.format(this.words.length)
        );
    }

    renderPagination() {
        const totalPages = this.getTotalPages();
        this.paginationElement.replaceChildren();

        if (totalPages <= 1) return;

        const step = (label, target, title) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'pager-button';
            button.textContent = label;
            button.setAttribute('aria-label', title);
            button.disabled = target < 1 || target > totalPages;
            button.addEventListener('click', () => this.goToPage(target));
            return button;
        };

        this.paginationElement.append(
            step('‹', this.currentPage - 1, this.translations.previousPage),
            step('›', this.currentPage + 1, this.translations.nextPage)
        );
    }

    getTotalPages() {
        return Math.max(Math.ceil(this.words.length / this.wordsPerPage), 1);
    }

    goToPage(page) {
        if (page < 1 || page > this.getTotalPages() || page === this.currentPage) return;
        this.currentPage = page;
        this.renderCurrentPage();
    }

    /** Highlights `word`, paging to it if it is not on the current page. */
    highlightWord(word) {
        this.clearHighlight();

        const index = this.words.findIndex(candidate => candidate.text === word);
        if (index === -1) return;

        const targetPage = Math.floor(index / this.wordsPerPage) + 1;
        if (this.currentPage !== targetPage) {
            this.goToPage(targetPage);
        }

        const row = this.findRow(word);
        if (row) {
            row.classList.add('highlighted');
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    clearHighlight() {
        this.listElement.querySelector('.highlighted')?.classList.remove('highlighted');
    }

    findRow(word) {
        return [...this.listElement.children].find(row => row.dataset.word === word) ?? null;
    }

    destroy() {
        this.onWordHover = null;
        this.onWordHoverEnd = null;
        this.container?.replaceChildren();
    }
}
