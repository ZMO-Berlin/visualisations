# ZMO visualisations

Two static web apps built from data scraped from the
[Leibniz-Zentrum Moderner Orient (ZMO)](https://www.zmo.de/) website.

| App | What it shows | Lives in | Published at |
| --- | --- | --- | --- |
| **Word cloud** | The most frequent terms in each research unit's description and project abstracts | `units_wordcloud/` | [/units_wordcloud/](https://zmo-berlin.github.io/visualisations/units_wordcloud/) |
| **Publications dashboard** | The publication register — output per year, research themes, regions studied, document types, authors, languages, open access, library subject headings, co-authorship, journals and publishers, collaborating institutions and citations | `publications_dashboard/` | [/publications_dashboard/](https://zmo-berlin.github.io/visualisations/publications_dashboard/) |

The site root is a landing page that introduces the two and links to them, in
English and German. The Deploy Pages workflow validates `main` and publishes an
allowlist of static files as an artifact, so each app has its own directory. Nothing hard-codes that path — `main.js`
resolves the app root from `import.meta.url` — so the same files work from a
local server or any other host without a change.

The landing page reads its figures and both card previews from the same files
the apps read — `meta.json` for the counts and the year sparkline, the combined
word frequencies for the term preview — rather than restating them, so it cannot
drift from what it links to after a monthly refresh. The markup carries the
current values as a fallback, generated from the same data, so a failed fetch
leaves a page that still makes sense and the card does not change as the fetch
lands.

The three pages share one design layer in `shared/`: a single `tokens.css` that
every stylesheet draws its colours, type, spacing and shape from, and a site bar
carrying the institute's mark, the three views and the language. The bar removes
itself when the page is inside an iframe, since zmo.de has its own header above
the embed.

> **Embedding on zmo.de.** The site's `Content-Security-Policy` header lists the
> origins an `<iframe>` may load from, and `zmo-berlin.github.io` has to be one
> of them. At the time of writing `frame-src` allows `https://fmadore.github.io`
> and `https://heshmat.zmo.de` but not this one, so an embed is blocked by the
> browser until ZMO's web team adds it.

Both apps:

- are published in **English and German**, at `<app>/en/` and `<app>/de/`;
- have **no build step** — plain ES modules loaded directly by the browser. No
  bundler, no `package.json`, no `npm install`;
- read **data that is scraped, not maintained by hand**. Python scripts in
  `data_prep/` fetch from zmo.de and write JSON into the app's `data/`
  directory; GitHub Actions rerun them monthly and commit the result.

---

## Repository layout

```
index.html                   Language-detecting redirect to the landing page
en/index.html                Landing page, English
de/index.html                Landing page, German
landing/                     Its stylesheet, logo, and the script reading the counts
.nojekyll                    Serve the files as they are; do not run Jekyll

shared/                      The one layer all three pages load first
  tokens.css                 Colour, type, space, shape, motion — every design
                             value on the site, declared once. Ends with a block
                             of legacy aliases mapping the old variable names
                             onto the new ones, so a stylesheet can be migrated
                             a module at a time rather than in one commit.
  fonts.css                  @font-face for the two families, split by script
  fonts/                     Self-hosted Newsreader and Instrument Sans (OFL)
  site-bar.js/.css           The bar carrying the mark, the three views and the
                             language. Removes itself inside an iframe.

.github/workflows/           Monthly data refreshes plus push/PR validation

tests/                       unittest regression tests for the pipelines

data_prep/                   Offline data pipelines (Python)
  zmo_site.py                Shared: HTTP client, TYPO3 page slicing, text cleanup
  scrape_zmo.py              zmo.de research units -> text
  generate_word_data.py      Text -> word-frequency JSON
  scrape_publications.py     zmo.de publication register -> publications.json
  scrape_people.py           zmo.de people pages -> people.json
  enrich_openalex.py         register -> OpenAlex matches, citations -> openalex.json
  build_themes.py            titles -> embeddings -> themes and map -> themes.json
  gemma_encoder.py           EmbeddingGemma 2 (ONNX, fp32) for build_themes.py
  fetch_subjects.py          books' ISBNs -> GND subject headings -> subjects.json
  regions.py                 Places named in titles and abstracts; --report for review
  gazetteer_check.py         Checks gazetteer ids on Wikidata -> places.json
  titles.py                  A title without its formulas and a review's imprint
  languages.py               Language of a title (Lingua plus register-specific rules)
  people.py                  Register author <-> people page, by name
  dashboard_extras.py        The enrichment layers of the dashboard dataset
  generate_publication_data.py   publications.json + layers -> dashboard dataset
  aliases.json               Hand-curated spelling merges (typos, renamed venues)
  theme_labels.json          Theme names, written by Claude Opus 5.5 from the brief
  gazetteer.json             Hand-curated places: names in three languages, regions
  regions_review.json        Review decisions on ambiguous place names
  reports/                   Not deployed: OpenAlex gaps, theme brief, regions review
  raw_data/                  Scraper output, committed for readable diffs
    <Unit>.txt               One file per research unit
    units.json               Manifest of what the unit scraper collected
    publications.json        Every publication, with all fields the site shows
    people.json              People pages: position, current units, ORCID
    openalex.json            OpenAlex matches, references and citations
    themes.json              Theme, area and map position of every publication
    places.json              Wikidata labels and coordinates of gazetteer places
    subjects.json            GND headings of the register's books

units_wordcloud/             Word cloud app (static)
publications_dashboard/      Publications dashboard app (static)

requirements.txt             Python dependencies for the pipelines only
requirements-themes.txt      Plus the embedding model's runtime, for build_themes.py
```

Each app follows the same shape:

```
<app>/
  index.html                 Language-detecting redirect
  en/index.html              English entry point
  de/index.html              German entry point
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

Serving the repository root gives the landing page and both apps, exactly as
they are published:

```bash
python -m http.server 8002
```

Then open <http://localhost:8002/>, <http://localhost:8002/units_wordcloud/en/>
or <http://localhost:8002/publications_dashboard/en/>.

Serve the repository root, not an app directory. Both apps load
`../../shared/tokens.css`, which does not exist above an app root, so
`--directory units_wordcloud` now gives an unstyled page. Any static file server
works equally well.

## Setting up the pipelines

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate elsewhere
pip install -r requirements.txt
```

Run the pipeline regression tests with:

```bash
python -m unittest discover -s tests -v
```

The `Validate` workflow also parses every Python, JavaScript and JSON file and
regenerates both apps' data into a temporary directory, failing if the committed
outputs are stale.

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
plus a project-specific list), drop non-alphabetic and very short tokens,
lemmatise, drop stopwords again, then keep the most frequent terms.

Two details in that sequence are worth knowing, because both were wrong until
recently and both were visible in the cloud:

- **Lemmatising tries noun then verb.** `WordNetLemmatizer` defaults to
  `pos="n"`, which only ever folds plurals — every verb passed through
  untouched, and the cloud ranked `explores` and `explore` as two separate
  terms, seventeen each. Nouns are tried first because `focuses` is a noun
  plural before it is a verb; going verb-first would rewrite legitimate nouns
  (`relations` → `relate`).
- **Stopwords are applied twice**, before and after lemmatising, so that a
  stoplisted `aim` also catches the `aims` that only becomes `aim` afterwards.

`CUSTOM_STOPWORDS` holds two groups: terms common to every unit
(`project`, `research`, `study`…) and research-proposal boilerplate — the verbs
and hedges describing what a project *does about* its subject rather than what
the subject is (`focus`, `aim`, `explore`, `examine`, `way`, `different`…).
Before the second group existed, `focus` was the 4th commonest term in the
combined cloud, ahead of every place, period and religion in the corpus, because
all three units describe themselves in the same prose. Words that merely *sound*
generic are deliberately kept: `night`, `life`, `south`, `practice` and `space`
are all subjects ZMO actually works on.

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
   drop a `.txt` file into `data_prep/raw_data/` by hand; the existing unit
   manifest is still required, and the extra text stays out of `combined`.)
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
        ├──────────────► WordList
        └──────────────► ContextStrip   (unit name, terms shown, occurrences)
