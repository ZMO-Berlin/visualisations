# ZMO Word Cloud

An interactive word cloud of the most frequent terms in the research-unit
descriptions of the [Leibniz-Zentrum Moderner Orient (ZMO)](https://www.zmo.de/).

Pick a research unit (or view all of them combined), adjust how many words to
show, hover a word to see its frequency, and export the result as a PNG.
Available in English and French.

- **Live pages:** `units_wordcloud/en/` and `units_wordcloud/fr/`
- **No build step.** The front end is plain ES modules, loaded directly by the
  browser. There is no bundler, no `package.json`, and no `npm install`.

---

## Repository layout

```
data_prep/                   Offline data pipeline (Python)
  generate_word_data.py      Text -> word-frequency JSON
  raw_data/                  One .txt file per research unit (pipeline input)

units_wordcloud/             The web app (static; this is what gets deployed)
  index.html                 Language-detecting redirect
  en/index.html              English entry point
  fr/index.html              French entry point
  data/                      Generated frequency JSON (pipeline output)
  src/
    main.js                  Composition root: builds and wires everything
    config/ConfigManager.js   All tunable settings
    store/AppStore.js         Application state + the one action that does I/O
    services/                 Data fetching and preparation
    events/                   Event bus, event names, middleware
    components/               UI: menu, controls, word list, tooltip
      wordcloud/              Cloud view: layout and SVG rendering
    utils/                    Styling, sizing, export, i18n helpers
    styles/                   CSS, one module per concern
    assets/fonts/Muli.ttf     Webfont (also embedded into PNG exports)

requirements.txt             Python dependencies for the pipeline only
```

---

## Running locally

The app uses ES modules and `fetch`, so it must be served over HTTP —
opening `index.html` from the filesystem will not work.

```bash
python -m http.server 8000 --directory units_wordcloud
```

Then open <http://localhost:8000/>. Any static file server works equally well.

### URL parameters

Both language pages accept two optional parameters, useful for embedding a
specific view in an iframe:

| Parameter | Values | Effect |
| --------- | ------ | ------ |
| `unit` | `combined`, `State_Society`, `Lives_Ecologies`, `Religion-Intellectual-Culture` | Preselects a research unit |
| `count` | `10`–`100` | Preselects the number of words |
| `debug` | present | Logs every application event to the console |

Example: `/en/?unit=State_Society&count=40`

Unknown values are ignored and out-of-range counts are clamped, so a bad link
still renders a usable page.

---

## Regenerating the data

The word frequencies are produced offline and committed, so the deployed site
needs no server-side processing.

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate elsewhere
pip install -r requirements.txt
python data_prep/generate_word_data.py
```

The script reads every `.txt` file in `data_prep/raw_data/`, and for each one
writes `units_wordcloud/data/<Name>_word_frequencies.json` — that is, straight
into the directory the app loads from, under the exact filename it expects. It
also writes `combined_word_frequencies.json` aggregating every source file.

Processing per file: lowercase, tokenise, drop stopwords (NLTK's English list
plus a project-specific list of terms common to every unit), drop non-alphabetic
and very short tokens, lemmatise, then keep the most frequent terms.

Useful options (`--help` lists them all):

```bash
python data_prep/generate_word_data.py --top-n 150
python data_prep/generate_word_data.py --exclude Workshop
python data_prep/generate_word_data.py --output-dir /tmp/preview
```

> **Note on `combined`.** By default every `.txt` file in `raw_data/`
> contributes to `combined_word_frequencies.json`, including `Workshop.txt`,
> which is not one of the three research units offered in the UI. Pass
> `--exclude Workshop` if the combined view should cover research units only.

### NLTK corpora

The script downloads what it needs on first run. NLTK 3.9 replaced the pickled
`punkt` model with the `punkt_tab` tables and made `word_tokenize` require the
latter, so both are requested; a run that fetches only `punkt` fails with
`LookupError: Resource 'punkt_tab' not found`.

---

## Adding a research unit

1. Put the unit's text in `data_prep/raw_data/<Unit_Name>.txt`.
2. Run the generator. It writes `units_wordcloud/data/<Unit_Name>_word_frequencies.json`.
3. Add the unit to `groups.items` in
   [`units_wordcloud/src/config/ConfigManager.js`](units_wordcloud/src/config/ConfigManager.js):

   ```js
   { value: 'Unit_Name', label: 'Human readable label' }
   ```

   `value` must match the filename stem exactly — it is what builds the data URL.

Step 3 is required: generating a file is not enough for the unit to appear in
the dropdown.

---

## Architecture

State flows one way. Controls dispatch actions to the store; the store performs
I/O and publishes new state; views re-render from it. Nothing reads the DOM to
discover application state.

```
UnitSelector / WordCountSlider
        │  (action)
        ▼
     AppStore ──► WordCloudService ──► fetch + DataProcessor
        │                                    (clean, rank, normalise)
        │  (subscription)
        ├──────────────► WordCloud ──► LayoutManager (d3-cloud) ──► Renderer (SVG)
        └──────────────► WordList
```

**Dependencies are injected.** [`main.js`](units_wordcloud/src/main.js) is the
only place that constructs anything; every other module receives what it needs
through its constructor. There are no singletons and no global lookups, so any
piece can be instantiated in isolation.

**The event bus is for cross-component signals only** — word hover, word click,
data loading, save requests, errors. Coordination *within* a component is done
with direct calls, which keeps the redraw path readable.

> The bus currently has **publishers but no subscribers**: the app itself is
> wired with direct calls and store subscriptions, so the ~15 `emit()` sites
> exist purely as an extension point for embedding code that wants to observe
> the cloud. Payloads are still validated on every emit, so anything that
> subscribes later gets well-formed data. If that extension point is not
> wanted, the bus, its middleware and the `emit()` calls can all be removed
> without touching behaviour.

**Deployment path is derived, not configured.** `main.js` resolves the app root
from `import.meta.url`, so the same files work from a local server, a user site,
or a project page at any path, with no per-environment configuration.

### Third-party code

[d3](https://d3js.org/) and [d3-cloud](https://github.com/jasondavies/d3-cloud)
are loaded from jsDelivr, pinned to exact versions and protected with
subresource-integrity hashes. Everything else is first-party.

---

## Browser support

Targets current evergreen browsers. Uses ES modules, `ResizeObserver`,
`Element.replaceChildren`, optional chaining and logical assignment. No
transpilation or polyfills are applied.

---

## License

No license has been declared for this repository yet. The bundled Muli typeface
is licensed separately under the SIL Open Font License.
