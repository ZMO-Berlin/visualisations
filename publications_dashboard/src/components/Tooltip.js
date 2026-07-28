/**
 * One floating label, shared by every chart.
 *
 * A single element is created once and moved, rather than one per data point:
 * the timeline alone has a column per year and the network a node per author,
 * and giving each its own tooltip node would put hundreds of absolutely
 * positioned elements in the document for the sake of the one under the cursor.
 */

import { el } from '../utils/dom.js';

const OFFSET = 12;

export class Tooltip {
    constructor(container = document.body) {
        this.node = el('div', { class: 'tooltip', role: 'tooltip', 'aria-hidden': 'true' });
        this.node.hidden = true;
        container.append(this.node);
    }

    /** @param {string[]} lines First line is emphasised. */
    show(lines, event) {
        this.node.replaceChildren(
            ...lines.filter(Boolean).map((line, index) =>
                el('div', { class: index === 0 ? 'tooltip__title' : 'tooltip__line', text: line })
            )
        );
        this.node.hidden = false;
        this.move(event);
    }

    move(event) {
        if (this.node.hidden) {
            return;
        }

        // Measured after the content is in place, then flipped if it would run
        // off the right or bottom edge of the viewport.
        const { width, height } = this.node.getBoundingClientRect();
        const x = event.clientX + OFFSET + width > window.innerWidth
            ? event.clientX - width - OFFSET
            : event.clientX + OFFSET;
        const y = event.clientY + OFFSET + height > window.innerHeight
            ? event.clientY - height - OFFSET
            : event.clientY + OFFSET;

        this.node.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
    }

    hide() {
        this.node.hidden = true;
    }

    destroy() {
        this.node.remove();
    }
}