```

**The first layout waits for the webfont.** d3-cloud decides where each word
fits by drawing it to a scratch canvas and measuring it, so the layout is only
correct if the face it measures is the face the SVG draws. Newsreader is
`font-display: swap`, so laying out immediately would pack the fallback serif's
metrics and then repaint them in Newsreader — overlaps where the real glyphs are
wider, gaps where they are narrower — and nothing would trigger a second layout
to fix it. `main.js` awaits `document.fonts.load()` before the first render.

**Dependencies are injected.** [`main.js`](units_wordcloud/src/main.js) is the
only place that constructs anything; every other module receives what it needs
through its constructor.

**Interaction uses direct callbacks and store subscriptions.** The unused event
bus and validation/logging middleware have been removed. Actions validate inputs;
services validate data. Superseded requests and layouts are ignored or cancelled,
and every cancelled layout promise settles. A content-derived random seed keeps
the same words stable at the same viewport and font metrics.

`Explorer` adds unit comparison and source passages. Its complete vocabulary data
is lazy-loaded; a failed cloud dependency still leaves the frequency list usable.

---

# The publications dashboard

Everything in ZMO's [publication register](https://www.zmo.de/en/publications/publication-search)
— 1,976 publications, 1994–2026, 668 authors — as linked views: output per
year, research themes, document types, most-published authors, the language of
each title, open access, where ZMO publishes, and who publishes with whom, over
the full list of publications underneath. *Explore patterns* adds themes and
languages over time, collaborating institutions and citations.

Four sources beyond the register feed those views, each named where its data
appears: zmo.de's people pages, OpenAlex, automatic language detection, and a
thematic map computed with an embedding model and named by a language model.
See [Enrichment layers](#enrichment-layers) for what each contributes and where
it stops.

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

Rankings run to hundreds of entries — 668 authors, 528 journals — so every
ranked chart pages rather than truncating at a top-N; the network opens on the
60 most-published authors and grows on request.

"Where ZMO publishes" ranks journals and publishers. The register's `series`
field is not ranked beside them: it is filled on 192 of 1,976 records and holds
179 distinct values among them, so the ranking was a list of ones. The field is
still what names the venue on a working paper in the list below, and is still
searched.

A year slider under the timeline sets the same range as the From/To selects;
the author timelines are a heatmap on one scale; and every chart panel has a
full-screen button. When the dashboard is embedded, the `<iframe>` needs
`allow="fullscreen"` for that button to appear.

Both language pages accept `?debug`, which logs every state transition to the
console.

## Regenerating the publications data

The same shape as the word cloud — crawl, then reduce to what the app loads —
with the enrichment layers in between. Each layer is optional to the generator:
a missing input leaves its fields out.

```bash
python data_prep/scrape_publications.py          # zmo.de -> data_prep/raw_data/publications.json
python data_prep/scrape_people.py                # zmo.de -> data_prep/raw_data/people.json
python data_prep/enrich_openalex.py              # OpenAlex -> data_prep/raw_data/openalex.json
python data_prep/fetch_subjects.py               # lobid + DNB -> data_prep/raw_data/subjects.json
python data_prep/build_themes.py                 # titles -> data_prep/raw_data/themes.json (requirements-themes.txt)
python data_prep/generate_publication_data.py    # -> publications_dashboard/data/*.json (places matched here)
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
the cache misses; `--refresh-all` picks it up. Scheduled runs in January, April,
July and October refresh all detail pages to bound this staleness.

