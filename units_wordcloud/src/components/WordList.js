import { getTranslations } from '../utils/translations.js';

/**
 * Paginated ranking of the words currently in the cloud.
 *
 * Hovering a row highlights the matching word in the cloud and vice versa. The
 * list-to-cloud direction reports through the `onWordHover` / `onWordHoverEnd`
 * callbacks; it previously synthesised `MouseEvent`s and dispatched them at the
 * SVG nodes, which re-entered the cloud's own hover handler and could re-paginate
 * the list out from under the pointer.
 */
export class WordList {
    /**
     * @param {string|HTMLElement} container
     * @param {object} [deps]
     * @param {import('../config/ConfigManager.js').ConfigManager} [deps.config]
     * @param {number} [deps.wordsPerPage]
     */
    constructor(container, { config, wordsPerPage = 15 } = {}) {
        this.container = container instanceof HTMLElement
            ? container
            : document.getElementById(container);

        if (!this.container) {
            throw new Error(`WordList: container "${container}" not found`);
        }

        this.config = config;
        this.translations = getTranslations();
        this.words = [];
        this.currentPage = 1;
        this.wordsPerPage = wordsPerPage;

        this.onWordHover = null;
        this.onWordHoverEnd = null;

        this.render();
    }

    render() {
        // Layout comes entirely from `styles/modules/wordlist.css`. The inline
        // styles previously applied here were meant for the cloud container and
        // overrode the stylesheet's sizing.
        const listContainer = document.createElement('div');
        listContainer.className = 'word-list-container';

        const header = document.createElement('div');
        header.className = 'word-list-header';
        const title = document.createElement('h2');
        title.className = 'font-semibold';
        title.textContent = this.translations.wordList;
        header.appendChild(title);

        const list = document.createElement('div');
        list.className = 'word-list';

        const pagination = document.createElement('div');
        pagination.className = 'word-list-pagination';

        listContainer.append(header, list, pagination);
        this.container.appendChild(listContainer);

        this.listElement = list;
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

    renderCurrentPage() {
        const startIndex = (this.currentPage - 1) * this.wordsPerPage;
        const pageWords = this.words.slice(startIndex, startIndex + this.wordsPerPage);

        const rows = pageWords.map((word, index) => {
            const row = document.createElement('div');
            row.className = 'word-list-item';
            row.dataset.word = word.text;

            // textContent throughout: word text comes from a generated data
            // file, and building this markup by interpolating into innerHTML
            // would make that file a script-injection vector.
            const rank = document.createElement('span');
            rank.className = 'word-rank font-normal';
            rank.textContent = `#${word.rank ?? startIndex + index + 1}`;

            const text = document.createElement('span');
            text.className = 'word-text font-medium';
            text.textContent = word.text;

            const frequency = document.createElement('span');
            frequency.className = 'word-frequency font-normal';
            frequency.textContent = word.originalSize ?? word.size;

            row.append(rank, text, frequency);
            return row;
        });

        this.listElement.replaceChildren(...rows);
        this.renderPagination();
    }

    renderPagination() {
        const totalPages = this.getTotalPages();
        this.paginationElement.replaceChildren();

        if (totalPages <= 1) return;

        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'font-medium';
        prev.textContent = '←';
        prev.setAttribute('aria-label', 'Previous page');
        prev.disabled = this.currentPage === 1;
        prev.addEventListener('click', () => this.goToPage(this.currentPage - 1));

        const pageInfo = document.createElement('span');
        pageInfo.className = 'page-info font-medium';
        pageInfo.textContent = `${this.currentPage} / ${totalPages}`;

        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'font-medium';
        next.textContent = '→';
        next.setAttribute('aria-label', 'Next page');
        next.disabled = this.currentPage === totalPages;
        next.addEventListener('click', () => this.goToPage(this.currentPage + 1));

        this.paginationElement.append(prev, pageInfo, next);
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
