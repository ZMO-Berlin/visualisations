/**
 * Fills the landing page's figures and the two card previews with real data.
 *
 * The alternative — writing "1,962 publications" into both language pages —
 * would be wrong the first time the monthly refresh runs. Everything below
 * reads the same files the two apps read, so this page cannot drift from what
 * it links to.
 *
 * Both previews are drawn from data rather than mocked up. A card that promises
 * a word cloud and shows a picture of one is making a claim the reader cannot
 * check; these are the actual commonest terms and the actual shape of the
 * register over thirty-two years, at postage-stamp size.
 *
 * Nothing here is required for the page to make sense. The markup ships with a
 * usable sentence in every slot this replaces, so a failed fetch, a slow
 * connection or a reader with JavaScript off gets a page that still works.
 */

const META_URL = new URL('../publications_dashboard/data/meta.json', import.meta.url);
const WORDS_URL = new URL('../units_wordcloud/data/combined_word_frequencies.json', import.meta.url);

/** The page's language decides how the numbers are grouped. */
const LOCALE = document.documentElement.lang || 'en';
const NUMBER = new Intl.NumberFormat(LOCALE);

/** Terms in the card preview. Eleven fills the box at a readable size. */
const PREVIEW_WORDS = 11;

/** The word cloud's own six tones, assigned by rank exactly as the cloud does. */
const CLOUD_TONES = 6;

async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.json();
}

/** Writes a figure tile, leaving the fallback in place if the value is absent. */
function setFigure(name, value) {
    const target = document.querySelector(`[data-figure="${name}"]`);
    if (target && value) {
        target.textContent = value;
    }
}

function fillFigures(meta) {
    const counts = meta?.counts ?? {};
    const years = meta?.years;

    setFigure('publications', counts.publications && NUMBER.format(counts.publications));
    setFigure('authors', counts.authors && NUMBER.format(counts.authors));

    const span = document.querySelector('[data-figure="years"]');
    if (span && years) {
        const dash = document.createElement('span');
        dash.className = 'dash';
        dash.textContent = '–';
        span.replaceChildren(String(years.min), dash, String(years.max));
    }
}

/**
 * The publications card's sparkline: one column per year.
 *
 * Heights are shares of the busiest year rather than of the axis, so the tallest
 * column always reaches the top and the shape reads the same whatever the range
 * happens to be that month. A year with no publications still gets a hairline,
 * because a gap in the row would otherwise read as a missing year rather than
 * an empty one.
 */
function fillSpark(meta) {
    const bars = document.querySelector('[data-spark]');
    const perYear = meta?.perYear;
    if (!bars || !perYear?.length) {
        return;
    }

    const peak = Math.max(...perYear.map(entry => entry.count));
    if (!peak) {
        return;
    }

    bars.replaceChildren(...perYear.map(entry => {
        const bar = document.createElement('span');
        bar.className = 'card__bar';
        bar.style.height = `${Math.max((entry.count / peak) * 100, 1.5)}%`;
        return bar;
    }));

    const first = perYear[0].year;
    const last = perYear[perYear.length - 1].year;
    document.querySelectorAll('[data-spark-from]').forEach(node => { node.textContent = first; });
    document.querySelectorAll('[data-spark-to]').forEach(node => { node.textContent = last; });
}

/**
 * The word cloud card's preview: the commonest terms, at the size their
 * frequency earns them.
 *
 * These are the real top eleven from the same file the cloud reads, not a
 * chosen-looking sample — a card that promises a word cloud and shows a
 * flattering hand-picked one is making a claim the reader cannot check.
 *
 * The words are reordered before being laid out. In rank order they descend
 * neatly from left to right, which reads as a sorted list rather than a cloud,
 * and the cloud does not present them in that order either. The stride is fixed
 * rather than random so the preview is the same picture on every visit.
 *
 * Colour cycles over the laid-out order rather than following rank as the cloud
 * does. At eleven words a rank-to-tone mapping is not legible anyway, and any
 * stride that wraps eventually lands two ranks six apart side by side — which
 * is two neighbours in the same colour, the one thing the preview must not do.
 */
function fillCloud(words) {
    const target = document.querySelector('[data-cloud]');
    if (!target || !words?.length) {
        return;
    }

    const top = words.slice(0, PREVIEW_WORDS);
    const sizes = top.map(word => word.size);
    const most = Math.max(...sizes);
    const least = Math.min(...sizes);
    if (!most) {
        return;
    }

    /*
     * Type size spans this set's own range, not zero-to-most. The eleven
     * commonest terms are close together — 56 down to 33 — so scaling from zero
     * put them all between 25px and 34px, which is a preview with no shape in
     * it. Against their own spread the same eleven run the full 13–34px, and it
     * is still frequency that decides which word is which size.
     */
    const span = most - least;
    const sizeOf = size => (span ? 13 + Math.round(((size - least) / span) * 21) : 22);

    // Coprime with the list length, so stepping by it visits every entry once
    // and interleaves the large words with the small.
    const stride = 5;

    target.replaceChildren(...top.map((_, index) => {
        const word = top[(index * stride) % top.length];
        const node = document.createElement('span');
        node.textContent = word.text;
        node.style.fontSize = `${sizeOf(word.size)}px`;
        node.style.color = `var(--cloud-${(index % CLOUD_TONES) + 1})`;
        return node;
    }));
}

async function fill() {
    // Settled rather than all: a missing word-frequency file should not cost the
    // page its publication figures, or the other way round.
    const [meta, words] = await Promise.allSettled([getJSON(META_URL), getJSON(WORDS_URL)]);

    if (meta.status === 'fulfilled') {
        fillFigures(meta.value);
        fillSpark(meta.value);
    } else {
        console.warn('Could not read the publication figures', meta.reason);
    }

    if (words.status === 'fulfilled') {
        fillCloud(words.value);
    } else {
        console.warn('Could not read the word frequencies', words.reason);
    }
}

fill();
