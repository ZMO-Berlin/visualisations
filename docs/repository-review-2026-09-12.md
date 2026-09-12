# ZMO repository review

Review date: 12 September 2026. Scope: static applications, shared design, Python pipelines, committed datasets, tests, documentation, and refresh workflows. This records the original examination and roadmap. Subsequent changes and verification are documented in [the implementation record](implementation-2026-09-12.md).

## Assessment

The project has a sound foundation. Plain ES modules, static hosting, pure aggregation functions, explicit dependency construction, shared design tokens, and reproducible datasets suit its scale. Keep these choices. A framework migration would add work without addressing the main problems found here.

The greatest immediate gains are reliable publishing, accessible interactions, and clearer explanations of the data. The strongest extension is comparative exploration: comparing vocabulary between units, publication types over time, and individual publication histories.

The visual identity is coherent and appropriate: Newsreader headings, Instrument Sans controls, warm backgrounds, navy typography, and restrained orange details. Preserve it. The weaknesses are small, pale functional text, mobile information loss, and chart density rather than an absence of visual character.

### Evidence and limits

- Inspected both applications' composition, state, services, charts, controls, styles, and relevant export/layout code; shared navigation and landing code; pipeline parsing, normalization, generators, tests, and all three workflows.
- Viewed the local landing page, English dashboard, and German word cloud in the browser. Examined dashboard and cloud at a 390 × 844 viewport, in addition to desktop.
- Reproduced keyboard focus loss when activating the document-type ranking with Enter. Inspected mobile axis collisions and the hidden frequency list.
- All **6 existing Python tests passed** using the bundled interpreter and compatible packages from the existing virtual environment.
- Syntax checks passed for **45 JavaScript files and 6 Python files**.
- Regenerating the publication dataset and metadata in memory matched their committed JSON values.
- Word-data regeneration was attempted but blocked by the available Python environment's missing/incompatible `regex._regex` extension. Its output has not been independently regenerated in this review.
- No live recrawl, deployment, actual phone gestures, screen-reader session, or complete cross-browser audit was performed. Browser Back testing in this environment reloaded the page, so it did not reproduce a back/forward-cache restoration.
- Impeccable's context launcher could not run because its engine was not installed and its cache was unwritable. This review used its audit guidance, direct code inspection, browser inspection, and manual measurements; no automated detector score is claimed.

### Provisional interface score

These are review priorities, not a WCAG conformance certification. A dark theme is not a requirement for this site.

| Dimension | Score / 4 | Assessment |
|---|---:|---|
| Accessibility | 2 | Native controls and some ARIA are present; focus loss, contrast, and mobile data access need attention. |
| Performance | 3 | Small static architecture and search indexing; excessive component replacement remains. |
| Responsive design | 2 | Layout adapts, but narrow timeline labels collide and the word list disappears. |
| Theming | 3 | Strong shared token layer; contrast annotations and actual usage need correction. |
| Implementation integrity | 3 | Coherent product design; several lifecycle, cache, and state inconsistencies. |
| **Total** | **13 / 20** | **Useful foundation with significant targeted improvements.** |

## Priority findings

The issue register below contains **5 P1 and 8 P2 findings**. No P0 issue was observed. P1 means a substantial reliability or accessibility problem; P2 means a narrower defect or important maintainability gap. Conditional risks are identified explicitly.

### 1. P1 — Make data refreshes explicitly validate and deploy

**Location:** `.github/workflows/update-publication-data.yml`, `.github/workflows/update-word-data.yml`, `.github/workflows/validate.yml`.

Both refresh jobs use checkout's default credentials, commit directly, and call `git push`. The README assumes that this also republishes the branch-based Pages site. GitHub documents that commits pushed using `GITHUB_TOKEN` do **not** trigger a Pages build. Ordinary push-triggered validation also does not run for these token-generated pushes. [GitHub documentation](https://docs.github.com/en/actions/concepts/security/github_token).

Consequently, the checked-in workflows do not guarantee that a monthly refresh is either fully tested or published. The current remote Pages configuration was not inspected; this is a verified gap in the repository's documented deployment path, not a claim that a particular production refresh failed.

**Recommendation:** run the relevant tests and data checks inside the refresh path before committing, then explicitly invoke an artifact-based Pages deployment. Reuse the same deployment workflow for human and automated updates. Stage the specific data paths rather than `git add -A`. Keep the existing shared concurrency group.

**Acceptance:** a small controlled refresh produces a successful validation and a deployed artifact containing the new dataset, without needing a subsequent human commit.

