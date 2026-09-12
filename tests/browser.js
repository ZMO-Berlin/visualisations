import { el, replaceContent } from '../shared/dom.js';
import { timelineSVG } from '../shared/chart-export.js';
import { bindLifecycle } from '../shared/state-url.js';
const results = document.getElementById('results');
const fixture = document.getElementById('fixture');
let failures = 0;
function assert(value, message) { if (!value) throw new Error(message); }
async function test(name, run) {
    try { await run(); results.append(el('li', { text: `PASS: ${name}` })); }
    catch (error) { failures++; results.append(el('li', { text: `FAIL: ${name}: ${error.message}` })); }
}
await test('Replacing chart rows retains keyboard focus by stable key', () => {
    const row = key => el('button', { dataset: { key }, text: key });
    fixture.replaceChildren(row('a'), row('b')); fixture.lastChild.focus();
    replaceContent(fixture, row('b'), row('a'));
    assert(document.activeElement.dataset.key === 'b', 'Focus moved away from selected row');
    replaceContent(fixture, row('c'));
    assert(document.activeElement.dataset.key === 'c', 'No neighboring focus fallback');
});
await test('Comparison intensity is serialized as a CSS custom property', () => {
    const cell = el('div', { style: { '--share': '50%' } });
    assert(cell.style.getPropertyValue('--share') === '50%', 'Missing intensity');
});
await test('SVG export preserves full scope, counts, source and locale and rasterizes', async () => {
    const scope = 'author: Example '.repeat(30);
    const xml = timelineSVG([{year:2025,total:7},{year:2026,total:3}], { title:'Publikationen', source:'https://www.zmo.de/', datasetId:'fixture', scope, locale:'de' });
    const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
    assert(!doc.querySelector('parsererror'), 'Invalid SVG');
    assert(doc.querySelector('desc').textContent.includes(scope), 'Scope truncated');
    assert(doc.documentElement.textContent.includes('Quelle:'), 'Wrong locale');
    assert(doc.documentElement.textContent.includes('7'), 'Count omitted');
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = `data:image/svg+xml,${encodeURIComponent(xml)}`; });
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image,0,0);
    assert(canvas.toDataURL('image/png').startsWith('data:image/png;base64,'), 'PNG unavailable');
});
await test('Persisted page lifecycle suspends and resumes before final disposal', () => {
    const calls = [];
    bindLifecycle({suspend:()=>calls.push('suspend'),resume:()=>calls.push('resume'),destroy:()=>calls.push('destroy')});
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));
    assert(calls.join(',') === 'suspend,resume,destroy', calls.join(','));
});
await test('Word explorer restores comparison URL before initial resize notifications', async () => {
    const frame = el('iframe', { title: 'Word URL regression', src: '../units_wordcloud/en/?unit=combined&count=25&view=compare&find=history&sort=distinctive' });
    fixture.append(frame);
    await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => { clearInterval(check); reject(new Error('Comparison did not load')); }, 20000);
        const check = setInterval(() => {
            if (!frame.contentDocument?.querySelector('.explore-table tbody tr')) return;
            clearInterval(check); clearTimeout(deadline); resolve();
        }, 100);
    });
    const params = new URLSearchParams(frame.contentWindow.location.search);
    assert(params.get('view') === 'compare' && params.get('find') === 'history' && params.get('sort') === 'distinctive', 'Initial URL was overwritten');
    assert(frame.contentDocument.querySelector('input[type="search"]').value === 'history', 'Search was not restored');
    frame.remove();
});
await test('Missing cloud scripts retain exact counts and keyboard term controls', async () => {
    const frame = el('iframe', { title: 'Cloud fallback regression', src: './cloud-fallback.html' });
    fixture.append(frame);
    await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => { clearInterval(check); reject(new Error('Fallback did not load')); }, 20000);
        const check = setInterval(() => {
            if (!frame.contentDocument?.querySelector('.word-list-item')) return;
            clearInterval(check); clearTimeout(deadline); resolve();
        }, 100);
    });
    assert(frame.contentDocument.body.dataset.view === 'list', 'Exact-count view not selected');
    assert(frame.contentDocument.querySelector('.word-list-item').tagName === 'BUTTON', 'Terms are not keyboard controls');
    frame.remove();
});
fixture.replaceChildren();
document.getElementById('status').textContent = failures ? `${failures} checks failed` : 'All 6 browser checks passed';
