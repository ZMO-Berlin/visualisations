/**
 * Rasterises the word cloud SVG to a PNG download.
 *
 * An SVG serialised into a data URI is rendered by the browser in an isolated
 * context: it cannot reach the page's stylesheets, and it cannot fetch relative
 * font files. The webfont is therefore inlined as a base64 `@font-face` before
 * serialisation, otherwise exported images silently fall back to a system font
 * and no longer match what is on screen.
 */
export class SaveManager {
    /**
     * @param {object} deps
     * @param {import('../config/ConfigManager.js').ConfigManager} deps.config
     * @param {string} deps.fontUrl URL of the webfont to embed.
     */
    constructor({ config, fontUrl }) {
        this.config = config;
        this.fontUrl = fontUrl;
        this.fontFacePromise = null;
    }

    /** Fetches and base64-encodes the webfont once, reusing it thereafter. */
    async getFontFace() {
        if (!this.fontUrl) return '';

        this.fontFacePromise ??= (async () => {
            try {
                const response = await fetch(this.fontUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const buffer = await response.arrayBuffer();
                const bytes = new Uint8Array(buffer);

                // Chunked conversion: String.fromCharCode(...bytes) on a 48 KB
                // buffer risks blowing the argument limit.
                let binary = '';
                const CHUNK = 0x8000;
                for (let i = 0; i < bytes.length; i += CHUNK) {
                    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
                }

                const family = this.config.get('wordcloud.font.family.primary');
                return `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${btoa(binary)}) format('truetype');}`;
            } catch (error) {
                console.warn('[ZMO] could not embed webfont in export; falling back to system fonts', error);
                return '';
            }
        })();

        return this.fontFacePromise;
    }

    /**
     * Serialises `svg` at its configured logical size and triggers a download.
     * @param {SVGElement} svg
     */
    async saveAsPNG(svg) {
        const { scale, filename, format } = this.config.getExportConfig();
        const { width, height } = this.config.get('wordcloud.dimensions');

        const source = await this.serialize(svg, width, height);
        const image = await SaveManager.loadImage(
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
        );

        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;

        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(image, 0, 0, width, height);

        SaveManager.triggerDownload(canvas.toDataURL(`image/${format}`, 1.0), `${filename}.${format}`);
    }

    /**
     * Produces standalone SVG markup: the live node is cloned so the on-screen
     * cloud is never mutated, then given explicit dimensions and an inline font.
     */
    async serialize(svg, width, height) {
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        clone.setAttribute('width', width);
        clone.setAttribute('height', height);

        if (!clone.getAttribute('viewBox')) {
            clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
        }

        const fontFace = await this.getFontFace();
        if (fontFace) {
            const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            style.textContent = fontFace;
            clone.insertBefore(style, clone.firstChild);
        }

        return `<?xml version="1.0" standalone="no"?>\n${new XMLSerializer().serializeToString(clone)}`;
    }

    static loadImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Failed to rasterise the word cloud SVG'));
            image.src = src;
        });
    }

    static triggerDownload(href, filename) {
        const link = document.createElement('a');
        link.download = filename;
        link.href = href;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }
}
