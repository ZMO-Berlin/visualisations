/**
 * Turns raw frequency files into the shape the layout and word list expect.
 *
 * Each output word carries:
 *   - `text`          cleaned label
 *   - `originalSize`  raw frequency, shown in the tooltip and word list
 *   - `size`          the same frequency, which is what the font scale reads
 *   - `rank`          1-based position by descending frequency
 *
 * `size` used to be the frequency stretched onto a fixed [10, 100] range before
 * `WordStyler` scaled it again. Two mappings, neither aware of the other, and
 * the first threw away the very thing the second needed: because it pinned the
 * rarest word to 10 and the commonest to 100 whatever the data did, the drawn
 * range was always 10:1. The combined register spans 4:1 — 56 occurrences to
 * 14 — so two words towered over a field of specks, and the size differences a
 * reader was reading were mostly an artefact of the stretch. The frequency is
 * now passed through untouched and mapped to pixels once, in one place.
 */
export class DataProcessor {
    /**
     * @param {object} deps
     * @param {import('../config/ConfigManager.js').ConfigManager} deps.config
     */
    constructor({ config }) {
        this.config = config;
    }

    /** Strips stray quote characters left over from the source texts. */
    static cleanWord(word) {
        return String(word).replace(/['’‘]/g, '').trim();
    }

    /**
     * Accepts either a flat array of words (the format produced by
     * `generate_word_data.py`) or an object keyed by unit name, in which case
     * per-unit entries are summed and their origins recorded on `units`.
     */
    static mergeGroups(data) {
        if (Array.isArray(data)) {
            return data;
        }

        const wordMap = new Map();

        Object.entries(data).forEach(([unitName, unitWords]) => {
            if (!Array.isArray(unitWords)) {
                console.warn(`DataProcessor: expected an array for unit "${unitName}", got ${typeof unitWords}`);
                return;
            }

            unitWords.forEach(({ text, size }) => {
                const existing = wordMap.get(text);
                if (existing) {
                    existing.size += size;
                    if (!existing.units.includes(unitName)) {
                        existing.units.push(unitName);
                    }
                } else {
                    wordMap.set(text, { text, size, units: [unitName] });
                }
            });
        });

        return Array.from(wordMap.values());
    }

    /**
     * @param {Array<{text: string, size: number}>} words
     * @param {number} wordCount Maximum number of words to keep.
     */
    process(words, wordCount) {
        const cleaned = words
            .map(word => ({ ...word, text: DataProcessor.cleanWord(word.text) }))
            .filter(word => word.text.length > 0 && Number.isFinite(word.size))
            .sort((a, b) => b.size - a.size)
            .slice(0, wordCount);

        return cleaned.map((word, index) => ({
            ...word,
            originalSize: word.size,
            rank: index + 1
        }));
    }
}
