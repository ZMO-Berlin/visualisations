/**
 * Turning a list of publications into the numbers the charts draw.
 *
 * Everything here is a pure function over an array of records. The dashboard
 * ships one dataset and aggregates in the browser rather than loading
 * precomputed totals, which is what makes cross-filtering possible at all: a
 * chart can be recounted against any subset without another request.
 */

/**
 * Counts records by a key, where a record may contribute several keys.
 *
 * @param {object[]} records
 * @param {(record: object) => string|string[]|null|undefined} accessor
 * @returns {Map<string, number>} insertion-ordered counts
 */
export function countValues(records, accessor) {
    const counts = new Map();

    for (const record of records) {
        const value = accessor(record);
        if (value == null || value === '') {
            continue;
        }
        for (const key of Array.isArray(value) ? value : [value]) {
            if (key !== '' && key != null) {
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
    }

    return counts;
}

/**
 * The `limit` largest counts, biggest first, ties broken alphabetically so the
 * order does not shuffle between renders of the same data.
 */
export function rank(counts, limit = Infinity) {
    return [...counts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        .slice(0, limit);
}

/** The full year span present in the data, or null if nothing is dated. */
export function yearExtent(records) {
    const years = records.map(record => record.year).filter(Boolean);
    return years.length ? [Math.min(...years), Math.max(...years)] : null;
}

/**
 * The `limit` most common keys, with everything else folded into one bucket.
 *
 * Eight is the ceiling for a categorical palette that stays distinguishable —
 * including for colourblind readers — so a ninth series is folded rather than
 * given an invented ninth hue. The register has ten document types, of which
 * the smallest three account for under 3% of it.
 *
 * Computed once, from the *whole* dataset. If the order were recomputed per
 * filter, a series would change colour as the reader narrowed the view, and
 * colour has to follow the entity, never its current rank.
 *
 * @returns {{order: string[], folded: string[], keyOf: (value: string) => string}}
 */
export function topKeysWithOther(counts, limit, otherKey) {
    const ranked = rank(counts).map(entry => entry.key);
    const top = ranked.slice(0, limit);
    const kept = new Set(top);

    return {
        order: ranked.length > limit ? [...top, otherKey] : top,
        // The real keys behind the bucket, so selecting it can select them all.
        folded: ranked.slice(limit),
        keyOf: value => (kept.has(value) ? value : otherKey)
    };
}

/**
 * Counts per year, split into stacked series.
 *
 * Every year in the span gets an entry, including the empty ones — a gap year
 * has to be drawn as a gap, not closed up — and each year's total is broken
 * down in a fixed series order, so a segment keeps its position in the stack
 * from one year to the next.
 *
 * @param {object[]} records
 * @param {[number, number]} span
 * @param {(record: object) => string} seriesOf
 * @param {string[]} order
 * @returns {{year: number, total: number, segments: {key: string, count: number}[]}[]}
 */
export function stackedYearSeries(records, [from, to], seriesOf, order) {
    const byYear = new Map();

    for (const record of records) {
        if (!record.year || record.year < from || record.year > to) {
            continue;
        }
        if (!byYear.has(record.year)) {
            byYear.set(record.year, new Map());
        }
        const counts = byYear.get(record.year);
        const key = seriesOf(record);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const series = [];
    for (let year = from; year <= to; year += 1) {
        const counts = byYear.get(year) ?? new Map();
        series.push({
            year,
            total: [...counts.values()].reduce((sum, count) => sum + count, 0),
            segments: order
                .map(key => ({ key, count: counts.get(key) ?? 0 }))
                .filter(segment => segment.count > 0)
        });
    }

    return series;
}

/**
 * Builds the co-authorship graph: who has published with whom.
 *
 * Only authors that share at least one publication appear. Most of the register
 * is single-authored, so including everyone would bury the collaborations under
 * several hundred isolated dots.
 *
 * A pair is accumulated under a joined key, but both names are kept in the map
 * *value* rather than being split back out of the key — names contain spaces,
 * commas and dots, so any separator picked for the key would eventually cut one
 * of them in the wrong place.
 *
 * Fresh node and link objects are returned on every call because d3's force
 * simulation mutates them in place: it replaces each link's `source`/`target`
 * id with the node object and writes positions onto the nodes.
 *
 * @returns {{nodes: {id: string, count: number}[],
 *            links: {source: string, target: string, weight: number}[]}}
 */
export function coauthorGraph(records, { minPublications = 1 } = {}) {
    const published = new Map();
    const pairs = new Map();

    for (const record of records) {
        const authors = [...new Set(record.authors ?? [])];

        for (const author of authors) {
            published.set(author, (published.get(author) ?? 0) + 1);
        }

        for (let i = 0; i < authors.length; i += 1) {
            for (let j = i + 1; j < authors.length; j += 1) {
                const [source, target] = [authors[i], authors[j]].sort();
                const key = `${source}||${target}`;
                const pair = pairs.get(key);

                if (pair) {
                    pair.weight += 1;
                } else {
                    pairs.set(key, { source, target, weight: 1 });
                }
            }
        }
    }

    const links = [];
    const connected = new Set();

    for (const { source, target, weight } of pairs.values()) {
        if (published.get(source) < minPublications || published.get(target) < minPublications) {
            continue;
        }
        links.push({ source, target, weight });
        connected.add(source);
        connected.add(target);
    }

    const nodes = [...connected]
        .map(id => ({ id, count: published.get(id) }))
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

    return { nodes, links };
}
