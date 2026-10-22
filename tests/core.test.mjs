import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilters, indexForSearch, applyFilters, accessOf, countActive } from '../publications_dashboard/src/store/filters.js';
import { decodeFilters, encodeFilters } from '../publications_dashboard/src/store/url.js';
import { AppStore } from '../publications_dashboard/src/store/AppStore.js';
import { coauthorGraph, stackedYearSeries } from '../publications_dashboard/src/utils/aggregate.js';
import { validateDataset } from '../publications_dashboard/src/utils/contracts.js';
import { csv } from '../shared/download.js';
import { bindLifecycle } from '../shared/state-url.js';
import { WordCloudLayoutManager } from '../units_wordcloud/src/components/wordcloud/LayoutManager.js';

const records = indexForSearch([
    { slug:'a', url:'https://example.org/a', title:'Écologies', authors:['A','B'], year:2020, type:'Article' },
    { slug:'b', url:'https://example.org/b', title:'History', authors:['A'], year:2021, type:'Book' },
    { slug:'c', url:'https://example.org/c', title:'Undated', authors:['C'] }
]);
test('filters combine OR within dimensions and AND across dimensions', () => {
    const f = createFilters(); f.author = new Set(['A','C']); f.type.add('Article');
    assert.deepEqual(applyFilters(records,f).map(r=>r.slug), ['a']);
    assert.equal(applyFilters(records,f,{except:'type'}).length,3);
    f.search='ecologies'; assert.equal(applyFilters(records,f).length,1);
});
test('year range excludes undated records; untyped remains selectable', () => {
    const f=createFilters(); f.years=[2020,2021]; assert.equal(applyFilters(records,f).length,2);
    f.years=null; f.type.add(''); assert.equal(applyFilters(records,f)[0].slug,'c');
});
test('URL round trip preserves unicode, delimiters, and empty type', () => {
    const f=createFilters(); f.author.add('Müller, A & B'); f.venue.add('journal:Title: subtitle'); f.type.add(''); f.years=[2020,2021]; f.search='a+b';
    assert.deepEqual(decodeFilters(new URLSearchParams(encodeFilters(f))),f);
    assert.equal(decodeFilters('?from=NaN&to=2020&venue=invalid').years,null);
    assert.equal(decodeFilters('?venue=invalid').venue.size,0);
});
test('atomic selection emits once and retains unrelated selectors', () => {
    const store=new AppStore({settings:{},service:{}}); store.state.publications=records;
    const before=store.select('author'); let calls=0; store.subscribe(()=>calls++);
    store.choose('author','A'); assert.equal(calls,1); assert.equal(store.select('author'),before);
    assert.equal(store.select().length,2);
});
test('destroyed store ignores late fetch completion', async () => {
    let resolve; const service={load:()=>new Promise(r=>resolve=r)};
    const store=new AppStore({settings:{},service}); const pending=store.load(); store.destroy();
    resolve({publications:records,meta:{}}); await pending; assert.equal(store.state.status,'loading');
});
test('graph deduplicates author cells and counts actual shared publications', () => {
    const graph=coauthorGraph([...records,{authors:['A','A','B']}]);
    assert.equal(graph.links.length,1); assert.equal(graph.links[0].weight,2);
});
test('timeline retains empty years and series counts', () => {
    const result=stackedYearSeries(records,[2019,2021],r=>r.type,['Article','Book']);
    assert.deepEqual(result.map(r=>r.total),[0,1,1]);
});
test('contract rejects unsafe URLs, duplicate IDs and malformed authors', () => {
    const meta={schemaVersion:2,source:'https://example.org',counts:{publications:3}};
    assert.throws(()=>validateDataset(records,{...meta,schemaVersion:1}));
    assert.equal(validateDataset(records,meta).publications,records);
    assert.throws(()=>validateDataset([{...records[0],url:'javascript:alert(1)'}],meta));
    assert.throws(()=>validateDataset([{...records[0],authors:'A'}],meta));
    assert.throws(()=>validateDataset([records[0],records[0]],meta));
});
test('CSV quotes data and neutralizes formulas', () => {
    assert.match(csv([['=HYPERLINK("bad")','line\nbreak']]), /'=/);
    assert.match(csv([['a"b']]), /a""b/);
});
test('lifecycle suspends persisted pages and only destroys on actual exit', () => {
    const listeners=new Map(); let destroyed=0,suspended=0,resumed=0;
    globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
    bindLifecycle({destroy:()=>destroyed++,suspend:()=>suspended++,resume:()=>resumed++});
    listeners.get('pagehide')({persisted:true}); listeners.get('pageshow')({persisted:true});
    assert.deepEqual([destroyed,suspended,resumed],[0,1,1]);
    listeners.get('pagehide')({persisted:false}); assert.equal(destroyed,1); assert.equal(listeners.size,0);
    delete globalThis.window;
});
test('cancelled cloud layouts settle and same input receives a deterministic seed', async () => {
    let callback; const randoms=[];
    const layout={size(){return this},padding(){return this},font(){return this},canvas(){return this},rotate(){return this},stop(){},random(fn){randoms.push(fn());return this},words(){return this},fontSize(){return this},on(event,fn){callback=fn;return this},start(){return this}};
    const config={get:()=>({width:100,height:100}),getLayoutOptions:()=>({padding:1}),getFontConfig:()=>({family:'serif'})};
    const manager=new WordCloudLayoutManager({config,wordStyler:{createSizer:()=>()=>10},cloudFactory:()=>layout});
    const first=manager.layoutWords([{text:'history',size:5}]);
    const second=manager.layoutWords([{text:'history',size:5}]);
    assert.equal(await first,null); assert.equal(randoms[0],randoms[1]);
    callback([{text:'history'}]); assert.equal((await second).length,1); manager.destroy();
});


test('graph identity changes for different edge endpoints, weights or node counts', async () => {
    const { graphSignature } = await import('../publications_dashboard/src/utils/graph-signature.js');
    const nodes = [{id:'a',count:2},{id:'b',count:2},{id:'c',count:2}];
    const first = graphSignature(nodes, [{source:'a',target:'b',weight:1}], 3);
    assert.notEqual(first, graphSignature(nodes, [{source:'a',target:'c',weight:1}], 3));
    assert.notEqual(first, graphSignature(nodes, [{source:'a',target:'b',weight:2}], 3));
    assert.notEqual(first, graphSignature([{id:'a',count:3},...nodes.slice(1)], [{source:'a',target:'b',weight:1}], 3));
});


test('new analytical datasets validate source links and count denominators', async () => {
    const { validateVocabulary, validateFamilies } = await import('../shared/data-contracts.js');
    const { readFile } = await import('node:fs/promises');
    const vocabulary = JSON.parse(await readFile(new URL('../units_wordcloud/data/vocabulary.json', import.meta.url)));
    const families = JSON.parse(await readFile(new URL('../publications_dashboard/data/families.json', import.meta.url)));
    assert.equal(validateVocabulary(vocabulary), vocabulary);
    assert.equal(validateFamilies(families), families);
    assert.throws(() => validateVocabulary({...vocabulary, units: [{...vocabulary.units[0], tokens:0}]}));
    assert.throws(() => validateFamilies([{parent:{slug:'bad',title:'Bad',url:'javascript:alert(1)'},children:[]}]));
});


test('functional secondary text clears 4.5:1 on its supported surfaces', async () => {
    const { readFile } = await import('node:fs/promises');
    const css = await readFile(new URL('../shared/tokens.css', import.meta.url), 'utf8');
    const value = token => css.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'i'))[1];
    const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v,16)/255)
        .map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
        .reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
    for (const ink of ['--c-ink-soft','--c-ink-faint']) for (const surface of ['--c-page','--c-surface','--c-surface-sunk','--c-brand-tint']) {
        const ratio = (luminance(value(surface))+.05)/(luminance(value(ink))+.05);
        assert.ok(ratio >= 4.5, `${ink} on ${surface}: ${ratio}`);
    }
});


