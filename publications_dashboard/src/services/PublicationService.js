/**
 * Loads the dataset the pipeline committed.
 *
 * All files are static JSON next to the app, so this is a fetch and a couple
 * of shape checks — the point of the checks is that a truncated or half-written
 * file fails here, with a message, rather than three components deep in a chart
 * that cannot explain what went wrong.
 *
 * The register and its metadata are required. The enrichment layers are not:
 * a missing or inconsistent people or themes file costs the views that use it,
 * not the dashboard, so their failures are logged and reported as absent.
 */
import { validateDataset, validateOpenAlex, validatePeople, validateRegions, validateSubjects, validateThemes } from '../utils/contracts.js';

export class PublicationService {
    #openalex = null;

    constructor({ settings }) {
        this.settings = settings;
    }

    /** @returns {Promise<{publications: object[], meta: object, people: object, themes: object|null, regions: object|null, subjects: object|null}>} */
    async load() {
        const [publications, meta, people, themes, regions, subjects] = await Promise.all([
            this.#fetchJson(this.settings.paths.publications),
            this.#fetchJson(this.settings.paths.meta),
            this.#optional(this.settings.paths.people),
            this.#optional(this.settings.paths.themes),
            this.#optional(this.settings.paths.regions),
            this.#optional(this.settings.paths.subjects)
        ]);

        if (!Array.isArray(publications) || publications.length === 0) {
            throw new Error('publications.json is empty or not an array');
        }

        const dataset = validateDataset(publications, meta);
        return {
            ...dataset,
            people: this.#checked(() => validatePeople(people ?? {}), {}),
            themes: themes && this.#checked(() => validateThemes(themes, meta, publications.length), null),
            regions: regions && this.#checked(() => validateRegions(regions, meta), null),
            subjects: subjects && this.#checked(() => validateSubjects(subjects, meta), null)
        };
    }

    /** Country outlines for the regions map, fetched once on first use. */
    loadWorld() {
        this.world ??= this.#fetchJson(this.settings.paths.world).catch(error => { this.world = null; throw error; });
        return this.world;
    }

    /** OpenAlex's layer, fetched once on first use. */
    loadOpenAlex(meta, count) {
        this.#openalex ??= this.#fetchJson(this.settings.paths.openalex)
            .then(data => validateOpenAlex(data, meta, count))
            .catch(error => { this.#openalex = null; throw error; });
        return this.#openalex;
    }

    #checked(validate, fallback) {
        try { return validate(); }
        catch (error) { console.error(error); return fallback; }
    }

    async #optional(url) {
        try { return await this.#fetchJson(url); }
        catch (error) { console.error(error); return null; }
    }

    async #fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`${url}: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
}
