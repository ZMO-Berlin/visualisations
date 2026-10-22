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
            for (const [property, setting] of Object.entries(value)) {
                if (property.startsWith('--')) node.style.setProperty(property, setting);
                else node.style[property] = setting;
            }
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
export function panel({ title, hint, actions, fullscreen }, body) {
    const section = el('section', { class: 'panel' });
    section.append(
        el('div', { class: 'panel__head' }, [
            el('h2', { class: 'panel__title', text: title }),
            hint && el('p', { class: 'panel__hint', text: hint }),
            actions,
            fullscreen && fullscreenButton(section, fullscreen)
        ]),
        el('div', { class: 'panel__body' }, [body])
    );
    return section;
}

// Corner arrows pointing out (enter) and in (leave), drawn on a 24-unit grid.
const EXPAND = 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5';
const COLLAPSE = 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5';

/**
 * A button that shows one panel on the whole screen, and back.
 *
 * The browser's Fullscreen API rather than a CSS overlay: Escape, the
 * browser's own exit control and the reader's expectations all come with it.
 * The icon and accessible name follow `fullscreenchange`, so leaving with
 * Escape updates the button too. Absent where the API is (some embedded
 * contexts disallow it), rather than a button that does nothing.
 *
 * @param {HTMLElement} section
 * @param {{enter: string, exit: string}} labels
 */
export function fullscreenButton(section, labels) {
    if (!document.fullscreenEnabled) return null;
    const path = svg('path', {
        d: EXPAND, fill: 'none', stroke: 'currentColor',
        'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    const button = el('button', {
        type: 'button', class: 'panel__fullscreen', 'aria-label': labels.enter, title: labels.enter,
        on: {
            click: () => (document.fullscreenElement === section
                ? document.exitFullscreen()
                : section.requestFullscreen().catch(() => {}))
        }
    }, [svg('svg', { viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true', focusable: 'false' }, [path])]);
    section.addEventListener('fullscreenchange', () => {
        const on = document.fullscreenElement === section;
        path.setAttribute('d', on ? COLLAPSE : EXPAND);
        button.setAttribute('aria-label', on ? labels.exit : labels.enter);
        button.title = on ? labels.exit : labels.enter;
        section.classList.toggle('panel--fullscreen', on);
    });
    return button;
}

/** Preserve the user's focus when a subtree genuinely needs replacement. */
export function replaceContent(container, ...nodes) {
    const active = document.activeElement;
    const selector = 'button, input, select, a[href], [tabindex="0"]';
    const previous = [...container.querySelectorAll(selector)];
    const owned = active !== document.body && container.contains(active);
    const key = owned ? (active.dataset.key ?? active.getAttribute('aria-label') ?? active.textContent) : null;
    const index = previous.indexOf(active);
    container.replaceChildren(...nodes);
    if (owned) {
        const candidates = [...container.querySelectorAll(selector)].filter(node => !node.disabled);
        const target = candidates.find(node => (node.dataset.key ?? node.getAttribute('aria-label') ?? node.textContent) === key)
            ?? candidates[Math.min(Math.max(index, 0), candidates.length - 1)];
        if (target) target.focus({ preventScroll: true });
        else { container.tabIndex = -1; container.focus({ preventScroll: true }); }
    }
}
export function mount(container, node) {
    replaceContent(container, node);
    return node;
}
