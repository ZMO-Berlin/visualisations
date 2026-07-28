# ZMO visualisations

Two static web apps built from data scraped from the
[Leibniz-Zentrum Moderner Orient (ZMO)](https://www.zmo.de/) website.

| App | What it shows | Lives in |
| --- | --- | --- |
| **Word cloud** | The most frequent terms in each research unit's description and project abstracts | `units_wordcloud/` |
| **Publications dashboard** | The publication register — output per year, document types, authors, co-authorship, journals and publishers | `publications_dashboard/` |

Both apps:

- are published in **English and French**, at `<app>/en/` and `<app>/fr/`;
- have **no build step** — plain ES modules loaded directly by the browser. No
  bundler, no `package.json`, no `npm install`;
- read **data that is scraped, not maintained by hand**. Python scripts in
  `data_prep/` fetch from zmo.de and write JSON into the app's `data/`
  directory; GitHub Actions rerun them monthly and commit the result.

---

## Repository layout

```
.github/workflows/           Monthly data refreshes, one per app

data_prep/                   Offline data pipelines (Python)
  zmo_site.py                Shared: HTTP client, TYPO3 page slicing, text cleanup
  scrape_zmo.py              zmo.de research units -> text
  generate_word_data.py      Text -> word-frequency JSON
  scrape_publications.py     zmo.de publication register -> publications.json
  generate_publication_data.py   publications.json -> dashboard dataset
  aliases.json               Hand-curated spelling merges (typos, renamed venues)
  raw_data/                  Scraper output, committed for readable diffs
    <Unit>.txt               One file per research unit
    units.json               Manifest of what the unit scraper collected
    publications.json        Every publication, with all fields the site shows

units_wordcloud/             Word cloud app (static)
publications_dashboard/      Publications dashboard app (static)

requirements.txt             Python dependencies for the pipelines only
```

Each app follows the same shape:

```
<app>/
  index.html                 Language-detecting redirect
  en/index.html              English entry point
  fr/index.html              French entry point
  data/                      Generated JSON (pipeline output; the app fetches it)
  src/
    main.js                  Composition root: builds and wires everything
    config/                   All tunable settings
    store/                    Application state and the actions that change it
    services/                 Data fetching
    components/               UI
    utils/                    Helpers, i18n
    styles/                   CSS, one module per concern
```

---

## Running locally

Both apps use ES modules and `fetch`, so they must be served over HTTP — opening
`index.html` from the filesystem will not work.

```bash
python -m http.server 8000 --directory units_wordcloud
```

```bash
python -m http.server 8001 --directory publications_dashboard
```

Then open <http://localhost:8000/> or <http://localhost:8001/>. Any static file
server works equally well.

## Setting up the pipelines

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate elsewhere
pip install -r requirements.txt
```

---

# The word cloud

An interactive cloud of the most frequent terms in the research-unit
descriptions. Pick a research unit (or view all of them combined), adjust how
many words to show, hover a word to see its frequency, and export the result as
a PNG.

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

## Regenerating the word cloud data

Two stages: fetch the text from zmo.de, then turn it into frequencies.

```bash
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

It **fails loudly** if a page yields no abstract or no projects: the `bb-*`
selectors it relies on come from the site's TYPO3 theme, so a redesign should
produce a visible error rather than a quietly shrinking word cloud.

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
combined aggregate. So if you drop a `.txt` file into `raw_data/` by hand — a
workshop description, a call for papers — it gets its own frequency file but
stays out of "All Research Units". Delete the manifest and every file counts
again.

Processing per file: lowercase, tokenise, drop stopwords (NLTK's English list
plus a project-specific list of terms common to every unit), drop non-alphabetic
and very short tokens, lemmatise, then keep the most frequent terms.

Useful options (`--help` lists them all):

```bash
python data_prep/generate_word_data.py --top-n 150
python data_prep/generate_word_data.py --exclude Some_File
python data_prep/generate_word_data.py --output-dir /tmp/preview
```

### NLTK corpora

The script downloads what it needs on first run. NLTK 3.9 replaced the pickled
`punkt` model with the `punkt_tab` tables and made `word_tokenize` require the
latter, so both are requested; a run that fetches only `punkt` fails with
`LookupError: Resource 'punkt_tab' not found`.

### Adding a research unit

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

### Word cloud architecture

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
through its constructor.

**The event bus is for cross-component signals only** — word hover, word click,
data loading, save requests, errors.

> The bus currently has **publishers but no subscribers**: the app itself is
> wired with direct calls and store subscriptions, so the ~15 `emit()` sites
> exist purely as an extension point for embedding code that wants to observe
> the cloud. Payloads are still validated on every emit, so anything that
> subscribes later gets well-formed data. If that extension point is not
> wanted, the bus, its middleware and the `emit()` calls can all be removed
> without touching behaviour.

---

# The publications dashboard

Everything in ZMO's [publication register](https://www.zmo.de/en/publications/publication-search)
— 1,962 publications, 1994–2026, 656 authors — as five linked views: output per
year, document types, most-published authors, where ZMO publishes, and who
publishes with whom, over the full list of publications underneath.

**Every chart is a filter.** Click a column, a bar, a legend entry or an author
node and the whole dashboard narrows to it; the choices stack, and each one
appears as a chip that can be removed. Charts are counted against every filter
*except their own*, so selecting one document type leaves the other types
visible to switch to rather than collapsing the panel to a single bar.

The year chart is stacked by document type. Seven types are drawn as their own
series and the smallest are grouped: eight is the ceiling for a categorical
palette that stays distinguishable, including to a colourblind reader. The eight
hues were checked against this page's white surface — worst adjacent pair ΔE 9.1
under protanopia — and their **order** is what makes that true, so slots are
assigned in sequence and never shuffled or cycled. Three of the eight sit below
3:1 contrast on white, which is why every series is named in the legend rather
than left to colour alone.

Rankings run to hundreds of entries — 656 authors, 526 journals — so every
ranked chart pages rather than truncating at a top-N; the network opens on the
60 most-published authors and grows on request.

Both language pages accept `?debug`, which logs every state transition to the
console.

## Regenerating the publications data

Two stages, the same shape as the word cloud: crawl the register, then reduce it
to what the app loads.

```bash
python data_prep/scrape_publications.py          # zmo.de -> data_prep/raw_data/publications.json
python data_prep/generate_publication_data.py    # -> publications_dashboard/data/*.json
```

### Stage 1 — `scrape_publications.py`

Three passes over the register:

1. **the unfiltered result pages**, to discover every publication's slug;
2. **the same listing filtered by each document type.** The type is not printed
   on any page, but it *is* a filter — so which listing a publication appears in
   is the only way to learn it;
3. **one detail page per publication**, for the fields the listing omits.

Per publication it records: authors, title, subtitle, document type, year (and
full date where given), journal with volume and issue, publisher and place,
series, page range, ISBN/ISSN, DOI, external link, abstract, cover image, the
volume a chapter appeared in, and the ZMO chapters inside an edited volume or
special issue.

The filter is submitted as GET parameters rather than the form's POST, which
keeps every request cacheable and reproducible from a browser address bar.

#### Caching

`raw_data/publications.json` is both the output and the cache. Every run
re-reads the listing — it is the only statement of which publications exist, so
it is what detects new records *and* withdrawn ones — but a publication whose
listing entry (title, authors, publisher, periodical) is unchanged keeps the
record already on disk instead of having its detail page fetched again.

The document-type listings are walked a page at a time in parallel across the
nine types rather than one type to exhaustion before the next, and stop as soon
as every new publication has been identified. Results are sorted newest first,
so a top-up usually resolves in the first round of nine requests; walking the
types in order would page through all 68 pages of "Contributions to an edited
volume" before ever reaching a new journal article.

| Run | Requests | Wall clock | |
| --- | --- | --- | --- |
| First crawl | ~2,400 | ~30 min | measured |
| Nothing changed | 198 | ~5 min | measured |
| A month's new publications | ~210 | ~5 min | estimated from the two above |

The second row is the one that matters, and it was checked against the live
site: a run that finds nothing new fetches the 198 listing pages, no type
listings at all and no detail pages, then writes a file byte-identical to the
one already committed — so the monthly workflow commits nothing rather than
churning the site.

```bash
python data_prep/scrape_publications.py --dry-run       # report, write nothing
python data_prep/scrape_publications.py --refresh-all   # ignore the cache
python data_prep/scrape_publications.py --limit 30      # a quick sample
python data_prep/scrape_publications.py --cache-dir /tmp/zmo-pubs   # reuse downloaded HTML
```

An abstract edited in place without any listing field changing is the one edit
the cache misses; `--refresh-all` picks it up.

### Stage 2 — `generate_publication_data.py`

Writes `publications_dashboard/data/publications.json` (one slim record per
publication) and `meta.json` (source, document types in filter order, counts).

Its real work is **consolidating spellings**. The register is maintained by hand,
so one person or journal appears under several forms: `Kresse, Kai` and
`Birgitte Holst` are both name orders, `de Gruyter` and `De Gruyter` are one
publisher, `H-Soz-u-Kult` was renamed `H-Soz-Kult`. Without this the charts
would rank the same entity twice and under-count it both times.

Three rules run automatically:

1. **Normalisation.** Spellings differing only by case, accents, punctuation,
   spacing or a leading article are one entity — `I.B.Tauris`/`I.B. Tauris`,
   `The American Historical Review`/`American Historical Review`. Letters of
   *any* script are kept: reducing to ASCII keys every Arabic and Cyrillic name
   to the empty string and fuses them all into one, which an early version of
   this did.
2. **Name prefixes.** A given name that is a prefix of a fuller one belongs to
   it — `Kirmse, Stefan` → `Kirmse, Stefan B.`, `Schielke, S.` → `Schielke,
   Samuli` — but **only when exactly one fuller name shares that surname and
   prefix**. `Ahmed, M.` cannot be assigned between a Mohammed and a Mahmoud
   without guessing, so it stays separate. Matching is token by token, so `Jo`
   never folds into `John`.
3. **Author cells holding several people.** Authors are semicolon-separated, but
   a few records use commas — `Bromber, Katrin, Steiner, Christian` is two
   people. A comma is also the separator *inside* a name, so the only safe
   reading is by shape: an even number of at least four parts is that many
   `Surname, Given` pairs. Trailing `et al.` and role notes such as
   `(Guest Editors)` are stripped.

Everything past that needs to know the field — no rule can tell a typo from a
different journal — so it lives in **[`aliases.json`](data_prep/aliases.json)**,
hand-curated and commented: `Routldege` → `Routledge`,
`Leibiz-Zentrum` → `Leibniz-Zentrum`, `Journal for Religion in Africa` →
`Journal of Religion in Africa`. That file also records the near-identical names
that must **not** be merged — `Journal for Islamic Studies` (Cape Town) is not
`Journal of Islamic Studies` (Oxford); `Springer` is not `Springer VS`.

Together these fold 74 spellings, taking 683 author entries down to 656 and 562
journal names to 526. Review the lot before trusting it:

```bash
python data_prep/generate_publication_data.py --report-merges
```

Fields the dashboard does not draw — abstracts, cover images, ISBNs, the
chapter/volume links, the publisher's own URL — stay in
`raw_data/publications.json` rather than being shipped to every visitor. They
are there for anything built next.

### Known limits of the source data

These are properties of the register, and the pipeline does not paper over them:

* **35 publications have no document type** and **9 have no year.** They are
  counted under "No document type" and can be filtered to; an undated record
  drops out of a year filter rather than being silently dated.
* **Consolidation is conservative by design.** Two spellings are merged only on
  a rule that cannot be wrong, or on a curated line someone wrote deliberately.
  Journal names that differ by more than punctuation — `Africa` versus
  `Africa Today` — stay apart, because a rule that merged those would also merge
  two genuinely different journals.
* **Some journal names carry a volume or a date.** The register sometimes
  records `H-Soz-Kult, 26.02.2019` or `Africa Today, 67, 2-3 (winter 2020)` in
  the periodical field. Trailing *numeric* parts are read as volume and issue;
  anything else stays attached to the name, which is why a handful of journals
  appear more than once. Stripping harder risks truncating a real name.
* **Keywords are not recoverable.** The register can filter by keyword but never
  prints one, so there is nothing to scrape.

### Dashboard architecture

One dataset is shipped and every number is computed in the browser. That is what
makes cross-filtering possible at all: a chart can be recounted against any
subset without another request.

```
FilterBar · Timeline · BarChart ×2 · VenueChart · CoauthorNetwork
        │  (action: toggle a type, a year, an author, a venue)
        ▼
     AppStore ──► PublicationService ──► fetch
        │  select(except) → applyFilters
        │  (subscription)
        ▼
     main.js render()
        ├──► Summary            counts of the filtered set
        ├──► FilterBar          the search box and one chip per active filter
        ├──► Timeline           select('years'),  stacked by document type
        ├──► BarChart (types)   select('type')
        ├──► BarChart (authors) select('author')
        ├──► VenueChart         select('venue')
        ├──► CoauthorNetwork    select('author'), the same set as the ranking
        └──► PublicationList    everything, filtered
```

`store.select(dimension)` returns the records passing every filter *except* that
dimension, memoised per state. Charts are HTML rather than SVG — the labels are
long, multi-word and differently sized in two languages, and in HTML they wrap
and ellipsize for free. The co-authorship graph is the exception: it needs
`d3.forceSimulation` for the layout.

---

## Shared pipeline code

[`data_prep/zmo_site.py`](data_prep/zmo_site.py) holds what both scrapers need:
the HTTP client (one session, a politeness delay, retries with backoff, an
identifying `User-Agent`, an optional on-disk HTML cache), the slice between
TYPO3's `<!--TYPO3SEARCH_begin-->` markers that drops navigation and footers,
and the text cleanup that strips invisible characters pasted in from Word.

Neither scraper writes a timestamp into its output. The manifests and datasets
have to be byte-identical when the site has not changed, or the monthly
workflows would commit a diff on every run and republish the site for nothing.
Git already records when each refresh landed.

## Automatic monthly refresh

| Workflow | Runs | Does |
| --- | --- | --- |
| [`update-word-data.yml`](.github/workflows/update-word-data.yml) | 04:00 UTC on the 1st | Both word cloud stages |
| [`update-publication-data.yml`](.github/workflows/update-publication-data.yml) | 05:00 UTC on the 1st | Both publications stages |

Each commits to `main` only if something changed. Because Pages serves from
`main`, the published site updates with it.

Run either on demand from the Actions tab. Both take a `dry_run` option that
scrapes and reports without committing, which is the safe way to check whether
the site has moved; the publications workflow also takes `refresh_all`.

Two safety nets stand between a broken scrape and `main`:

* the scrapers exit non-zero when a page yields nothing they recognise;
* a follow-up step compares the new output against the committed version and
  fails on a large drop — under 60% of a unit's words, or under 90% of the
  register's publications. A scraper cannot tell that a page returned *fewer*
  items than before, so this catches a partial restructure that would otherwise
  commit a hollowed-out dataset.

A failing run sends the usual GitHub notification. Note that GitHub disables
scheduled workflows in public repositories after 60 days without repository
activity; if the site goes unchanged that long, the schedule may need
re-enabling from the Actions tab.

---

## Third-party code

[d3](https://d3js.org/) and [d3-cloud](https://github.com/jasondavies/d3-cloud)
are loaded from jsDelivr, pinned to exact versions and protected with
subresource-integrity hashes. Both apps pin the same d3 build, so a visitor to
both downloads it once. Everything else is first-party.

## Browser support

Targets current evergreen browsers. Uses ES modules, private class fields,
`ResizeObserver`, `Element.replaceChildren`, optional chaining and logical
assignment. No transpilation or polyfills are applied.

## License

No license has been declared for this repository yet. The bundled Muli typeface
is licensed separately under the SIL Open Font License.