test('theme, language and access filters combine with the others and exclude themselves', () => {
    const enriched = indexForSearch([
        { slug:'x', url:'https://example.org/x', title:'Swahili poetry', theme:'t04', lang:'en', oa:'gold', year:2020 },
        { slug:'y', url:'https://example.org/y', title:'Dichtung', theme:'t04', lang:'de', oa:'closed', year:2021 },
        { slug:'z', url:'https://example.org/z', title:'Untitled', year:2022 }
    ], { themes:[{ id:'t04', label:{ en:'Swahili and West African cultures', de:'Swahili-Kulturen' } }] });
    assert.deepEqual(enriched.map(accessOf), ['open', 'closed', 'unknown']);
    const f = createFilters(); f.theme.add('t04'); f.lang.add('und'); f.lang.add('de');
    assert.deepEqual(applyFilters(enriched, f).map(r => r.slug), ['y']);
    assert.equal(applyFilters(enriched, f, { except:'lang' }).length, 2);
    f.lang.clear(); f.access.add('unknown');
    assert.equal(applyFilters(enriched, f).length, 0);
    assert.equal(countActive(f), 2);
    // A theme's label is searchable in both languages.
    const g = createFilters(); g.search = 'swahili-kulturen';
    assert.deepEqual(applyFilters(enriched, g).map(r => r.slug), ['x', 'y']);
});

test('URL round trip covers the new dimensions and drops malformed values', () => {
    const f = createFilters(); f.theme.add('t07'); f.lang.add('und'); f.access.add('open');
    assert.deepEqual(decodeFilters(new URLSearchParams(encodeFilters(f))), f);
    const bad = decodeFilters('?theme=7&theme=t07&lang=English&access=free');
    assert.deepEqual([...bad.theme], ['t07']);
    assert.equal(bad.lang.size + bad.access.size, 0);
});

