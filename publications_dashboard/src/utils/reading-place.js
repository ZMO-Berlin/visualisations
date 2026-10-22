/**
 * Keeps the reader's place on the page when a filter changes it.
 *
 * Choosing India on the regions map shortens the theme ranking above it by
 * 171px and the language and access panels by 280px, so the map the reader
 * was looking at jumped up under their pointer — and back down when the filter
 * was cleared. The browser's scroll anchoring would normally absorb that, but
 * it anchors on a node near the top of the window, and the charts replace
 * their nodes on every render, which switches anchoring off.
 *
 * So the place is kept by hand. Before a filter change renders, `mark()` notes
 * where on screen the element the reader just used sits, and every ancestor of
 * it up to the page; `restore()` finds the nearest of those that survived the
 * render — a bubble on the map does, a re-drawn ranking row does not, its list
 * does — and scrolls by however far it moved. Without a recent click or key
 * press inside the page (the back button, the fixed filter dock), it holds what
 * is in the middle of the window instead.
 */

/** A click or key press older than this did not cause the change. */
const RECENT_MS = 1500;

export class ReadingPlace {
    #target = null;
    #at = 0;
    #onInput;

    /** @param {HTMLElement} root What the place is kept within: the page's main content. */
    constructor(root) {
        this.root = root;
        this.#onInput = event => {
            this.#target = event.target;
            this.#at = performance.now();
        };
        document.addEventListener('pointerdown', this.#onInput, true);
        document.addEventListener('keydown', this.#onInput, true);
    }

    /** @returns {{node: Element, top: number}[]|null} */
    mark() {
        const recent = performance.now() - this.#at < RECENT_MS && this.#target?.isConnected
            && this.root.contains(this.#target) ? this.#target : null;
        const start = recent ?? this.#midScreen();
        if (!start) return null;
        const chain = [];
        for (let node = start; node && node !== this.root; node = node.parentElement) {
            chain.push({ node, top: node.getBoundingClientRect().top });
        }
        return chain;
    }

    /** @param {ReturnType<ReadingPlace['mark']>} chain */
    restore(chain) {
        const anchor = chain?.find(({ node }) => node.isConnected && this.root.contains(node));
        if (!anchor) return;
        const moved = anchor.node.getBoundingClientRect().top - anchor.top;
        if (Math.abs(moved) >= 1) window.scrollBy(0, moved);
    }

    /**
     * What the reader is looking at: the element in the middle of the window,
     * or the block of the page across it. Not the first block still showing at
     * the top, which may be a panel scrolled almost out of sight — holding its
     * top lets everything the reader can see move with its height.
     */
    #midScreen() {
        const middle = innerHeight / 2;
        const blocks = [...this.root.querySelectorAll('#filters, #panels > *')].filter(block => block.offsetParent);
        const block = blocks.find(b => { const r = b.getBoundingClientRect(); return r.top <= middle && r.bottom >= middle; })
            ?? blocks.find(b => b.getBoundingClientRect().top >= 0);
        if (!block) return null;
        const point = document.elementFromPoint(innerWidth / 2, middle);
        return point && block.contains(point) ? point : block;
    }

    destroy() {
        document.removeEventListener('pointerdown', this.#onInput, true);
        document.removeEventListener('keydown', this.#onInput, true);
    }
}
