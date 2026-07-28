/**
 * Loads the dataset the pipeline committed.
 *
 * Both files are static JSON next to the app, so this is a fetch and a couple
 * of shape checks — the point of the checks is that a truncated or half-written
 * file fails here, with a message, rather than three components deep in a chart
 * that cannot explain what went wrong.
 */
export class PublicationService {
    constructor({ settings }) {
        this.settings = settings;
    }

    /** @returns {Promise<{publications: object[], meta: object}>} */
    async load() {
        const [publications, meta] = await Promise.all([
            this.#fetchJson(this.settings.paths.publications),
            this.#fetchJson(this.settings.paths.meta)
        ]);

        if (!Array.isArray(publications) || publications.length === 0) {
            throw new Error('publications.json is empty or not an array');
        }

        return { publications, meta: meta ?? {} };
    }

    async #fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`${url}: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
}
