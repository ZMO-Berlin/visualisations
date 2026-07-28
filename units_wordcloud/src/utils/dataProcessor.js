/**
 * Turns raw frequency files into the shape the layout and word list expect.
 *
 * Each output word carries:
 *   - `text`          cleaned label
 *   - `originalSize`  raw frequency, shown in the tooltip and word list
 *   - `size`          frequency normalised into [min, max] for font scaling
 *   - `rank`          1-based position by descending frequency
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
     * Maps a raw frequency onto the configured font-size range.
     *
     * When every word shares the same frequency the range collapses; falling
     * back to the midpoint avoids a division by zero that would otherwise
     * propagate NaN into every font size and blank the cloud.
     */
    normalizeSize(size, minSize, maxSize) {
        const { min, max } = this.config.get('data.normalizedSize');
        if (maxSize === minSize) {
            return (min + max) / 2;
        }
        return min + ((size - minSize) * (max - min)) / (maxSize - minSize);
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

        if (cleaned.length === 0) {
            return [];
        }

        // reduce() rather than Math.min(...arr): spreading a large array can
        // overflow the call stack.
        const sizes = cleaned.map(word => word.size);
        const minSize = sizes.reduce((a, b) => Math.min(a, b), Infinity);
        const maxSize = sizes.reduce((a, b) => Math.max(a, b), -Infinity);

        return cleaned.map((word, index) => ({
            ...word,
            originalSize: word.size,
            size: this.normalizeSize(word.size, minSize, maxSize),
            rank: index + 1
        }));
    }
}
