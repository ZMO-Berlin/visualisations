/**
 * The bar across the top of all three pages.
 *
 * Before this, the landing page, the word cloud and the dashboard each had
 * their own heading and their own language link, and no way to get from one
 * visualisation to the other without going back. They were three sites. The bar
 * is what makes them one: the mark, the view you are on, the two you are not,
 * and the other language.
 *
 * Two things it deliberately does not do:
 *
 *  - It does not render when the page is inside an iframe. Both apps are
 *    embedded on zmo.de, where the institute's own header is already above
 *    them; a second mark and a second set of site links inside the frame would
 *    be a duplicate of the page around it. The context strip and the toolbar
 *    stay, because those belong to the visualisation rather than to the site.
 *
 *  - It does not hard-code a single path. Links are resolved from this
 *    module's own URL, so the same files work from a local server, a user site
 *    and a project page at any depth, with nothing to configure per deployment
 *    and nothing to update if the repository is renamed.
 */

const STRINGS = {
    en: {
        section: 'Visualisations',
        overview: 'Overview',
        wordcloud: 'Word cloud',
        publications: 'Publications',
        nav: 'Visualisations',
        institute: 'Leibniz-Zentrum Moderner Orient',
        // The label is the language it switches *to*, written in that language.
        otherLanguage: 'Deutsch',
        otherLanguageShort: 'DE'
    },
    de: {
        section: 'Visualisierungen',
        overview: 'Übersicht',
        wordcloud: 'Wortwolke',
        publications: 'Publikationen',
        nav: 'Visualisierungen',
        institute: 'Leibniz-Zentrum Moderner Orient',
        otherLanguage: 'English',
        otherLanguageShort: 'EN'
    }
};

/** `shared/site-bar.js` sits one level under the site root. */
const ROOT = new URL('../', import.meta.url);

/** The three views, in the order they are offered. */
const VIEWS = [
    { key: 'overview', path: locale => `${locale}/` },
    { key: 'wordcloud', path: locale => `units_wordcloud/${locale}/` },
    { key: 'publications', path: locale => `publications_dashboard/${locale}/` }
];

function locale() {
    const declared = document.documentElement.lang?.slice(0, 2).toLowerCase();
    if (declared && declared in STRINGS) {
        return declared;
    }
    const fromPath = window.location.pathname.match(/\/([a-z]{2})\//i)?.[1]?.toLowerCase();
    return fromPath && fromPath in STRINGS ? fromPath : 'en';
}

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.filter(Boolean));
    return node;
}

/**
 * Builds the bar into every `[data-site-bar]` on the page.
 *
 * The attribute's value names the current view, so the bar does not have to
 * guess it from the URL — which would be wrong the moment a page moves.
 */
export function renderSiteBar() {
    const mounts = document.querySelectorAll('[data-site-bar]');
    if (!mounts.length) {
        return;
    }

    // `window.top` throws on a cross-origin parent, which is itself the answer:
    // if reading it is refused, this page is framed by someone else.
    let framed = false;
    try {
        framed = window.self !== window.top;
    } catch {
        framed = true;
    }

    if (framed) {
        mounts.forEach(mount => mount.remove());
        document.documentElement.dataset.embedded = 'true';
        return;
    }

    const lang = locale();
    const strings = STRINGS[lang];
    const other = lang === 'de' ? 'en' : 'de';

    mounts.forEach(mount => {
        const current = mount.dataset.siteBar;

        const links = VIEWS.map(view => {
            const isCurrent = view.key === current;
            const label = strings[view.key];

            if (isCurrent) {
                return el('span', {
                    class: 'site-bar__link site-bar__link--current',
                    'aria-current': 'page'
                }, [el('span', { class: 'site-bar__marker', 'aria-hidden': 'true' }), label]);
            }

            return el('a', {
                class: 'site-bar__link',
                href: new URL(view.path(lang), ROOT).href,
                text: label
            });
        });

        mount.replaceChildren(
            el('a', {
                class: 'site-bar__brand',
                href: 'https://www.zmo.de/',
                // The logo carries the institute's name, so the alt text is the
                // name itself and nothing beside it repeats the line.
                'aria-label': strings.institute
            }, [
                el('img', {
                    class: 'site-bar__logo',
                    src: new URL('landing/zmo-logo.png', ROOT).href,
                    alt: strings.institute,
                    width: '763', height: '701'
                })
            ]),
            el('span', { class: 'site-bar__rule', 'aria-hidden': 'true' }),
            el('span', { class: 'site-bar__section', text: strings.section }),
            el('nav', { class: 'site-bar__nav', 'aria-label': strings.nav }, links),
            el('span', { class: 'site-bar__rule', 'aria-hidden': 'true' }),
            el('a', {
                class: 'site-bar__lang',
                // The same view in the other language, not that language's home
                // page: switching language should not also lose your place.
                href: new URL(
                    (VIEWS.find(view => view.key === current) ?? VIEWS[0]).path(other), ROOT
                ).href,
                lang: other,
                hreflang: other,
                title: strings.otherLanguage,
                text: strings.otherLanguageShort
            })
        );

        mount.classList.add('site-bar');
        mount.hidden = false;
    });
}

renderSiteBar();
