/**
 * Every tunable value in the dashboard, in one place.
 *
 * A factory rather than a singleton: `main.js` calls it once and injects the
 * result, so nothing reaches for a global and any component can be built in
 * isolation with settings of its own.
 *
 * @param {object} options
 * @param {string} options.basePath App root, derived from `main.js`'s own URL.
 */
export function createSettings({ basePath }) {
    return Object.freeze({
        paths: {
            publications: `${basePath}/data/publications.json`,
            meta: `${basePath}/data/meta.json`
        },

        charts: {
            /**
             * Bars per page. The rankings run to hundreds of rows — around 500
             * journals and 400 authors — so every ranked chart pages rather
             * than truncating silently at a top-N.
             */
            pageSize: 12,
            /**
             * Document types drawn as their own stacked series; the rest fold
             * into one bucket. Eight is the ceiling for a categorical palette
             * that stays distinguishable to a colourblind reader, and the
             * bucket takes the eighth slot — so seven are named.
             */
            seriesLimit: 7,
            networkHeight: 420
        },

        network: {
            /**
             * Authors with fewer publications than this are left out of the
             * co-authorship graph. The register is dominated by single-authored
             * work, so without a floor the graph is mostly one-off pairings and
             * the recurring collaborations are impossible to see.
             */
            minPublications: 1,
            /**
             * Most-published authors drawn at once, and how many more each step
             * adds. A force layout with several hundred nodes is a hairball and
             * costs a second of simulation for a picture nobody can read, so the
             * graph opens on the busiest authors and grows on request.
             */
            maxNodes: 60,
            nodeStep: 60,
            /** Nodes with no co-author are omitted; they carry no edge. */
            radius: { min: 4, max: 18 },
            charge: -180,
            linkDistance: 60
        },

        list: {
            /** Publications per page; the full list is ~2,000. */
            pageSize: 20
        },

        /** Log state transitions to the console (`?debug`). */
        debug: false
    });
}
