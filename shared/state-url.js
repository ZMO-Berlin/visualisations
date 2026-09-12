/** URL changes preserve unrelated parameters and keep language links in sync. */
export function writeParams(values, keys, { push = false } = {}) {
    const url = new URL(location.href);
    for (const key of keys) url.searchParams.delete(key);
    for (const [key, value] of values) url.searchParams.append(key, value);
    if (url.href !== location.href) history[push ? 'pushState' : 'replaceState'](null, '', url);
    syncLanguageLink();
}

export function syncLanguageLink() {
    for (const link of document.querySelectorAll('.site-bar__lang')) {
        const url = new URL(link.href);
        url.search = location.search;
        url.hash = location.hash;
        link.href = url.href;
    }
}

export function bindLifecycle({ destroy, suspend = () => {}, resume = () => {} }) {
    const hide = event => {
        if (event.persisted) suspend();
        else {
            window.removeEventListener('pagehide', hide);
            window.removeEventListener('pageshow', show);
            destroy();
        }
    };
    const show = event => { if (event.persisted) resume(); };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
}