### 2. P1 — Preserve applications across back/forward-cache restoration

**Location:** `publications_dashboard/src/main.js:332`, `units_wordcloud/src/main.js:124`.

Both unconditional `pagehide` handlers unsubscribe, destroy components, and clear DOM content. `pagehide` also fires when a browser puts a page into its back/forward cache. Restoring such a page resumes its existing state; it does not rerun the original bootstrap. The restored app can therefore be empty or detached from its store. [Browser lifecycle guidance](https://web.dev/articles/bfcache).

**Recommendation:** distinguish suspension from destruction using `event.persisted`; preserve state and DOM while cached, pause expensive activity if necessary, and resume it on `pageshow`. Ensure pending fetches/layouts cannot commit after genuine destruction.

**Evidence level:** confirmed lifecycle mismatch in code; this browser session reloaded on Back and did not exercise the cached-restore branch. Add a test in a browser configuration that supports bfcache.

### 3. P1 — Keep keyboard focus through chart and pager updates

**Location:** `publications_dashboard/src/components/charts/BarChart.js:63`, `Timeline.js:63`, `VenueChart.js`, `components/Pager.js`, `components/FilterBar.js:110`.

Activating “Journal articles 498” with Enter applied the filter, but `document.activeElement` became `BODY`. Rendering replaces the button just activated. The same replacement pattern exists in timeline controls, venue tabs, filter chips, and pagination.

**Recommendation:** retain controls keyed by the entity they represent and update their attributes/text. Where replacement is necessary, explicitly move focus to the corresponding surviving control or a predictable adjacent control. Preserve focus when removing a chip. Complete venue tab semantics and arrow-key navigation, or use a simpler native button-group pattern.

**Acceptance:** repeated keyboard filtering and paging keep a visible, logical focus location; selecting a chart does not send the user back through the entire page.

### 4. P1 — Correct the functional text contrast

**Location:** `shared/tokens.css:70`, `publications_dashboard/src/styles/modules/layout.css:146`, and uses across controls, lists, landing, and cloud styles.

Calculated from the actual solid color values:

| Token | White background | Warm page background |
|---|---:|---:|
| `--c-ink-faint: #9aa0a9` | 2.63:1 | 2.42:1 |
| `--c-ink-soft: #737a84` | 4.33:1 | 3.98:1 |

The token comments claim different values. The faint token is actually used for instructions, years, counts, and control labels; the dashboard hints render at **11px**. These are meaningful text, not decorative marks. Ordinary text needs 4.5:1 under WCAG AA. [W3C contrast guidance](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html).

**Recommendation:** separate readable secondary text from decorative color, darken the former against every supported surface, and increase essential hints/metadata to a comfortable reading size. Add a small automated contrast check for critical token/background pairs. Preserve restrained hierarchy using size, weight, and spacing.

### 5. P1 — Keep exact word frequencies available on mobile and by keyboard

**Location:** `units_wordcloud/src/styles/modules/responsive.css:46`, `components/WordList.js`, `components/wordcloud/Renderer.js:53`.

Below 56rem the entire ranked list is `display:none`. The mobile screenshot confirms its absence. The cloud's word interactions are mouse hover/click handlers; its SVG has only a generic English image label, even on the German page. Thus the visible picture replaces the structured, exact-count representation precisely where hover is least dependable.

**Recommendation:** offer a “Cloud / Frequency list” switch on small screens, with a semantic list or table available in either language. Allow tap/focus to reveal a word's count and source context. Translate the SVG description. Avoid making 100 decorative SVG words obligatory tab stops when a structured alternative can serve the task better.

### 6. P2 — Make the network's change detection describe the actual graph

**Location:** `publications_dashboard/src/components/charts/CoauthorNetwork.js:205`.

The signature consists of ordered node IDs, edge count, and the sum of edge weights. It omits edge endpoints, individual weights, and node publication counts. Two graphs can share that signature while having different relationships. For example, A–B/C–D and A–C/B–D can have identical node order, edge count, and total weight. Changes to solo-publication counts can also leave the signature unchanged while changing node sizes and accessible counts.

**Recommendation:** distinguish topology changes, quantitative changes, and selection changes. Compare canonical endpoint/weight tuples and node counts, update visual values independently, and preserve positions for surviving IDs. No occurrence in the current filtered dataset was asserted; the collision follows directly from the signature definition.

### 7. P2 — Fix or narrow the documented initial-expansion rule

**Location:** `data_prep/generate_publication_data.py:175`.

`extends()` rejects equal token counts before testing whether an initial expands to a full name. A direct check returned `False` for `extends('s', 'samuli')`; a two-name `NameIndex` containing `Schielke, S.` and `Schielke, Samuli` produced no merge. This contradicts the documented example.

**Recommendation:** support equal-length token sequences when at least one initial is genuinely expanded, retaining the unique-candidate restriction and curated overrides. Add fixtures for one initial, multiple initials, longer given names, ambiguous surnames, and names that must remain separate. Review the resulting merge report before accepting changed author counts; string matching alone does not establish personal identity.

### 8. P2 — Give the mobile timeline a different density policy

**Location:** `publications_dashboard/src/components/charts/Timeline.js:125`, chart and responsive CSS.

At 390px, year columns were approximately **7.4px** wide. The first/last years and adjacent five-year ticks overlap: 1994/1995 and 2025/2026. The tick algorithm depends on the number of years, not rendered width.

**Recommendation:** choose ticks from available pixels, suppress close neighbors of endpoints, and offer an intentional horizontal plot region or simplified mobile timeline. Keep the year selectors as a precise alternative. A compact data table or focused-year breakdown would make narrow stacked segments inspectable without hover.

### 9. P2 — Serialize and preserve exploration state

**Location:** `shared/site-bar.js`, both `src/main.js` entry points, dashboard `store/filters.js`.

The cloud reads initial `unit`/`count` parameters but does not update the URL as controls change. Its language link discards those parameters. The dashboard has no filter URL serialization. A reader cannot reliably share or bookmark the exact subset they are discussing, and changing language loses their selection.

**Recommendation:** add a small tested URL-state codec with validation, encode set filters as repeated parameters, preserve state when switching language, and handle `popstate`. Batch updates deliberately so typing does not create a history entry for every keystroke. Add a “Copy view link” action.

### 10. P2 — Expand behavior tests beyond six scraper cases

**Location:** `tests/test_scrape_publications.py`, `.github/workflows/validate.yml`.

The tests cover cache reuse and listing/type-schema handling. There are no committed behavior tests for normalization, word processing, dashboard filters/aggregations, graph invalidation, focus, or mobile data access. Syntax checks and output equality cannot catch a consistently wrong algorithm, as the initial-expansion example demonstrates.

**Recommendation:** use Python fixtures for parsing/normalization and a lightweight JavaScript test setup for the already-pure filters and aggregates. Add a small browser regression suite around the observed failures. This can remain development-only; the published site can retain its no-build architecture.

Test OR-within/AND-across filters, exclusion of a chart's own dimension, unknown years/types, ambiguous aliases, empty results, keyboard focus, locale-state preservation, narrow viewports, and restored navigation.

### 11. P2 — Validate record shape and isolate visualization failures

**Location:** `publications_dashboard/src/services/PublicationService.js:15`, `store/AppStore.js`, `src/main.js`.

The service checks that publications are a nonempty array, but not the record fields or metadata. Invalid `authors`, years, or links can fail later. Subscriber exceptions are logged, which avoids a misleading fetch error, but the single render subscriber may stop halfway through updating the dashboard.

**Recommendation:** define a compact dataset contract and validate it at generation and load boundaries. Check unique slugs, string arrays, numeric years, and supported URL schemes. Show an intelligible panel-level failure if a chart cannot render. Prefer a visible ranking fallback if the externally loaded D3 network dependency is unavailable.

### 12. P2 — Tighten corpus and crawl completeness checks

**Location:** `data_prep/generate_word_data.py:129`, `data_prep/scrape_publications.py:250`, refresh workflow guards.

An unreadable unit manifest falls back to including all text files in the combined corpus. Missing expected unit files are not explicitly rejected. The publication crawler only rejects an empty first listing page; empty intermediate pages can silently reduce the result, and the workflow's 90% guard permits smaller losses. Word checks based only on total word counts cannot identify which projects disappeared.

**Recommendation:** make malformed manifests an error in production mode, verify expected unit stems, detect unexpected empty/repeated pagination, and compare slug/project sets as well as counts. Report additions/removals for review. Keep an explicit permissive mode for exploratory local inputs if useful.

### 13. P2 — Give cancelled word layouts a settled outcome

**Location:** `units_wordcloud/src/components/wordcloud/LayoutManager.js:94`, `WordCloud.js`.

Starting a replacement layout stops the previous D3 run and replaces its `end` callback, but the previous `layoutWords()` promise has no explicit resolution or rejection path. Destruction has the same issue. Redraw errors also propagate from an async function called by `requestAnimationFrame` without a local catch.

**Recommendation:** model cancellation explicitly, settle superseded work, gate final drawing on a generation token, and surface actual failures through the store. Inject the layout dependency rather than reading global `d3`, making cancellation testable without a browser canvas.

## Refactoring opportunities

### Simplify the cloud's event system

Repository search found event emissions and middleware but no application `eventBus.on(...)` subscribers. Actual coordination now uses store subscriptions and direct callbacks. The bus is effectively an asynchronous logging/validation route, while its comments still describe cross-component coordination. `WORD_CLICK` currently has no downstream behavior.

Remove unused event types and middleware pathways, or retain a deliberately small diagnostics hook. Put validation at action/service boundaries. Do not replace the dashboard's simpler store with the cloud's bus solely for architectural symmetry.

### Render only affected views

The store memoizes filtered arrays, but clears every selector cache for every state update, and the composition root recomputes rankings/network data and redraws every panel. Accepting a search suggestion can produce two complete renders: clearing search, then toggling the entity.

Introduce atomic filter actions and selectors keyed by their actual dependencies. Split data changes from selection-only changes. Update existing rows and chart attributes rather than rebuilding controls. At 1,962 records this is mainly an interaction-quality improvement; no measured CPU bottleneck warrants a worker, database, or visualization framework migration yet.

### Consolidate repeated primitives carefully

Share stable locale/path utilities, a small DOM helper, and accessible paging behavior where their contracts genuinely match. Keep domain-specific state and chart components separate. The existing shared token layer is already valuable; migrate legacy CSS aliases gradually during nearby edits rather than scheduling a large cosmetic rename.

### Improve deterministic generation and provenance

Use temporary files plus atomic replacement for generated outputs. Add schema version and content identity so a dataset can be cited without inserting a changing timestamp into every record. Track “last successful refresh” separately from “data last changed.” Bound cache age or rotate detail-page refreshes to discover edits that do not change listing fingerprints.

Move reusable workflow checks from embedded shell/Python blocks into tested scripts. Generate or verify landing-page fallback figures: the runtime fetch updates them, but the repository contains no refresh step that maintains the hardcoded English/German fallback figures and previews.

### Make the cloud stable between redraws

Rotation uses `Math.random()` and placement is not seeded. Identical reloads produced visibly different arrangements. A seed based on unit and configuration would improve comparison, exports, and screenshot testing. An explicit “Rearrange” action can retain variety. Document that font size is a visual frequency encoding with clamps, not a precise area-proportional chart.

## Visualization opportunities, ranked

### 1. Research-unit vocabulary comparison — strongest next feature

**Question:** what distinguishes the three units, and what vocabulary do they share?

Use an aligned term-by-unit heatmap or dot plot, with counts and occurrences per 1,000 retained tokens. Allow sorting by overall frequency or distinctiveness and show all three values for a selected term. For mobile, use a readable comparison table or three aligned bars per selected term.

**Data work:** the current exports contain only the top 100 terms per unit and no full token denominators. Export a complete term matrix and per-unit corpus totals. Do not treat a term absent from a top-100 file as zero. Use minimum counts and explain any distinctiveness statistic.

The source manifest has 30 project entries for State and Society, 12 for Lives and Ecologies, and 16 for Religion and Intellectual Culture, including umbrella entries. Unequal corpus size makes raw counts unsuitable for direct unit comparison. Word frequency describes the sampled descriptions, not the institute's allocation of research effort.

### 2. Publication-type small multiples and percentage view

**Question:** how has the composition of the register changed over time?

Offer count and percentage modes, with small multiples for types when comparing their trends. Use the existing fixed type mapping and shared year axis. The data already supports this; no new scrape is needed.

Add a visible note that the latest calendar year may be incomplete and older coverage may reflect registration practices. In the current data, 2026 has 31 dated records and 2025 has 69; that is not sufficient evidence of a decline in actual research output. Surface the 9 undated and 35 untyped records near the chart or in a methodology disclosure.

### 3. Author publication timelines

**Question:** when did a selected author's registered publications appear, and in which forms?

Use selectable author rows against years, with count intensity or small bars; keep direct access to publications in each cell. Support a small named comparison set selected through the existing autocomplete rather than only showing top-ranked authors.

Use “publications in the register” and “first/last recorded publication.” The data does not establish employment periods, researcher productivity, citation impact, or complete personal bibliographies.

### 4. Collaboration table and ego-network view

**Question:** who publishes with a selected author, how often, and in what years?

Keep the network for discovery but add a ranked collaborator table with shared-publication counts, years, and links to the contributing records. Make the author-focused view an obvious entry point. Add a legend explaining node size and edge width; currently node size includes all selected-scope publications, not only collaborations.

The normalized dataset has 1,532 single-author records, 426 with multiple authors, and 4 with no normalized author. A solo/multiple-author trend could complement the graph, but label it as recorded authorship: editorial roles and incomplete author lists limit interpretation.

### 5. Publication-family explorer

**Question:** which chapters belong to a volume, and which volumes connect several ZMO contributors?

Use an expandable volume → chapters tree or grouped bibliography, with links back to source records. This is likely easier to read than a second force-directed graph.

The raw data has 722 records with `published_in` and 188 with `contributions`. These fields are omitted from the dashboard payload. Resolve links to stable publication IDs, deduplicate relationships, and represent external/unresolved parent volumes explicitly before building the view. Do not count a volume and its chapters as interchangeable outputs.

### 6. Keyword-in-context explorer

**Question:** what does a prominent word mean in the actual research descriptions?

Let a term open short source passages grouped by project/unit. This would give the cloud's current unused click event a meaningful purpose. Preserve paragraph text, project identity, and source URL together during scraping, and retain the mapping from original tokens to lemmas.

This is a better initial use of text than an opaque topic model: readers can check the evidence. A publication-abstract topic view would use only 511 of 1,962 records (26.0%) unless enriched; it must disclose that subset.

### Defer a research geography map

The raw data has publication `places` on 885 records, but these are publishing locations, not necessarily places studied. There are no curated research-place coordinates in the current dashboard schema. A research map needs explicit location extraction, disambiguation, source evidence, and human review. Likewise, current unit affiliations cannot simply be attached retrospectively to historical publications.

## Visual and interaction design direction

1. **Preserve the editorial identity.** Improve legibility within the current warm-paper/navy system. Keep one hue for quantitative rankings and categorical color for document types. Avoid adding decorative charts merely to fill space.
2. **Explain how to read each view.** Distinguish the filtered result total from chart facets that intentionally exclude their own filter. For example, a type ranking may still show all alternatives when the result count is 498; a short scope caption would prevent apparent inconsistency.
3. **Improve dashboard structure.** The two-column grid places the venue panel alone before the full-width network, leaving an unused cell. Make venue analysis full-width where useful, or regroup panels by the questions they answer. Put a “View publications” jump near the result count and provide a compact way back to filters after scrolling.
4. **Use progressive disclosure for complex analysis.** Keep the timeline and filters prominent; place network exploration behind an explicit section or expandable panel if testing shows the long page obstructs access to records. Do not hide access to the underlying data.
5. **Make empty states actionable.** Explain which selection produced no matches and provide a nearby clear-last-filter action. Offer a text/table fallback when a visualization fails.
6. **Expose methodology in the interface.** Explain source coverage, normalization, English source text on German controls, and what cloud occurrence totals count. The README currently carries details that ordinary visitors will never see.
7. **Make outputs reusable.** Add filtered CSV download and shareable view URLs first. Then add SVG/PNG chart exports carrying the selected scope, source, and dataset identity. Reuse the existing font-embedding export work. Citation export needs richer bibliographic fields; the current slim payload is insufficient for consistently complete references.

## Suggested implementation sequence

| Phase | Work | Completion condition |
|---|---|---|
| 1 — Reliability and access | Explicit validation/deploy, lifecycle handling, focus retention, contrast, mobile list | Refresh demonstrably publishes; navigation and keyboard workflows work; exact counts remain available on mobile. |
| 2 — Correctness and sharing | Graph invalidation, normalization fixtures, URL state, mobile axes, dataset contracts | Reproducible filter links; documented transformations have passing behavior tests. |
| 3 — Comparative analysis | Full term matrix, unit comparison, type trends, author timelines | Every visual has an explicit question, denominator, and route to supporting records. |
| 4 — Context and relationships | Project passages, collaborator table, publication families, exports | Readers can move from a visual pattern to attributable source evidence and reuse the result. |

The first feature I would build after the reliability/accessibility pass is the **research-unit vocabulary comparison**, followed by **publication-type small multiples**. Both add a new analytical capability while fitting the existing architecture and design.
