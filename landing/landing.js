/**
 * Fills the publications card with the dataset's real figures.
 *
 * The alternative — writing "1,962 publications" into both language pages —
 * would be wrong the first time the monthly refresh runs. This reads the same
 * `meta.json` the dashboard does, so the landing page cannot drift from what it
 * links to.
 *
 * The markup already contains a usable sentence; this only replaces it on
 * success, so a failed fetch or an offline reader leaves a page that still
 * makes sense.
 */

const META_URL = new URL('../publications_dashboard/data/meta.json', import.meta.url);

/** The page's language decides how the numbers are grouped and joined. */
const LOCALE = document.documentElement.lang || 'en';

const PHRASE = {
    en: (count, from, to) => `${count} publications, ${from}–${to}`,
    fr: (count, from, to) => `${count} publications, ${from}–${to}`
};

async function fillStat() {
    const target = document.querySelector('[data-publication-stat]');
    if (!target) {
        return;
    }

    try {
        const response = await fetch(META_URL);
        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }

        const meta = await response.json();
        const count = meta?.counts?.publications;
        const years = meta?.years;

        if (!count || !years) {
            return;
        }

        const phrase = PHRASE[LOCALE.slice(0, 2)] ?? PHRASE.en;
        target.textContent = phrase(
            new Intl.NumberFormat(LOCALE).format(count), years.min, years.max
        );
    } catch (error) {
        // Nothing to recover: the fallback sentence is already on the page.
        console.warn('Could not read the publication figures', error);
    }
}

fillStat();