### Stage 2 — `generate_publication_data.py`

Writes `families.json` (deduplicated volume–chapter relationships),
`publications_dashboard/data/publications.json` (one slim record per
publication) and `meta.json` (source, document types in filter order, counts,
and `perYear` — one count per year across the whole span, gaps included as
zero). `perYear` exists for the landing page: without it that page would have to
fetch the megabyte of `publications.json` to draw a preview the size of a
postage stamp.

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

Together these fold 81 spellings, yielding 668 author entries and 528 distinct
journal names. Review the lot before trusting it:

```bash
python data_prep/generate_publication_data.py --report-merges
```

Fields the dashboard does not draw — abstracts, cover images, ISBNs, the
the publisher's own URL — stay in
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
dimension, memoised by the filters each selector depends on. Charts are HTML rather than SVG — the labels are
long, multi-word and differently sized in two languages, and in HTML they wrap
and ellipsize for free. The co-authorship graph is the exception: it needs
`d3.forceSimulation` for the layout.

---

## Enrichment layers

What the register does not say, four other sources do — each kept in its own
file, each named in the dashboard next to what it produced, and each stating
its coverage before its figures. The generator joins them in
[`dashboard_extras.py`](data_prep/dashboard_extras.py); the plan and the
measurements that shaped them are in
[the roadmap](docs/roadmap-2026-10-22.md).

