/**
 * A three-line element builder, used instead of assembling HTML strings.
 *
 * Titles, author names and journal names come from a scraped website. Building
 * markup by concatenation would make every one of those fields an injection
 * site; going through `textContent` makes that structurally impossible rather
 * than a rule to remember at each call site.
 */

/**
 * @param {string} tag
 * @param {object} [props] `class`, `text`, `html`-free attributes, `dataset`,
 *   `on` for listeners, anything else is set as an attribute.
 * @param {(Node|string|null|false|undefined)[]} [children]
 */
export function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) {
            continue;
        }

        if (key === 'class') {
            node.className = value;
        } else if (key === 'text') {
            node.textContent = value;
        } else if (key === 'dataset') {
            Object.assign(node.dataset, value);
        } else if (key === 'on') {
            for (const [event, handler] of Object.entries(value)) {
                node.addEventListener(event, handler);
            }
        } else if (key === 'style') {
            Object.assign(node.style, value);
        } else if (value === true) {
            node.setAttribute(key, '');
        } else {
            node.setAttribute(key, value);
        }
    }

    for (const child of children) {
        if (child === null || child === undefined || child === false) {
            continue;
        }
        node.append(child);
    }

    return node;
}

/** Same, in the SVG namespace — `createElement` would build an unknown HTML tag. */
export function svg(tag, props = {}, children = []) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);

    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) {
            continue;
        }
        if (key === 'text') {
            node.textContent = value;
        } else if (key === 'on') {
            for (const [event, handler] of Object.entries(value)) {
                node.addEventListener(event, handler);
            }
        } else {
            node.setAttribute(key, value);
        }
    }

    node.append(...children.filter(Boolean));
    return node;
}

/**
 * A titled panel: the frame every chart is drawn inside.
 *
 * The hint rides on the title's line rather than below it. It says how to drive
 * the chart — "click a column to filter by year" — which is worth one glance
 * and, on a page of six panels, should not cost six lines of height.
 */
export function panel({ title, hint, actions }, body) {
    return el('section', { class: 'panel' }, [
        el('div', { class: 'panel__head' }, [
            el('h2', { class: 'panel__title', text: title }),
            hint && el('p', { class: 'panel__hint', text: hint }),
            actions
        ]),
        el('div', { class: 'panel__body' }, [body])
    ]);
}

/** Replaces an element's children with one new subtree. */
export function mount(container, node) {
    container.replaceChildren(node);
    return node;
}
