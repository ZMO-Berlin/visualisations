import { svg } from './dom.js';
import { download } from './download.js';

/** Export the actual selected counts with source and dataset identity. */
export function timelineSVG(rows, { title, source, datasetId, scope, locale = 'en' }) {
    const scopeLines = scope.match(/.{1,105}(?:\s|$)|.{1,105}/g) ?? [''];
    const width = 1200, height = 650 + (scopeLines.length - 1) * 20, left = 70, bottom = 470 + (scopeLines.length - 1) * 20, plotHeight = 320;
    const root = svg('svg', { xmlns: 'http://www.w3.org/2000/svg', width, height, viewBox: `0 0 ${width} ${height}` });
    root.append(svg('rect', { width, height, fill: '#ffffff' }),
        svg('text', { x: left, y: 52, 'font-size': 30, 'font-family': 'Georgia,serif', fill: '#142748', text: title }),
        ...scopeLines.map((text, i) => svg('text', { x: left, y: 92 + i * 20, 'font-size': 15, fill: '#4a5058', text })));
    root.append(svg('title', { text: title }), svg('desc', { text: `${scope}. ${source}. Dataset ${datasetId}.` }));
    const max = Math.max(1, ...rows.map(row => row.total));
    const step = (width - 2 * left) / Math.max(rows.length, 1);
    for (const [i, row] of rows.entries()) {
        const size = row.total / max * plotHeight;
        root.append(svg('rect', { x: left + i * step, y: bottom - size, width: Math.max(1, step - 3), height: size, fill: '#2a4f8c' }),
            svg('text', { x: left + (i + 0.5) * step, y: bottom - size - 7, 'text-anchor': 'middle', 'font-size': 12, text: row.total }));
        if (i === 0 || i === rows.length - 1 || row.year % 5 === 0 && i > 1 && i < rows.length - 2) {
            root.append(svg('text', { x: left + (i + 0.5) * step, y: bottom + 25, 'text-anchor': 'middle', 'font-size': 14, text: row.year }));
        }
    }
    for (const [i, text] of [`${locale === 'de' ? 'Quelle' : 'Source'}: ${source}`, `${locale === 'de' ? 'Datensatz' : 'Dataset'}: ${datasetId}`, locale === 'de' ? 'Nur datierte Registereinträge; das jüngste Jahr kann unvollständig sein.' : 'Dated register records only; the latest year may be incomplete.'].entries()) {
        root.append(svg('text', { x: left, y: bottom + 80 + i * 24, 'font-size': 14, fill: '#4a5058', text }));
    }
    return new XMLSerializer().serializeToString(root);
}

export async function exportTimeline(rows, options, format) {
    const xml = timelineSVG(rows, options);
    if (format === 'svg') return download(xml, 'zmo-publications.svg', 'image/svg+xml');
    const image = new Image();
    await new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = reject;
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    });
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth * 2; canvas.height = image.naturalHeight * 2;
    const context = canvas.getContext('2d'); context.scale(2, 2); context.drawImage(image, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG export failed');
    download(blob, 'zmo-publications.png', 'image/png');
}
