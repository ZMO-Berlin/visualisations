# Implementation record — 12 September 2026

This implements the repository review in `repository-review-2026-09-12.md` while
retaining static ES modules, the existing English/German routes, shared typography
and tokens, and the Python scrape → generate pipeline. No framework or frontend
package manager was introduced.

## Review coverage

| Review item | Implementation |
| --- | --- |
| 1. Reliable refresh and deployment | Explicit Deploy Pages workflow after successful validation/refresh; test and regenerate the exact checkout; public-file allowlist; separate refresh timestamps. |
| 2. Back/forward lifecycle | Shared lifecycle helper suspends persisted pages, resumes visualization work and destroys only on a final exit. |
| 3. Keyboard focus | Shared keyed focus restoration for rebuilt rows/chips/pagers; atomic suggestion acceptance; venue controls use native button-group semantics. |
| 4. Readability | Readable soft/faint ink tokens, larger hints/metadata and controls; automated 4.5:1 checks on supported surfaces. |
| 5. Mobile word counts | Explicit frequency-list view, native term buttons, localized SVG labels, source passages reachable by keyboard. |
| 6. Network invalidation | Signature includes node identities/counts and actual edge endpoints/weights; retain positions when rebuilding. |
| 7. Initials | Equal-token initial expansion only with a unique fuller candidate; ambiguous matches stay separate. |
| 8. Mobile timeline | Scrollable, keyboard-focusable chart region with a readable minimum width; suppress colliding edge ticks. |
| 9. URL state | Filter, unit, count, view, term, comparison search/sort round trips; language links preserve query/hash; initial-resize race covered. |
| 10. Regression coverage | Node behavior tests, Python fixtures and a browser DOM/canvas harness. |
| 11. Contracts/failures | Validate publication/vocabulary/family schemas and links; panel failures do not stop the publication list; retry and clear-filter states. |
| 12. Crawl/corpus guards | Fail on missing/duplicate unit manifests, missing source files/project boundaries, repeated/empty intermediate pages, and excessive lost identities/corpus size. |
| 13. Layout cancellation | Every superseded layout settles; generation tokens suppress stale drawing; errors are handled; injected layout factory. |

## New exploration features

- **Vocabulary comparison:** full term-by-unit matrix, absolute counts and counts
  per 1,000 retained tokens, overall/difference sorting, minimum-count disclosure,
  search, pagination and CSV. No inference of zeros from top-100 lists.
- **Document types over time:** count/percentage small multiples on shared axes,
  explicit denominator and an exact-value table, including missing document types.
- **Author timelines:** selected authors or the six most represented authors;
  clickable year counts focus the matching publication list.
- **Shared publications:** ranked pairs with exact shared records and source links;
  selecting authors narrows the collaborator list to their pairs.
- **Volumes and chapters:** 473 deduplicated families, with external references
  distinguished from registered volumes. Matching one record shows its family for
  context, as explained in the interface.
- **Source passages:** original English paragraphs matched through the same
  lemmatization pipeline and attributed to exact project/unit headings and URLs.

The dashboard exports filtered publication CSV and dated publication totals as
SVG/PNG, including full scope, source and dataset identity. The word explorer
exports the comparison matrix and retains its cloud PNG exporter. Metadata about
coverage, English text, normalization and interpretation is visible in both locales.

The network and analysis sections are expandable. Venue analysis spans the full
width; results and filters have jump links. Quantitative and categorical colors
retain their existing meanings.

## Refactoring and data changes

Unused cloud event-bus/middleware code is removed. Store subscriptions and direct
callbacks now own coordination. DOM construction, focus restoration, paging,
URL/lifecycle handling, downloads and analytical strings/styles are shared. The
stores remain domain-specific. Dashboard selector caches depend on relevant
filters and derived rankings/graphs are reused; selection-only changes do not
rebuild unchanged ranked data or network layouts.

Generated files use atomic replacement. Publication metadata and vocabulary have
schema versions and deterministic content identities. Landing fallback counts and
previews are generated and checked. Refresh jobs compare stable identities and
rotate a full publication-detail refresh quarterly. Deployment writes refresh
workflow dates separately from committed content.

The normalized register still contains **1,962 records**, covering **1994–2026**,
with **9 undated** and **35 untyped** records. Four additional unique initial
expansions reduce the author count from **656 to 652**; no raw records were deleted.
The full vocabulary contains **8,065 retained tokens** from the three units and
58 project entries. Source text remains unchanged.

NLTK was advanced from 3.10.1 to the registry-verified 3.10.3 maintenance release.
The former blocked imports from dependencies inside a repository-local virtual
environment. The new release installs and regenerates successfully. Existing
frontend dependencies were retained; new Pages action versions were verified
against their official releases before pinning.

## Verification

- 14 Node behavior tests pass, including real generated vocabulary/family contracts,
  selector/URL semantics, cancellation, graph signatures, CSV escaping and contrast.
- 12 Python tests pass, including source fixtures, identity guards, conservative
  normalization, project attribution and family deduplication.
- `validate_outputs.py` regenerates both applications in temporary directories and
  confirms all JSON and English/German landing fallbacks match.
- All application/test JavaScript files pass `node --check`; Python syntax,
  local JavaScript import paths, JSON and all four workflow YAML files validate.
- `/tests/browser.html`: six browser checks pass for focus, CSS intensity,
  localized SVG/canvas PNG, persisted lifecycle, the initial shared-URL race and
  missing cloud dependencies.
- Browser smoke checks cover English/German views, mobile 390px layout, restored
  comparisons, source passages, percentage mode, author rows, family pagination,
  network expansion and export handlers. Mobile page width does not overflow;
  wide charts/tables scroll within their own regions. Export generation/rasterization
  passed; the in-app browser did not expose a download-completion event, so native
  save-dialog completion was not asserted.

Browser tests are a manual served harness; Node/Python tests and syntax/data
checks run in CI. The live source was not recrawled during implementation: all
new outputs derive from the existing committed corpus/register.

## Publishing and deliberate limits

At the initial implementation handoff, no commit, push, production deployment or
repository Pages setting change had been performed. The user subsequently
authorized committing and pushing to main and will change the Pages setting. For migration from branch-based hosting,
select **GitHub Actions** as the Pages source and run **Deploy Pages** after these
changes reach `main`. A successful hosted Actions run remains to be observed.

The research geography map remains deliberately deferred: publisher locations do
not establish research locations, and no curated coordinates exist. Citation
exports, abstract topic models, retrospective affiliations and a random rearrange
button were optional proposals, not implemented analytical requirements. The cloud
is deliberately deterministic. The site continues to describe the register and
sampled text rather than claiming productivity, employment or research-impact
measurements.

## Integration before publishing

Before committing, upstream refresh commits `f68ea86` and `c790165` were integrated.
All derived datasets and landing fallbacks were regenerated from those new source
files. The integrated snapshot has **1,976 publications**, **668 normalized
authors**, **8,362 retained tokens**, **61 project entries** and **477 volume
families**. The figures above document the earlier implementation snapshot.
The generated metadata conflict was resolved by regeneration, preserving the
upstream additions. The Node/Python suites and reproducibility checks were rerun
against the integrated data before the commit.