| Layer | Source | Reach (October 2026) | Shown as |
| --- | --- | --- | --- |
| People | zmo.de people pages | 290 people; 174 register authors linked, in 1,718 publications | author links, profile line, darker network nodes |
| OpenAlex | [OpenAlex](https://openalex.org) (CC0) | 833 of 1,976 publications matched | open access, institutions, citations |
| Language | titles, [Lingua](https://github.com/pemistahl/lingua-py) | 1,638 of 1,976 determined | language ranking, languages over time |
| Themes | [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2), names by Claude Opus 5.5 | every publication | map, theme ranking, themes over time |
| Places | `gazetteer.json` (206 places), coordinates from Wikidata | 1,367 of 1,979 name a place | world map, place ranking, regions over time |
| Subject headings | GND, via [lobid](https://lobid.org/resources) and the [DNB](https://www.dnb.de) (CC0) | 133 of 245 books with an ISBN | heading ranking, list tags |

The secondary dashboard files (`themes.json`, `openalex.json`) refer to
records by their position in `publications.json` and carry the dataset id they
were built against; the dashboard refuses a mismatched pair rather than attach
institutions to the wrong publications.

### People pages — `scrape_people.py`

Crawls the directorate, research fellows, associated and affiliated
researchers, guests, research support and former fellows and staff — every
listing is paginated ten to a page, and the former staff alone run to 21 pages
— and each person's page. It keeps the name, position, the research units of
the projects linked in the *current research* lines (German links mapped to the
English unit slugs), regional focus and an ORCID iD if one is linked. It never
stores email addresses, phone numbers or CV text, and does not crawl student
assistants.

[`people.py`](data_prep/people.py) joins people to register authors by name,
with the rules the generator already trusts for merges: the same words in any
order, or a given name that extends the other — and only when the pairing is
unique both ways. "Ahmed, M." stays unlinked between a Mohammed and a Mahmoud.
Research units are shown for current members only: a former fellow's unit is
not a current one, and units are never projected back onto older publications.

### OpenAlex — `enrich_openalex.py`

Matches the register to OpenAlex by DOI, then against the works OpenAlex
attributes to ZMO, then by title — requiring title similarity, the year within
one and a shared author surname, refusing ties. Book reviews are matched by DOI
only: a review's title is the reviewed book's. The run is incremental: known
matches are refreshed by id and only new or changed records are searched;
`--refresh-all` (used quarterly by the workflow) re-searches everything.
OpenAlex now meters requests, so title searches are batched; an
`OPENALEX_API_KEY` raises the daily budget and is sent as a header, never in a
URL. Abstracts are not copied — they belong to the publishers.

Coverage is the story here, and the dashboard tells it first. Books, chapters
and work not in English are poorly represented, and fewer than two in five
matched works carry a reference list, so the citations view opens with a caveat stating
how much of the current selection it can see, and nothing in it ranks people.
The gap report, `data_prep/reports/openalex-gaps.csv`, lists ZMO-affiliated
works OpenAlex knows that the register does not, and register DOIs OpenAlex
cannot resolve — for ZMO's library, not for the site.

### Language — `languages.py`

The register records no language, so it is detected from title and subtitle,
and labelled as detected. Lingua alone misread the register in four ways the
rules now handle: bracketed translations outvoted the title, Arabic-script
titles carrying a transliteration went to German or Malay, transliterated
Arabic was read as Indonesian, and place names outvoted grammar ("… in Burkina
Faso" as French). Function words decide first; Lingua is consulted only when
they are inconclusive, and only at high confidence. A book review's title is the
reviewed book's, so reviews are "undetermined", as are titles too short to tell.

### Themes — `build_themes.py`

Every title and subtitle is embedded with EmbeddingGemma 2 through its pinned
ONNX export in fp32 (the same model build as the IWAC pipeline), with the
model's clustering prefix. Formulaic prefixes and reviews' imprints are
removed; a generic title such as "Introduction" gets its volume's title as
context. Each language's mean vector is subtracted so that themes follow
subject rather than language. k-means makes 24 themes, grouped by Ward linkage
into eight areas — the categorical palette's limit — and UMAP lays out the map.
All seeds are fixed and the method is recorded in `themes.json`.

Two trial runs shaped this and are worth knowing before changing it: adding
abstracts made clusters split by *whether a record had an abstract*, and
journal or series names as context made genres (encyclopaedia entries, a
project's online resources) into themes. Three of the 24 still group short or
generic titles; their labels begin "Mixed".

**The labels are written by a language model, and say so.** `--refit` writes
[`reports/theme-brief.md`](data_prep/reports/theme-brief.md) — each theme's
distinctive terms, the titles nearest its centre and a seeded sample, without
author names — and Claude Opus 5.5 (Anthropic) wrote the English and German
names and descriptions in [`theme_labels.json`](data_prep/theme_labels.json)
from it. They have not been reviewed by ZMO staff; the dashboard says this
under the map. Each label carries a signature of the membership it was written
for, and the generator refuses labels whose signature no longer matches, so a
re-fit cannot ship old names on new groups.

**Recording a review.** Anyone at ZMO can review the names: edit the `en`/`de`
labels and descriptions in `theme_labels.json` (keep each `signature`), then set
`"reviewed": {"by": "Name", "date": "YYYY-MM-DD"}`. The note under the map then
names the reviewer instead of saying the names are unreviewed.

Day to day the fit is kept: the *Update themes* workflow embeds new
publications and gives each the theme with the nearest centroid and a place
beside its most similar neighbours. A re-fit is a deliberate local act:

```bash
python -m venv .venv-themes && .venv-themes/Scripts/pip install -r requirements-themes.txt
.venv-themes/Scripts/python data_prep/build_themes.py --refit   # then relabel from reports/theme-brief.md
```

On Windows on ARM, numba (used by UMAP) crashes inside LLVM; use an x64 Python.
Embedding is several times faster with four onnxruntime threads than with all
cores on a hybrid-core laptop (`--threads`, default 4). Embeddings are cached in
`data_prep/.cache/`, which is not committed.

### Places — `regions.py`

The register records no place, so places are found by name. `gazetteer.json` is
hand-curated: 206 countries, regions, cities, seas and historical polities, each
with a Wikidata id, its names in English, German and French, and the adjectives
and demonyms titles use ("syrisch*" catches syrische, syrischen…), grouped into
eight regions — the categorical palette's limit — plus a grey transregional
group for continents, seas and "worlds". Every id was checked against Wikidata
with `gazetteer_check.py`, which caught 35 wrong ones (an id from memory had put
Niamey in Kampala) and writes the coordinates the map uses.

Matching reads titles, subtitles and, where the register has one, abstracts;
abstracts were deliberately not used for themes, but for places they are the
better evidence, and the dashboard says that records with an abstract therefore
show more places. The longest name wins ("Indian Ocean" is not India, "Niger
Delta" is Nigeria); hyphenated words count every part ("Syrian-Turkish");
institution names and the like are removed first ("ZMO Berlin", "Gulf of
Guinea", "Middle Ages"); a review's imprint is never a place. Demonyms that are
mostly languages or ethnonyms were left out after reading the matches —
"French", "Chinese Muslims in Indonesia", "Armenian" for the genocide in the
Ottoman Empire.

**Review.** `python data_prep/regions.py --report` writes
`reports/regions-review.md`: every place's count, every match of the five names
marked ambiguous (Benin, Georgia, Jordan, Medina, Tripoli) in context, and a
seeded sample per region. All 46 ambiguous matches were read and decided in
`regions_review.json` — three rejected: an author called Daniel Jordan Smith, the
medina (old town) of Tunis, and *al-madīna*, "the city". The review was done by
Claude Opus 5.5 and the dashboard says so; a new ambiguous match after a monthly
refresh keeps the default and is listed as unreviewed rather than failing the
run. Researchers' stated regional focus on zmo.de is matched with the same list
and shown beside the map.

### Subject headings — `fetch_subjects.py`

Monographs and edited volumes with an ISBN are looked up in the hbz union
catalogue (lobid) and the German National Library (SRU, MARC21) and their GND
headings merged. A catalogue record counts only if its own ISBNs include the
one asked for and it shares a word with the register's title — which caught one
ISBN in the register belonging to a different book. Machine-assigned DNB
headings are dropped. Chapters are out of scope: a volume's headings do not
describe a chapter. Headings are in German, as the catalogues give them.

## Shared pipeline code

[`data_prep/zmo_site.py`](data_prep/zmo_site.py) holds what both scrapers need:
the HTTP client (one session, a politeness delay, retries with backoff, an
identifying `User-Agent`, an optional on-disk HTML cache), the slice between
TYPO3's `<!--TYPO3SEARCH_begin-->` markers that drops navigation and footers,
and the text cleanup that strips invisible characters pasted in from Word.

Neither scraper writes a timestamp into its output. The manifests and datasets
have to be byte-identical when the site has not changed, or the monthly
workflows would commit a diff on every run and republish the site for nothing.
Git records when content changed. Deployment separately writes `shared/refresh.json`
from the latest successful refresh workflows; the methodology disclosures show
those dates without changing the content-derived dataset IDs.

## Automatic monthly refresh

| Workflow | Runs | Does |
| --- | --- | --- |
| [`update-word-data.yml`](.github/workflows/update-word-data.yml) | 04:00 UTC on the 1st | Both word cloud stages |
| [`update-publication-data.yml`](.github/workflows/update-publication-data.yml) | 05:00 UTC on the 1st | Both publications stages, plus the people pages and OpenAlex |
| [`update-themes.yml`](.github/workflows/update-themes.yml) | After each publication refresh | Places new publications on the thematic map (no re-fit) |
| [`validate.yml`](.github/workflows/validate.yml) | Every push and pull request | Tests, syntax, JSON and generated-data checks |

The OpenAlex step reads an `OPENALEX_API_KEY` repository secret and an
optional `OPENALEX_MAILTO` variable. The people and OpenAlex steps may fail
without failing the refresh: both write atomically, so last month's file stays
and the run summary reports the failure.

Each commits to `main` only if something changed. Successful completion triggers
Deploy Pages explicitly through `workflow_run`; this also works for commits made
with `GITHUB_TOKEN`, which do not trigger ordinary push workflows. The two refresh workflows share one
concurrency group, so manual and scheduled runs cannot race their commits.

Run either on demand from the Actions tab. Both take a `dry_run` option that
scrapes and reports without committing, which is the safe way to check whether
the site has moved; the publications workflow also takes `refresh_all`.

Several safety nets stand between a broken scrape and `main`:

* the scrapers exit non-zero when a page yields nothing they recognise;
* the publications scraper verifies that the live document-type filter still
  matches its known ids and labels, and refetches individual malformed cache
  entries instead of abandoning the full cache;
* a follow-up step compares the new output against the committed version and
  fails on a large drop — under 60% of a unit's words, or under 90% of the
  register's identities (even if replacement records keep the count unchanged).
  Removed projects and units are checked too. A scraper cannot tell that a page returned *fewer*
  items than before, so this catches a partial restructure that would otherwise
  commit a hollowed-out dataset.

A failing run sends the usual GitHub notification. Note that GitHub disables
scheduled workflows in public repositories after 60 days without repository
activity; if the site goes unchanged that long, the schedule may need
re-enabling from the Actions tab.

---


## Exploration and reusable outputs

The dashboard includes count/percentage small multiples by document type, author
publication timelines with clickable year counts, shared-publication lists for
collaborator pairs, and expandable volume–chapter families. These views open on
demand. The network includes encoding guidance and keeps its layout when only
selection changes. Rankings exclude their own filter; the result list, CSV and
timeline exports apply all filters. Timeline SVG/PNG exports show total dated
records, carry the full selected scope, source and dataset identity, and explain
that the latest year may be incomplete.

The word explorer has Cloud, Frequency list, Compare units and Source passages
views. Comparison uses the **complete vocabulary**, including counts below the
cloud's top-100 cutoff, normalized per 1,000 retained tokens. Its difference sort
uses maximum minus minimum normalized frequency and requires five occurrences.
A term opens original English paragraphs attributed to the exact project/unit
heading and source link. The comparison CSV contains raw counts and normalized
rates. The corpus currently contains 8,362 retained tokens across 61 project
entries and three units. The UI explains these denominators and source limits.

Both apps provide **Copy view link**. Dashboard parameters are `q`, repeated
`type`, `author` and `venue`, plus `from` and `to` (see `store/url.js` for the
canonical encoding). Word parameters are `unit`, `count`, `view`, `term`, `find`
and `sort`. Language switches preserve them. Normal changes replace the current
history entry; browser navigation restores URL state. Persisted back/forward
navigation suspends and resumes visualization work without destroying the page.

## Validation and publishing

Run locally after changing application code or generated data:

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
node --test tests/*.test.mjs
python data_prep/validate_outputs.py
```

The last command regenerates **every** dataset into temporary directories,
compares parsed contents and verifies English/German landing fallbacks. After an
intentional data change, run both relevant generators and
`python data_prep/update_landing.py` before validation. NLTK is pinned to 3.10.3;
3.10.1 incorrectly blocked dependencies inside a repository-local virtualenv.

Serve the repository and open `/tests/browser.html` for the six DOM/canvas
regression checks (focus, comparison styles, localized SVG/PNG, page lifecycle, initial URL restoration, missing cloud dependencies).
These browser checks are manual; the Node/Python suites and syntax/data checks run
in CI. New behavior tests cover selector semantics, URL round trips, late async
results, graph invalidation, layout cancellation, name normalization, crawl
identity guards, attribution and deduplicated volume relationships.

**One-time deployment setup:** select **GitHub Actions** in the repository's
Settings → Pages → Build and deployment source. Then run **Deploy Pages** on
`main`. This is required when migrating from branch-based publishing. The workflow
runs tests and regeneration checks against the exact checkout it packages, then
uploads only the public HTML/assets/application datasets. Raw crawls, tests,
Python code, documentation and the virtualenv are not included. The settings
change and production deployment are not performed by a local code edit.

The deployment workflow runs after a successful Validate or data-refresh workflow,
or manually. Refresh jobs also run the Node/Python tests and generated-data checks
before committing, and recheck generated consistency after rebasing. A failed
validation cannot publish the checked-out content. No test command crawls the live
website; crawling is a separate, explicit pipeline operation.

## Third-party code

[d3](https://d3js.org/), [d3-cloud](https://github.com/jasondavies/d3-cloud) and
[topojson-client](https://github.com/topojson/topojson-client) are loaded from
jsDelivr, pinned to exact versions and protected with subresource-integrity
hashes. Both apps pin the same d3 build, so a visitor to both downloads it once.
The regions map's country outlines, `shared/geo/countries-110m.json`, are
[world-atlas](https://github.com/topojson/world-atlas) 2.0.2 (ISC), derived from
public-domain Natural Earth data, and are served from the site.

[Newsreader](https://fonts.google.com/specimen/Newsreader) and
[Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) are served
from `shared/fonts/`, not from a font CDN: no third-party request, and no reader
is announced to Google on their way in. They are Google's own variable `woff2`
builds, split by `unicode-range`, so an English or German page fetches only the
`latin` cut — around 160 KB of the 544 KB on disk. Arabic and CJK titles in the
publication register fall back to a system face; neither family covers those
scripts.

Everything else is first-party.

## Browser support

Targets current evergreen browsers. Uses ES modules, private class fields,
`ResizeObserver`, `Element.replaceChildren`, optional chaining and logical
assignment. No transpilation or polyfills are applied.

## Licences

Split, because the repository holds two different things:

| | Licence | Covers |
| --- | --- | --- |
| Code | [MIT](LICENSE) | Everything in `data_prep/`, `shared/`, `landing/`, `tests/`, and both apps' `src/` and HTML |
| Data | [CC BY 4.0](LICENSE-DATA) | `data_prep/raw_data/`, `data_prep/aliases.json`, `data_prep/theme_labels.json`, and both apps' `data/` |

The data is derived from zmo.de — the research-unit and project descriptions,
the publication register and the people pages — so the rights in the source
material are the institute's, and the CC BY grant rests on this repository
being published by the institute itself. `raw_data/openalex.json` holds
OpenAlex metadata, which OpenAlex releases under CC0. The theme names in
`theme_labels.json` were generated by Claude Opus 5.5 and are marked as such
wherever they are shown. `raw_data/subjects.json` holds catalogue data from the
hbz and the German National Library, both released under CC0, and
`raw_data/places.json` Wikidata labels and coordinates (CC0).

Two things are excluded from both. The bundled Newsreader and Instrument Sans
typefaces in `shared/fonts/` are third-party, under the SIL Open Font License.
The ZMO mark in `landing/zmo-logo.png`, and the icons and share card derived
from it in `shared/`, are the institute's and are not licensed for reuse here.

## Citation

[`CITATION.cff`](CITATION.cff) carries the citation metadata, which GitHub
renders as a **Cite this repository** button on the repository page and exports
as APA or BibTeX. It has no DOI: nothing here is tagged or archived. If a
release is ever deposited with Zenodo, add `version`, `doi` and the release date
to that file at the same time.