test('companion files validate against the committed dataset and refuse another', async () => {
    const { validateThemes, validateOpenAlex, validatePeople } = await import('../publications_dashboard/src/utils/contracts.js');
    const { readFile } = await import('node:fs/promises');
    const read = async name => JSON.parse(await readFile(new URL(`../publications_dashboard/data/${name}`, import.meta.url)));
    const [meta, publications, themes, openalex, people] = await Promise.all(
        ['meta.json', 'publications.json', 'themes.json', 'openalex.json', 'people.json'].map(read));
    assert.equal(validateDataset(publications, meta).meta, meta);
    assert.equal(validateThemes(themes, meta, publications.length), themes);
    assert.equal(validateOpenAlex(openalex, meta, publications.length), openalex);
    assert.equal(validatePeople(people), people);
    const other = { ...meta, datasetId: 'another' };
    assert.throws(() => validateThemes(themes, other, publications.length));
    assert.throws(() => validateOpenAlex(openalex, other, publications.length));
    assert.throws(() => validateThemes(themes, meta, publications.length - 1));
    assert.throws(() => validatePeople({ 'Doe, Jane': { url: 'https://example.org/jane', current: true } }));
    // Every record's theme is one the themes file names, and every label is attributed.
    const ids = new Set(themes.themes.map(t => t.id));
    assert.ok(publications.every(r => !r.theme || ids.has(r.theme)));
    assert.match(themes.attribution.labels.author, /Claude Opus 5\.5/);
});

test('open-access status is never inferred for unmatched records', () => {
    assert.equal(accessOf({}), 'unknown');
    assert.equal(accessOf({ oa: 'closed' }), 'closed');
    assert.equal(accessOf({ oa: 'diamond' }), 'open');
});

test('region, place and subject filters use derived regions and exclude themselves', () => {
    const recs = indexForSearch([
        { slug:'a', url:'https://example.org/a', title:'One', places:['Q858','Q43'], $regions:['middle-east'], gnd:['4027743-2'] },
        { slug:'b', url:'https://example.org/b', title:'Two', places:['Q668'], $regions:['south-asia'] },
        { slug:'c', url:'https://example.org/c', title:'Three' }
    ], null, { places:[{ id:'Q858', label:{ en:'Syria', de:'Syrien' } }] }, { headings:{ '4027743-2':{ label:'Islam' } } });
    const f = createFilters(); f.region.add('middle-east');
    assert.deepEqual(applyFilters(recs, f).map(r => r.slug), ['a']);
    f.region.clear(); f.place.add('Q668');
    assert.deepEqual(applyFilters(recs, f).map(r => r.slug), ['b']);
    assert.equal(applyFilters(recs, f, { except:'place' }).length, 3);
    const g = createFilters(); g.gnd.add('4027743-2');
    assert.deepEqual(applyFilters(recs, g).map(r => r.slug), ['a']);
    // Place names and subject headings are searchable in both languages.
    const h = createFilters(); h.search = 'syrien';
    assert.deepEqual(applyFilters(recs, h).map(r => r.slug), ['a']);
    h.search = 'islam';
    assert.deepEqual(applyFilters(recs, h).map(r => r.slug), ['a']);
});

test('URL keys for regions, places and subject headings validate their values', () => {
    const f = createFilters(); f.region.add('north-africa'); f.place.add('Q858'); f.gnd.add('4027743-2');
    assert.deepEqual(decodeFilters(new URLSearchParams(encodeFilters(f))), f);
    const bad = decodeFilters('?region=North%20Africa&place=Syria&gnd=Islam');
    assert.equal(bad.region.size + bad.place.size + bad.gnd.size, 0);
});

test('regions and subjects files validate against the committed dataset', async () => {
    const { validateRegions, validateSubjects } = await import('../publications_dashboard/src/utils/contracts.js');
    const { readFile } = await import('node:fs/promises');
    const read = async name => JSON.parse(await readFile(new URL(`../publications_dashboard/data/${name}`, import.meta.url)));
    const [meta, publications, regions, subjects] = await Promise.all(['meta.json', 'publications.json', 'regions.json', 'subjects.json'].map(read));
    assert.equal(validateRegions(regions, meta), regions);
    assert.equal(validateSubjects(subjects, meta), subjects);
    assert.throws(() => validateRegions(regions, { ...meta, datasetId: 'another' }));
    const known = new Set(regions.places.map(p => p.id));
    assert.ok(publications.every(r => (r.places ?? []).every(id => known.has(id))));
    assert.ok(publications.every(r => (r.gnd ?? []).every(id => id in subjects.headings)));
    // Only the eight palette regions have a colour; the transregional group has none.
    assert.equal(regions.macros.filter(m => m.slot).length, 8);
    // Continents and world regions have no single location and are never drawn.
    assert.ok(regions.places.every(p => !p.coord || !['continent', 'world'].includes(p.kind)));
});
