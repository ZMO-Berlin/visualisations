import { ConfigManager } from './config/ConfigManager.js';
import { ErrorManager } from './utils/ErrorManager.js';
import { AppStore } from './store/AppStore.js';
import { WordCloudService } from './services/WordCloudService.js';
import { SaveManager } from './utils/saveUtils.js';
import { WordCloud } from './components/wordcloud/WordCloud.js';
import { WordList } from './components/WordList.js';
import { Menu } from './components/Menu.js';
import { ContextStrip } from './components/ContextStrip.js';
import { Explorer } from './components/Explorer.js';
import { getLocale } from './utils/translations.js';
import { writeParams, bindLifecycle } from '../../shared/state-url.js';
import { el } from '../../shared/dom.js';
import { exploreStrings } from '../../shared/explore-strings.js';

function bootstrap() {
    const config = new ConfigManager({ paths: { basePath: new URL('../', import.meta.url).href.replace(/\/$/, '') } });
    const errorManager = new ErrorManager();
    const service = new WordCloudService({ config });
    const store = new AppStore({ config, errorManager, wordCloudService: service });
    const strings = exploreStrings(getLocale());
    const saveManager = new SaveManager({ config, fontUrl: new URL('../../shared/fonts/Newsreader-normal-latin.woff2', import.meta.url).href });
    const context = new ContextStrip('context', { config, store });
    const wordList = new WordList('wordlist', { config });
    let cloud = null;
    const status = el('div', { class: 'view-status', role: 'status' });
    document.getElementById('controls').after(status);
    try {
        if (window.d3?.layout?.cloud) {
            cloud = new WordCloud('#wordcloud', { config, store });
            cloud.setWordList(wordList);
        }
    } catch (error) { console.error(error); }
    const menu = new Menu('controls', { config, store, errorManager, saveManager });
    // Resize notifications can arrive before fonts and initial URL state load.
    let restoring = true;
    const sync = () => {
        if (restoring) return;
        const state = store.getState();
        writeParams([['unit', state.selectedUnit], ['count', String(state.wordCount)], ['view', explorer.view], ['sort', explorer.sort], ...(explorer.query ? [['find', explorer.query]] : []), ...(explorer.term ? [['term', explorer.term]] : [])], ['unit', 'count', 'view', 'term', 'sort', 'find']);
    };
    const explorer = new Explorer({ store, locale: getLocale(), onChange: sync });
    wordList.onSelectWord = term => explorer.selectTerm(term);
    if (cloud) cloud.renderer.onSelectWord = term => explorer.selectTerm(term);
    const unsubscribe = store.subscribe((state, previous) => {
        if (state.currentWords !== previous.currentWords) wordList.updateWords(state.currentWords);
        status.replaceChildren();
        if (state.error) status.append(strings.loadError, el('button', { type: 'button', text: strings.retry, on: { click: () => store.updateWordCloud(state.selectedUnit, state.wordCount).catch(() => {}) } }));
        else if (!cloud) status.textContent = strings.chartFailed;
        menu.components.saveButton.setBusy(state.isLoading || !cloud);
        sync();
    });
    const restore = () => {
        const params = new URLSearchParams(location.search);
        const unit = config.getUnits().some(u => u.value === params.get('unit')) ? params.get('unit') : service.getDefaultUnit();
        const count = /^\d+$/.test(params.get('count') ?? '') ? Number(params.get('count')) : service.getDefaultWordCount();
        restoring = true;
        explorer.term = (params.get('term') ?? '').slice(0, 100);
        explorer.query = (params.get('find') ?? '').slice(0, 100);
        explorer.search.value = explorer.query;
        explorer.sort = params.get('sort') === 'distinctive' ? 'distinctive' : 'frequent';
        explorer.controls.querySelector('select').value = explorer.sort;
        const view = params.get('view') ?? 'cloud';
        explorer.setView(!cloud && view === 'cloud' ? 'list' : view, false);
        store.updateWordCloud(unit, count).catch(() => {});
        restoring = false;
        sync();
    };
    window.addEventListener('popstate', restore);
    let destroyed = false;
    const family = config.getFontConfig().family;
    (document.fonts?.load(`400 48px ${family}`) ?? Promise.resolve()).catch(() => {}).then(() => { if (!destroyed) restore(); });
    bindLifecycle({
        suspend: () => cloud?.layoutManager.cancel(),
        resume: () => cloud?.scheduleRedraw(),
        destroy: () => {
            destroyed = true; window.removeEventListener('popstate', restore); unsubscribe();
            explorer.destroy(); menu.destroy(); context.destroy(); wordList.destroy(); cloud?.destroy(); store.destroy(); errorManager.destroy();
        }
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
else bootstrap();
