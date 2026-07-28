# ZMO Word Cloud

An interactive word cloud of the most frequent terms in the research-unit
descriptions of the [Leibniz-Zentrum Moderner Orient (ZMO)](https://www.zmo.de/).

Pick a research unit (or view all of them combined), adjust how many words to
show, hover a word to see its frequency, and export the result as a PNG.
Available in English and French.

- **Live pages:** `units_wordcloud/en/` and `units_wordcloud/fr/`
- **No build step.** The front end is plain ES modules, loaded directly by the
  browser. There is no bundler, no `package.json`, and no `npm install`.
- **Data is scraped from [zmo.de](https://www.zmo.de/), not maintained by hand.**
  Two Python scripts fetch each unit's abstract and every project abstract, then
  reduce them to word frequencies. See [Regenerating the data](#regenerating-the-data).

---

## Repository layout

```
data_prep/                   Offline data pipeline (Python)
  scrape_zmo.py              zmo.de -> text
  generate_word_data.py      Text -> word-frequency JSON
  raw_data/                  One .txt file per research unit (pipeline input)
    units.json               Manifest of what the scraper collected

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
needs no server-side processing. There are two stages: fetch the text from
zmo.de, then turn it into frequencies.

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate elsewhere
pip install -r requirements.txt

python data_prep/scrape_zmo.py            # zmo.de   -> data_prep/raw_data/*.txt
python data_prep/generate_word_data.py    # raw_data -> units_wordcloud/data/*.json
```

Run the first stage when the website changes and the second whenever the text
does. Keeping the `.txt` files under version control means a scrape produces a
readable diff of exactly what changed on the site.

### Stage 1 — `scrape_zmo.py`

For each of the three research units this reads the unit's overview page and
collects:

* the unit's title and abstract;
* every project listed under **Research Projects**, following each link to its
  own page for the abstract;
* the inline descriptions of umbrella projects such as MIDA, CRAFTE and
  JUSTIMINO, which are printed on the listing page rather than linked. These are
  easy to miss — extracting only the linked projects silently drops several
  hundred words per unit.

Researcher bylines are dropped so personal names do not become word-cloud terms.
Output is one paragraph per line with blank lines between, matching the format
the files previously maintained by hand used.

```bash
python data_prep/scrape_zmo.py --dry-run                      # report, write nothing
python data_prep/scrape_zmo.py --only lives-and-ecologies     # one unit
python data_prep/scrape_zmo.py --cache-dir /tmp/zmo-html      # reuse downloads
```

The scraper requests one page at a time with a delay between requests and
identifies itself in the `User-Agent`. It **fails loudly** if a page yields no
abstract or no projects: the `bb-*` selectors it relies on come from the site's
TYPO3 theme, so a redesign should produce a visible error rather than a quietly
shrinking word cloud.

Unit slugs and their filenames are listed in `UNITS` at the top of the script.
A filename stem is also the `value` of an entry in `ConfigManager.js` and the
prefix of a file in `units_wordcloud/data/`, so renaming one means changing all
three.

### Stage 2 — `generate_word_data.py`

Reads every `.txt` file in `data_prep/raw_data/`, and for each one writes
`units_wordcloud/data/<Name>_word_frequencies.json` — straight into the
directory the app loads from, under the exact filename it expects. It also
writes `combined_word_frequencies.json`.

Only files listed in `raw_data/units.json` (written by the scraper) feed the
combined aggregate. Text that lives in `raw_data/` without coming from a
research-unit page — `Workshop.txt`, a workshop description written by hand —
still gets its own frequency file but stays out of "All Research Units". Delete
the manifest and every file counts again.

Processing per file: lowercase, tokenise, drop stopwords (NLTK's English list
plus a project-specific list of terms common to every unit), drop non-alphabetic
and very short tokens, lemmatise, then keep the most frequent terms.

Useful options (`--help` lists them all):

```bash
python data_prep/generate_word_data.py --top-n 150
python data_prep/generate_word_data.py --exclude Workshop
python data_prep/generate_word_data.py --output-dir /tmp/preview
```

### NLTK corpora

The script downloads what it needs on first run. NLTK 3.9 replaced the pickled
`punkt` model with the `punkt_tab` tables and made `word_tokenize` require the
latter, so both are requested; a run that fetches only `punkt` fails with
`LookupError: Resource 'punkt_tab' not found`.

---

## Adding a research unit

1. Add the unit to `UNITS` in
   [`data_prep/scrape_zmo.py`](data_prep/scrape_zmo.py) — its URL slug on
   zmo.de and the filename stem to write. (For text that is not on the website,
   drop a `.txt` file into `data_prep/raw_data/` by hand instead; it will get
   its own word cloud but stay out of `combined`.)
2. Run both stages. They write `data_prep/raw_data/<Unit_Name>.txt` and then
   `units_wordcloud/data/<Unit_Name>_word_frequencies.json`.
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
