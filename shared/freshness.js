import { el } from './dom.js';

/** Deployment timestamps are separate from content-derived dataset identities. */
export async function showFreshness(kind, container, locale, label) {
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
    try {
        const response = await fetch(new URL('./refresh.json', import.meta.url));
        if (!response.ok) return;
        const data = await response.json();
        if (!data[kind]) return;
        const date = new Date(data[kind]);
        if (!Number.isFinite(date.getTime()) || !container.isConnected) return;
        container.append(el('p', { class: 'explore-hint', text: `${label}: ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)} (UTC)` }));
    } catch { /* Optional provenance must never block the exploration views. */ }
}
