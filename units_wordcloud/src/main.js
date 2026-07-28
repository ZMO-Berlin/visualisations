import { ConfigManager } from './config/ConfigManager.js';
import { EventBus } from './events/EventBus.js';
import { ErrorManager } from './utils/ErrorManager.js';
import { AppStore } from './store/AppStore.js';
import { WordCloudService } from './services/WordCloudService.js';
import { SaveManager } from './utils/saveUtils.js';
import { WordCloud } from './components/wordcloud/WordCloud.js';
import { WordList } from './components/WordList.js';
import { Menu } from './components/Menu.js';
import { createLoggerMiddleware } from './events/middleware/LoggerMiddleware.js';
import { ValidationMiddleware } from './events/middleware/ValidationMiddleware.js';

/**
 * Application root: the single place where dependencies are constructed and
 * wired together. Every other module receives what it needs through its
 * constructor, so nothing reaches for a global or a singleton.
 */

/**
 * Resolves the app root from this module's own URL.
 *
 * `main.js` lives at `<root>/src/main.js`, so one level up is the app root.
 * Deriving it this way means the same build works from a local server, a user
 * site, or a project page under any path — the pages previously had to sniff
 * for `github.io` and hard-code `/ZMO/units_wordcloud`, which broke on a rename
 * and needed duplicating in every HTML entry point.
 */
function resolveBasePath() {
    return new URL('../', import.meta.url).href.replace(/\/$/, '');
}

/** Reads and sanitises `?unit=` and `?count=`. */
function getUrlParams(config) {
    const params = new URLSearchParams(window.location.search);

    const unitParam = params.get('unit');
    const knownUnits = config.getUnits().map(unit => unit.value);
    const unit = knownUnits.includes(unitParam) ? unitParam : null;

    const parsedCount = parseInt(params.get('count') ?? '', 10);
    const count = Number.isFinite(parsedCount)
        ? Math.min(Math.max(parsedCount, config.get('data.minWords')), config.get('data.maxWords'))
        : null;

    return { unit, count };
}

function bootstrap() {
    const basePath = resolveBasePath();

    const config = new ConfigManager({
        paths: { basePath },
        debug: new URLSearchParams(window.location.search).has('debug')
    });

    const errorManager = new ErrorManager();
    const eventBus = new EventBus({ errorManager });

    eventBus
        .use(createLoggerMiddleware({ enabled: config.get('debug') }))
        .use(ValidationMiddleware);

    const wordCloudService = new WordCloudService({ config, eventBus });
    const store = new AppStore({ config, eventBus, errorManager, wordCloudService });
    const saveManager = new SaveManager({
        config,
        fontUrl: `${basePath}/src/assets/fonts/Muli.ttf`
    });

    const wordCloud = new WordCloud('#wordcloud', { config, store, eventBus });
    const wordList = new WordList('wordlist', { config });
    const menu = new Menu('controls', { config, store, eventBus, errorManager, saveManager });

    wordCloud.setWordList(wordList);

    const unsubscribe = store.subscribe((newState, oldState) => {
        if (newState.currentWords !== oldState.currentWords) {
            wordList.updateWords(newState.currentWords);
        }
    });

    const { unit, count } = getUrlParams(config);
    const initialState = store.getState();

    store
        .updateWordCloud(unit ?? initialState.selectedUnit, count ?? initialState.wordCount)
        .catch(() => { /* reported through ErrorManager; the UI shows the store's error state */ });

    // `pagehide` rather than `unload`: `unload` is deprecated, blocks the
    // back/forward cache, and does not fire reliably on mobile Safari.
    window.addEventListener('pagehide', () => {
        unsubscribe();
        menu.destroy();
        wordList.destroy();
        wordCloud.destroy();
        store.destroy();
        eventBus.destroy();
        errorManager.destroy();
    }, { once: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}
