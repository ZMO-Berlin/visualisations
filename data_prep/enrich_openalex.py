#!/usr/bin/env python3
"""Match the publication register to OpenAlex works.

Reads ``raw_data/publications.json`` (written by ``scrape_publications.py``) and
writes ``raw_data/openalex.json``: for every register record OpenAlex knows, the
OpenAlex work with its open-access status, language, primary topic, authors
(with ORCID iDs and whether they wrote it at ZMO), institutions, funders and
reference list; the literature that two or more register works cite; and the
citations between register works. A gap report for ZMO's library,
``reports/openalex-gaps.csv``, lists ZMO-affiliated OpenAlex works the register
does not have and register DOIs OpenAlex does not know. It is not deployed.

Records are matched in three steps, each only for what the previous left over:

  1. **DOI.** The register's DOI field is typed by hand — URLs, ``DOI:``
     prefixes, a trailing ``/pdf`` and the odd URN all occur — so it is
     normalised first, and a value that is not a DOI at all is not looked up.
  2. **ZMO affiliation.** Every work OpenAlex attributes to ZMO is fetched and
     compared locally with the records that have no DOI match.
  3. **Title search** for the rest. Book reviews are excluded: a review's title
     is the reviewed book's title, so a title search finds the book itself.
     Reviews are matched by DOI or by affiliation only.

Steps 2 and 3 accept a candidate only when the accent-folded titles are at least
90% similar, the years are no more than one apart and, when both sides list
authors, at least one surname is shared. A work OpenAlex lists without authors
is accepted only as the book form of an edited volume, monograph or chapter,
where OpenAlex often omits the editors. When two candidates are equally good
the record is left unmatched rather than guessed. One OpenAlex work belongs to
at most one register record; when two claim it, the better match keeps it and
the other is listed under ``conflicts``.

OpenAlex prices requests: a filtered list costs a tenth of a search, and a free
API key buys $1 a day. One title search per record would be ~1,700 searches,
more than a day's budget, so title searches are combined with OpenAlex's ``|``
(OR) syntax, about fifteen titles per request, grouped by year so they can share
one year filter. A batch that returns too many results is split in half until
it does not. Titles with fewer than three words of four letters or more —
"Introduction", "About the book" — are searched one record at a time together
with the first author's surname: alone they match thousands of works, many of
them authorless front matter that the surname check cannot reject. DOI and id
lookups are batched fifty to a request. Paging is by page number: cursor
paging needs an API key.

List queries leave out OpenAlex's expansion corpus (repository and DataCite
records, ``is_xpac``) unless asked. DOI and id lookups and the affiliation
fetch include it: an identifier names one record, and ZMO's own DOIs
(10.58144) exist only there. Title search does not: there the wider corpus
would mostly add repository copies of works the main corpus already has, which
would tie with them and turn matches into refusals. Referenced works OpenAlex has deleted, but whose ids reference lists
still carry, are dropped.

Abstracts are not copied: OpenAlex distributes them, but they belong to the
publishers, and the register has its own. Everything else OpenAlex returns is
CC0.

The output file is also the cache, as ``publications.json`` is the scraper's.
Each record carries a fingerprint of the register fields matching reads. While
it is unchanged, a matched record keeps its match, with the work refreshed by
id so that open-access status, citation counts and references stay current,
and a record matched without success (listed under ``searched``) is not
searched for again. New and edited records, and records whose work OpenAlex has
withdrawn, go through all three steps; the DOI lookup and the affiliated works
are fetched every time. A monthly run is then a few dozen filtered lists
instead of hundreds of searches. ``--refresh-all`` ignores the cache: for the
quarterly full pass, and after any change to the matching rules.

The output is built in memory and written atomically, sorted, without a run
timestamp. Any request that still fails after retries stops the run with a
non-zero exit and leaves the previous files untouched: a partial file would
quietly shrink the published coverage.

Environment:
    OPENALEX_API_KEY   optional; raises the daily budget and is sent as a
                       bearer token, so it never appears in a URL or a log
    OPENALEX_MAILTO    optional contact address for OpenAlex's polite pool

Usage:
    python data_prep/enrich_openalex.py                    # reuse the previous output
    python data_prep/enrich_openalex.py --refresh-all      # match every record afresh
    python data_prep/enrich_openalex.py --dry-run          # report, write nothing
    python data_prep/enrich_openalex.py --limit 50         # a quick sample
    python data_prep/enrich_openalex.py --no-title-search  # DOI and affiliation only
    python data_prep/enrich_openalex.py --cache-dir /tmp/openalex   # development only
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import quote, unquote, urlencode

import requests

from generate_publication_data import PARTICLES, canonical_name, fold, split_authors
from output import atomic_json, atomic_text, identity
from zmo_site import USER_AGENT_SUFFIX, configure_console

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = SCRIPT_DIR / "raw_data" / "publications.json"
DEFAULT_OUTPUT = SCRIPT_DIR / "raw_data" / "openalex.json"
DEFAULT_REPORT = SCRIPT_DIR / "reports" / "openalex-gaps.csv"

API_URL = "https://api.openalex.org"
SOURCE = "https://openalex.org"
INSTITUTION = {
    "id": "I2801953415",
    "ror": "https://ror.org/03ty9wj75",
    "name": "Leibniz-Zentrum Moderner Orient",
}
USER_AGENT = f"ZMO-OpenAlex-Enrichment/1.0 {USER_AGENT_SUFFIX}"

# Match methods, strongest first. The order decides conflicts: a DOI match
# keeps a work that a title match also claims.
METHODS = ("doi", "affiliation", "title")

# A review is titled after the book it reviews, so a title search would find
# the book. Reviews are matched by DOI or affiliation only.
REVIEW_TYPE = "Book reviews"

SIMILARITY_THRESHOLD = 0.9
YEAR_TOLERANCE = 1

# An OpenAlex work without authors leaves the surname check nothing to compare.
# OpenAlex often lists an edited volume without its editors, so the book form
# of a volume or a chapter is still accepted; anything else is refused. In a
# trial run without this rule, a quarter of such matches were wrong: anonymous
# reviews titled after the book, and namesakes in medical and engineering
# journals.
AUTHORLESS_TYPES = {
    "Edited volumes": {"book"},
    "Monographs": {"book"},
    "Contributions to an edited volume": {"book-chapter"},
}
# A referenced work enters ``references`` when this many register works cite it.
MIN_CITING_WORKS = 2

# Values combined with "|" in one filter. OpenAlex accepts up to 100; fifty
# keeps a URL of DOIs comfortably short.
ID_BATCH = 50
PER_PAGE = 200
# Titles per OR-combined search, and a ceiling on the encoded filter so a batch
# of long or non-Latin titles does not produce an over-long URL.
SEARCH_BATCH = 15
SEARCH_URL_BUDGET = 3000
# OpenAlex title search requires every word, so a long title with one word
# spelled differently would find nothing. The first twelve words are specific
# enough; similarity is still judged on the whole title.
MAX_SEARCH_WORDS = 12
# A title needs this many words of SPECIFIC_WORD_LENGTH letters or more to be
# batched. "Introduction" or "About the book" alone matches thousands of works a
# year, many of them authorless front matter that the surname check cannot
# reject, so such titles are searched together with the author's surname.
MIN_SPECIFIC_WORDS = 3
SPECIFIC_WORD_LENGTH = 4
# A batch with more results than this many pages is split rather than paged.
MAX_SEARCH_PAGES = 3

# ``select`` keeps responses small. Abstracts are deliberately absent.
DETAIL_FIELDS = ",".join((
    "id", "doi", "title", "publication_year", "type", "language", "open_access",
    "cited_by_count", "primary_topic", "authorships", "funders", "referenced_works",
))
CANDIDATE_FIELDS = "id,doi,title,publication_year,type,authorships"
REFERENCE_FIELDS = "id,doi,title,publication_year,authorships"

RETRY_STATUS = {429, 500, 502, 503, 504}

# Register fields whose change sends a record back through matching, and the
# length of the hash kept of them. Ten hex digits only ever have to tell one
# record's old fields from its new ones.
FINGERPRINT_FIELDS = ("title", "subtitle", "authors", "year", "document_type", "doi")
FINGERPRINT_LENGTH = 10

GAP_COLUMNS = ("kind", "id_or_slug", "title", "year", "doi", "type")

DOI_PATTERN = re.compile(r"10\.\d{4,9}/\S+")
# Path segments publisher links append after the DOI ("…/01066.x/pdf").
DOI_SUFFIX = re.compile(r"/(pdf|epdf|abstract|full|fulltext)$")
# "Original (Translation)" and "Original [Translation]" titles: the register
# often gives both, OpenAlex usually one or the other.
TRAILING_GLOSS = re.compile(
    r"^(?P<head>.*\S)\s*(?:\((?P<round>[^()]+)\)|\[(?P<square>[^\[\]]+)\])\s*$"
)
# Removed outright rather than turned into a space, so "l'histoire" and
# "l’histoire" agree and "baʿḍ" (with an ʿayn) meets "bad" or "ba'd".
APOSTROPHES = set("'’‘ʼʻ`´ʹ")


class OpenAlexError(RuntimeError):
    """An OpenAlex request failed in a way that retrying will not fix.

    Raised rather than skipped: carrying on would write a file that silently
    covers fewer publications than the last one.
    """


# ---------------------------------------------------------------------------
# HTTP


class OpenAlexClient:
    """GET requests to the OpenAlex API with retries, a delay and a cost tally."""

    def __init__(self, api_key: str | None = None, mailto: str | None = None,
                 delay: float = 0.15, timeout: float = 60.0, retries: int = 5,
                 cache_dir: Path | None = None) -> None:
        self.mailto = mailto
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.cache_dir = cache_dir
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        if api_key:
            # A header rather than ``api_key=`` keeps the key out of every URL,
            # and so out of error messages, logs and cache keys.
            self.session.headers["Authorization"] = f"Bearer {api_key}"
        self.requests = 0
        self.cache_hits = 0
        self.cost = 0.0
        self._last_request = 0.0

        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def get(self, path: str, params: dict | None = None) -> dict:
        query = urlencode(sorted((params or {}).items()))
        url = f"{API_URL}{path}" + (f"?{query}" if query else "")

        cached = self._cache_path(url)
        if cached and cached.exists():
            self.cache_hits += 1
            return json.loads(cached.read_text(encoding="utf-8"))

        text = self._request(url)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as error:
            raise OpenAlexError(f"{url} did not return JSON: {error}") from None

        if cached:
            cached.write_text(text, encoding="utf-8")
        return payload

    def _request(self, url: str) -> str:
        # The contact address is added here, after the cache key was taken, so
        # setting or changing it does not invalidate a development cache.
        target = url
        if self.mailto:
            target += ("&" if "?" in url else "?") + urlencode({"mailto": self.mailto})

        last_error = ""
        for attempt in range(1, self.retries + 1):
            self._throttle()
            wait = 2 ** (attempt - 1)
            try:
                response = self.session.get(target, timeout=self.timeout)
            except requests.RequestException as error:
                last_error = str(error)
            else:
                self.requests += 1
                self.cost += _header_float(response, "X-RateLimit-Cost-USD")
                if response.status_code == 200:
                    return response.text
                if response.status_code not in RETRY_STATUS:
                    raise OpenAlexError(
                        f"HTTP {response.status_code} for {url}: {response.text[:300]}"
                    )
                if response.status_code == 429 and _budget_spent(response):
                    raise OpenAlexError(
                        "the OpenAlex daily budget is spent (HTTP 429); run again "
                        "after it resets, or set OPENALEX_API_KEY"
                    )
                last_error = f"HTTP {response.status_code}"
                wait = max(wait, int(_header_float(response, "Retry-After")))

            if attempt < self.retries:
                print(f"  retry {attempt}/{self.retries - 1} in {wait}s: {last_error}",
                      file=sys.stderr)
                time.sleep(wait)

        raise OpenAlexError(f"could not fetch {url}: {last_error}")

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_request = time.monotonic()

    def _cache_path(self, url: str) -> Path | None:
        if not self.cache_dir:
            return None
        return self.cache_dir / f"{hashlib.sha256(url.encode('utf-8')).hexdigest()[:32]}.json"


def _header_float(response: requests.Response, name: str) -> float:
    try:
        return float(response.headers.get(name) or 0)
    except ValueError:
        return 0.0


def _budget_spent(response: requests.Response) -> bool:
    """A 429 from an empty budget, as opposed to one from going too fast."""
    remaining = response.headers.get("X-RateLimit-Remaining-USD")
    try:
        return remaining is not None and float(remaining) <= 0
    except ValueError:
        return False


def fetch_page(client: OpenAlexClient, filter_: str, select: str, page: int,
               expansion: bool = False) -> tuple[list[dict], int]:
    """One page of a filtered list; returns (works, total count).

    ``expansion`` adds OpenAlex's expansion corpus (``is_xpac``: repository and
    DataCite records), which list queries leave out by default although a
    lookup by id returns it.
    """
    params = {"filter": filter_, "select": select, "per-page": PER_PAGE, "page": page}
    if expansion:
        params["include_xpac"] = "true"
    data = client.get("/works", params)
    if not isinstance(data.get("results"), list) or not isinstance(data.get("meta"), dict):
        raise OpenAlexError(f"unexpected response shape for filter {filter_!r}")
    return data["results"], data["meta"].get("count") or 0


def fetch_pages(client: OpenAlexClient, filter_: str, select: str,
                max_pages: int | None = None, first_page: int = 1,
                expansion: bool = False) -> tuple[list[dict], int]:
    """Results of one filtered list, page by page; returns (works, total count)."""
    works: list[dict] = []
    page = first_page
    while True:
        results, count = fetch_page(client, filter_, select, page, expansion)
        works.extend(results)
        fetched = (page - 1) * PER_PAGE + len(results)
        if not results or fetched >= count or (max_pages and page >= max_pages):
            return works, count
        page += 1


def fetch_by_values(client: OpenAlexClient, key: str, values: list[str],
                    select: str) -> list[dict]:
    """Works whose ``key`` is one of ``values``, fifty values per request.

    Identifier lookups include the expansion corpus: an identifier names one
    record, so the wider corpus can only add matches. ZMO's own DOIs
    (10.58144) are there and nowhere else.
    """
    works: list[dict] = []
    for start in range(0, len(values), ID_BATCH):
        chunk = values[start:start + ID_BATCH]
        found, _ = fetch_pages(client, f"{key}:{'|'.join(chunk)}", select, expansion=True)
        works.extend(found)
    return works


def fetch_by_dois(client: OpenAlexClient, dois: list[str]) -> dict[str, list[dict]]:
    """Map each DOI OpenAlex knows to its works (normally one)."""
    # A comma or a pipe would be read as filter syntax. No DOI in the register
    # has one today; if one appears it is looked up on its own, which is free.
    safe = [doi for doi in dois if "," not in doi and "|" not in doi]
    works = fetch_by_values(client, "doi", safe, DETAIL_FIELDS)
    for doi in sorted(set(dois) - set(safe)):
        found, _ = fetch_pages(client, f"doi:{quote(doi, safe='/')}", DETAIL_FIELDS,
                               expansion=True)
        works.extend(found)

    by_doi: dict[str, list[dict]] = defaultdict(list)
    seen: set[str] = set()
    for work in works:
        work_id = short_id(work.get("id"))
        doi = bare_doi(work.get("doi"))
        if work_id and doi and work_id not in seen:
            seen.add(work_id)
            by_doi[doi].append(work)
    return dict(by_doi)


def fetch_affiliated(client: OpenAlexClient) -> list[dict]:
    """Every work with at least one authorship at ZMO, in either corpus."""
    works, count = fetch_pages(
        client, f"institutions.id:{INSTITUTION['id']}", DETAIL_FIELDS, expansion=True
    )
    if len(works) < count:
        raise OpenAlexError(
            f"OpenAlex reported {count} ZMO-affiliated works but returned {len(works)}"
        )
    return unique_works(works)


# ---------------------------------------------------------------------------
# Identifiers and text


def short_id(value: str | None) -> str | None:
    """``https://openalex.org/W123`` → ``W123``."""
    if not value:
        return None
    return value.rstrip("/").rsplit("/", 1)[-1]


def bare_orcid(value: str | None) -> str | None:
    """``https://orcid.org/0000-0001-…`` → ``0000-0001-…``."""
    if not value:
        return None
    return value.rstrip("/").rsplit("/", 1)[-1]


def bare_doi(value: str | None) -> str | None:
    """OpenAlex's ``https://doi.org/10.…`` → ``10.…``."""
    return normalise_doi(value) if value else None


def id_key(value: str) -> tuple[str, int, str]:
    """Sort key putting W9 before W10, so sorted ids read in numeric order."""
    digits = value[1:]
    return value[:1], int(digits) if digits.isdigit() else -1, value


def normalise_doi(value: str | None) -> str | None:
    """The DOI in a hand-typed DOI field, lowercased, or None if there is none.

    Handles ``https://doi.org/``, ``http://dx.doi.org/``, ``doi:`` and
    ``DOI: `` prefixes, publisher links with the DOI in their path, stray
    spaces, a trailing ``/pdf`` and trailing punctuation. URNs, handles and
    ISBN fragments are not DOIs and return None rather than a guess.
    """
    if not value:
        return None
    text = unquote(str(value)).strip().lower()
    if "://" in text:
        text = re.split(r"[?#]", text, maxsplit=1)[0]
    match = DOI_PATTERN.search(text)
    if not match:
        return None

    doi = match.group(0)
    previous = None
    while doi != previous:
        previous = doi
        doi = DOI_SUFFIX.sub("", doi).rstrip(".,;:'\"")
        for opening, closing in ("()", "[]", "<>"):
            # A closing bracket is part of the DOI only when it closes one
            # opened inside it: "10.5429/2079-3871(2024)v14i2.9en" keeps its
            # parentheses, "(10.1234/abc)" loses the last one.
            if doi.endswith(closing) and doi.count(opening) < doi.count(closing):
                doi = doi[:-1]
    return doi if DOI_PATTERN.fullmatch(doi) else None


def normalise_title(text: str) -> str:
    """Accent-folded, lowercased, punctuation-free, whitespace-collapsed text.

    Letters of every script are kept, as in ``merge_key``: an Arabic or
    Chinese title must not normalise to the empty string.
    """
    characters = []
    for char in fold(text or ""):
        if char in APOSTROPHES or unicodedata.category(char) in ("Lm", "Sk"):
            continue
        characters.append(char if char.isalnum() else " ")
    return " ".join("".join(characters).split())


def title_parts(title: str) -> list[str]:
    """The title, and for "Original (Translation)" titles both halves.

    A half is kept only when it has a few words of its own, so "(1914-1918)"
    or "(Arabic)" is not treated as a title.
    """
    if not title:
        return []
    parts = [title]
    match = TRAILING_GLOSS.match(title)
    if match:
        for part in (match["head"], match["round"] or match["square"]):
            if is_specific(normalise_title(part)):
                parts.append(part.strip())
    return parts


def is_specific(text: str) -> bool:
    """Whether a title has enough substantial words to search on its own."""
    return sum(1 for word in text.split() if len(word) >= SPECIFIC_WORD_LENGTH) >= MIN_SPECIFIC_WORDS


def search_text(phrase: str, folded: bool = False) -> str:
    """A phrase reduced to words OpenAlex's title search can take.

    OpenAlex search does not fold accents, so a phrase is searched both as
    written and folded. Lowercasing keeps "AND", "OR" and "NOT" in a title
    from being read as operators; dropping punctuation keeps commas, pipes and
    colons from being read as filter syntax.
    """
    if folded:
        text = normalise_title(phrase)
    else:
        text = "".join(char if char.isalnum() else " " for char in phrase.lower())
    return " ".join(text.split()[:MAX_SEARCH_WORDS])


def similarity(variants: tuple[str, ...] | list[str], target: str) -> float:
    """The best SequenceMatcher ratio between any variant and ``target``."""
    best = 0.0
    for variant in variants:
        matcher = SequenceMatcher(None, variant, target, autojunk=False)
        # The cheap upper bounds skip most hopeless pairs.
        if matcher.real_quick_ratio() > best and matcher.quick_ratio() > best:
            best = max(best, matcher.ratio())
    return best


def unique(values) -> list:
    return list(dict.fromkeys(value for value in values if value))


def unique_works(works: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for work in works:
        work_id = short_id(work.get("id"))
        if work_id and work_id not in seen:
            seen[work_id] = work
    return list(seen.values())


def compact(mapping: dict) -> dict:
    """Drop empty values: a missing key means "OpenAlex has nothing here"."""
    return {key: value for key, value in mapping.items() if value not in (None, "", [], {})}


# ---------------------------------------------------------------------------
# Register records and OpenAlex candidates


@dataclass(frozen=True)
class Record:
    """A register record, reduced to what matching needs."""

    slug: str
    title: str = ""
    year: int | None = None
    document_type: str = ""
    doi: str | None = None
    # Normalised titles to compare: the title, "title: subtitle", and the
    # halves of an "Original (Translation)" title.
    variants: tuple[str, ...] = ()
    # Title phrases to search for, as written.
    phrases: tuple[str, ...] = ()
    # Accent-folded surname tokens of every author.
    surnames: frozenset[str] = frozenset()
    # The first author's main surname as written, for narrowing a search.
    search_surname: str = ""
    # Hash of the register fields matching reads (see ``fingerprint``).
    fp: str = ""


def fingerprint(raw: dict) -> str:
    """A short hash of every register field that matching reads.

    Not the scraper's own ``fingerprint``, which is built from the listing and
    misses the DOI, the subtitle and the document type: an edited DOI must
    send the record back through matching.
    """
    return identity({name: raw.get(name) for name in FINGERPRINT_FIELDS})[:FINGERPRINT_LENGTH]


def author_surnames(authors: list[str]) -> tuple[frozenset[str], str]:
    """Folded surname tokens of every author, and the first author's main one.

    Particles ("al", "von", "de") are dropped unless they are the whole
    surname, so "al-Hamarneh" is compared as "hamarneh".
    """
    tokens: set[str] = set()
    first = ""
    for cell in authors:
        for raw in split_authors(cell):
            parsed = canonical_name(raw)
            if not parsed:
                continue
            words = [word for word in normalise_title(parsed[0]).split() if len(word) > 1]
            significant = [word for word in words if word not in PARTICLES] or words
            tokens.update(significant)
            if not first:
                written = [
                    word for word in "".join(
                        char if char.isalnum() else " " for char in parsed[0].lower()
                    ).split()
                    if len(word) > 1 and fold(word) not in PARTICLES
                ]
                if written:
                    first = max(written, key=len)
    return frozenset(tokens), first


def prepare_record(raw: dict) -> Record:
    title = (raw.get("title") or "").strip()
    subtitle = (raw.get("subtitle") or "").strip()
    parts = title_parts(title)
    variants = [normalise_title(part) for part in parts]
    if title and subtitle:
        variants.append(normalise_title(f"{title}: {subtitle}"))
    surnames, search_surname = author_surnames(raw.get("authors") or [])
    year = raw.get("year")
    return Record(
        slug=raw["slug"],
        title=title,
        year=year if isinstance(year, int) else None,
        document_type=raw.get("document_type") or "",
        doi=normalise_doi(raw.get("doi")),
        variants=tuple(unique(variants)),
        phrases=tuple(parts),
        surnames=surnames,
        search_surname=search_surname,
        fp=fingerprint(raw),
    )


@dataclass(frozen=True)
class Candidate:
    """An OpenAlex work, with what the acceptance rule compares precomputed."""

    id: str
    title: str
    year: int | None
    names: frozenset[str]
    type: str = ""


def candidate(work: dict) -> Candidate:
    names: set[str] = set()
    for authorship in work.get("authorships") or []:
        author = authorship.get("author") or {}
        for name in (author.get("display_name"), authorship.get("raw_author_name")):
            # Every token of the name, not only the last: OpenAlex's name order
            # is unreliable for Arabic, Turkish and East Asian names.
            names.update(word for word in normalise_title(name or "").split() if len(word) > 1)
    return Candidate(
        id=short_id(work.get("id")) or "",
        title=normalise_title(work.get("title") or work.get("display_name") or ""),
        year=work.get("publication_year"),
        names=frozenset(names),
        type=work.get("type") or "",
    )


# ---------------------------------------------------------------------------
# Matching


def assess(record: Record, work: Candidate) -> float | None:
    """The title similarity if ``work`` is acceptable for ``record``, else None.

    Acceptable means: titles at least 90% similar (the register's title, or
    title and subtitle, or either half of a translated title, against the
    OpenAlex title); years at most one apart when both are known; and at least
    one surname in common when both sides list authors. When only the register
    lists authors, the work must be the book form of a volume or chapter (see
    AUTHORLESS_TYPES).
    """
    if not work.title or not record.variants:
        return None
    if record.year and work.year and abs(record.year - work.year) > YEAR_TOLERANCE:
        return None
    if record.surnames and work.names and not record.surnames & work.names:
        return None
    if record.surnames and not work.names and \
            work.type not in AUTHORLESS_TYPES.get(record.document_type, ()):
        return None
    score = similarity(record.variants, work.title)
    return score if score >= SIMILARITY_THRESHOLD else None


@dataclass(frozen=True)
class Choice:
    """The outcome of matching one record against a set of candidates."""

    work_id: str | None
    similarity: float = 0.0
    # Set instead of ``work_id`` when the best candidates tie.
    tied: tuple[str, ...] = ()


def choose(record: Record, candidates: list[Candidate]) -> Choice | None:
    """The single best acceptable candidate, a refused tie, or None."""
    scored: dict[str, float] = {}
    for work in candidates:
        score = assess(record, work)
        if score is not None and score > scored.get(work.id, -1.0):
            scored[work.id] = score
    if not scored:
        return None

    best = max(scored.values())
    top = sorted((work_id for work_id, score in scored.items() if abs(score - best) < 1e-9),
                 key=id_key)
    if len(top) > 1:
        return Choice(None, round(best, 4), tuple(top))
    return Choice(top[0], round(best, 4))


@dataclass(frozen=True)
class Claim:
    slug: str
    work_id: str
    method: str
    similarity: float


def doi_claims(records: list[Record],
               by_doi: dict[str, list[Candidate]]) -> tuple[list[Claim], list[dict]]:
    """A claim for every record whose DOI OpenAlex knows; the rest are unresolved.

    When OpenAlex holds two works under one DOI, the one whose title is closer
    to the register's wins, then the lower id.
    """
    claims: list[Claim] = []
    unresolved: list[dict] = []
    for record in records:
        if not record.doi:
            continue
        works = by_doi.get(record.doi)
        if not works:
            unresolved.append({"slug": record.slug, "doi": record.doi})
            continue
        score, work_id = min(
            ((similarity(record.variants, work.title), work.id) for work in works),
            key=lambda pair: (-pair[0], id_key(pair[1])),
        )
        claims.append(Claim(record.slug, work_id, "doi", round(score, 4)))
    return claims, sorted(unresolved, key=lambda item: (item["slug"], item["doi"]))


def resolve_claims(claims: list[Claim]) -> tuple[dict[str, Claim], list[dict]]:
    """Give each work to one record: the strongest method, then the closest title.

    A remaining tie goes to the alphabetically first slug, so the result does
    not depend on the order claims were made in. The others are returned as
    conflicts, and stay unmatched.
    """
    by_work: dict[str, list[Claim]] = defaultdict(list)
    for claim in claims:
        by_work[claim.work_id].append(claim)

    winners: dict[str, Claim] = {}
    conflicts: list[dict] = []
    for work_id, group in by_work.items():
        ranked = sorted(group, key=lambda c: (METHODS.index(c.method), -c.similarity, c.slug))
        winners[ranked[0].slug] = ranked[0]
        conflicts.extend(
            {"slug": loser.slug, "id": work_id, "kept": ranked[0].slug}
            for loser in ranked[1:]
        )
    return (
        dict(sorted(winners.items())),
        sorted(conflicts, key=lambda item: (item["slug"], id_key(item["id"]))),
    )


# ---------------------------------------------------------------------------
# Title search


def needs_title_search(record: Record, settled: set[str]) -> bool:
    return (
        record.slug not in settled
        and record.document_type != REVIEW_TYPE
        and bool(record.phrases)
    )


def record_queries(record: Record) -> list[str]:
    """Search strings for a record: each title part, as written and folded."""
    return unique(
        text
        for phrase in record.phrases
        for text in (search_text(phrase), search_text(phrase, folded=True))
    )


@dataclass
class SearchPlan:
    # year (None when unknown) → {query: slugs of the records it serves}
    batched: dict[int | None, dict[str, set[str]]]
    # (slug, queries, year): too generic to batch; searched one record at a
    # time and narrowed by the first author's surname.
    narrowed: list[tuple[str, tuple[str, ...], int | None]]


def plan_title_searches(records: list[Record], settled: set[str]) -> SearchPlan:
    batched: dict[int | None, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    narrowed: list[tuple[str, tuple[str, ...], int | None]] = []

    for record in records:
        if not needs_title_search(record, settled):
            continue
        generic = []
        for query in record_queries(record):
            if is_specific(query):
                batched[record.year][query].add(record.slug)
            else:
                generic.append(query)
        if generic:
            narrowed.append((record.slug, tuple(generic), record.year))

    return SearchPlan(
        batched={year: dict(queries) for year, queries in batched.items()},
        narrowed=sorted(narrowed, key=lambda item: item[0]),
    )


def search_filter(queries: list[str] | tuple[str, ...], year: int | None,
                  surname: str = "") -> str:
    parts = [f"title.search:{'|'.join(queries)}"]
    if surname:
        parts.append(f"raw_author_name.search:{'|'.join(unique([surname, normalise_title(surname)]))}")
    if year:
        parts.append(f"publication_year:{year - YEAR_TOLERANCE}-{year + YEAR_TOLERANCE}")
    return ",".join(parts)


def chunk_queries(queries: list[str]) -> list[list[str]]:
    """Batches of at most SEARCH_BATCH queries and SEARCH_URL_BUDGET encoded characters."""
    batches: list[list[str]] = []
    current: list[str] = []
    length = 0
    for query in queries:
        size = len(quote(query)) + 3
        if current and (len(current) >= SEARCH_BATCH or length + size > SEARCH_URL_BUDGET):
            batches.append(current)
            current, length = [], 0
        current.append(query)
        length += size
    if current:
        batches.append(current)
    return batches


def search_batch(client: OpenAlexClient, queries: list[str],
                 year: int | None) -> tuple[list[dict], list[str]]:
    """Works matching any of ``queries``; and the queries too broad to finish.

    A batch with more results than a few pages is split in half and each half
    searched again. A single query that is still too broad returns its first,
    most relevant pages and is reported back so the caller can narrow it.
    """
    filter_ = search_filter(queries, year)
    works, count = fetch_page(client, filter_, CANDIDATE_FIELDS, 1)
    if count <= PER_PAGE:
        return works, []
    if count <= PER_PAGE * MAX_SEARCH_PAGES:
        more, _ = fetch_pages(client, filter_, CANDIDATE_FIELDS,
                              max_pages=MAX_SEARCH_PAGES, first_page=2)
        return works + more, []
    if len(queries) == 1:
        return works, list(queries)

    middle = len(queries) // 2
    first, first_broad = search_batch(client, queries[:middle], year)
    second, second_broad = search_batch(client, queries[middle:], year)
    return first + second, first_broad + second_broad


def run_title_searches(client: OpenAlexClient, plan: SearchPlan,
                       records: dict[str, Record]) -> dict[str, list[dict]]:
    """Candidate works for each searched record."""
    found: dict[str, dict[str, dict]] = defaultdict(dict)
    narrowed = list(plan.narrowed)
    total = sum(len(queries) for queries in plan.batched.values())
    done = 0

    for year in sorted(plan.batched, key=lambda value: (value is None, value or 0)):
        queries = plan.batched[year]
        for batch in chunk_queries(sorted(queries)):
            works, broad = search_batch(client, batch, year)
            # The batch's results are candidates for every record in it: they
            # share the year window, and the acceptance rule judges each one.
            for slug in set().union(*(queries[query] for query in batch)):
                for work in works:
                    found[slug].setdefault(short_id(work.get("id")), work)
            for query in broad:
                narrowed.extend((slug, (query,), year) for slug in sorted(queries[query]))
            done += len(batch)
        print(f"  {done}/{total} queries ({year or 'no year'})")

    narrowed.sort(key=lambda item: (item[0], item[1]))
    for index, (slug, queries, year) in enumerate(narrowed, start=1):
        surname = records[slug].search_surname
        works, _ = fetch_pages(client, search_filter(queries, year, surname),
                               CANDIDATE_FIELDS, max_pages=1)
        for work in works:
            found[slug].setdefault(short_id(work.get("id")), work)
        if index % 25 == 0 or index == len(narrowed):
            print(f"  {index}/{len(narrowed)} narrowed searches")

    return {slug: list(works.values()) for slug, works in found.items()}


# ---------------------------------------------------------------------------
# Output


def work_entry(work: dict, method: str, fp: str = "") -> dict:
    access = work.get("open_access") or {}
    return compact({
        "id": short_id(work.get("id")),
        "match": method,
        # The register fingerprint this match was made for; the next run keeps
        # the match while the fingerprint is unchanged.
        "fp": fp,
        "doi": bare_doi(work.get("doi")),
        "title": work.get("title") or work.get("display_name"),
        "year": work.get("publication_year"),
        "type": work.get("type"),
        "language": work.get("language"),
        "oa_status": access.get("oa_status"),
        "oa_url": access.get("oa_url"),
        "cited_by_count": work.get("cited_by_count"),
        "topic": topic_entry(work.get("primary_topic")),
        "authors": author_entries(work),
        "institutions": institution_entries(work),
        "funders": funder_entries(work),
        "referenced_works": sorted(
            {short_id(ref) for ref in work.get("referenced_works") or [] if ref}, key=id_key
        ),
    })


def topic_entry(topic: dict | None) -> dict:
    if not topic:
        return {}
    return compact({
        "id": short_id(topic.get("id")),
        "name": topic.get("display_name"),
        "subfield": (topic.get("subfield") or {}).get("display_name"),
        "field": (topic.get("field") or {}).get("display_name"),
    })


def author_entries(work: dict) -> list[dict]:
    authors = []
    for authorship in work.get("authorships") or []:
        author = authorship.get("author") or {}
        name = author.get("display_name") or authorship.get("raw_author_name")
        if not name:
            continue
        at_zmo = any(
            short_id(institution.get("id")) == INSTITUTION["id"]
            for institution in authorship.get("institutions") or []
        )
        authors.append(compact({
            "name": name,
            "id": short_id(author.get("id")),
            "orcid": bare_orcid(author.get("orcid")),
            "zmo": True if at_zmo else None,
        }))
    return authors


def institution_entries(work: dict) -> list[dict]:
    """Distinct institutions across all authorships, in order of first appearance."""
    seen: dict[str, dict] = {}
    for authorship in work.get("authorships") or []:
        for institution in authorship.get("institutions") or []:
            institution_id = short_id(institution.get("id"))
            if institution_id and institution_id not in seen:
                seen[institution_id] = compact({
                    "id": institution_id,
                    "name": institution.get("display_name"),
                    "country": institution.get("country_code"),
                    "ror": institution.get("ror"),
                })
    return list(seen.values())


def funder_entries(work: dict) -> list[dict]:
    seen: dict[str, dict] = {}
    for funder in work.get("funders") or []:
        funder_id = short_id(funder.get("id"))
        if funder_id and funder_id not in seen:
            seen[funder_id] = compact({"id": funder_id, "name": funder.get("display_name")})
    return list(seen.values())


def shared_references(entries: dict[str, dict],
                      minimum: int = MIN_CITING_WORKS) -> dict[str, int]:
    """Referenced works cited by at least ``minimum`` register works, with counts."""
    counts: Counter[str] = Counter()
    for entry in entries.values():
        counts.update(set(entry.get("referenced_works") or []))
    return {
        work_id: count
        for work_id, count in sorted(counts.items(), key=lambda item: id_key(item[0]))
        if count >= minimum
    }


def reference_entry(work: dict, count: int) -> dict:
    authors = [
        (authorship.get("author") or {}).get("display_name") or authorship.get("raw_author_name")
        for authorship in work.get("authorships") or []
    ]
    return compact({
        "title": work.get("title") or work.get("display_name"),
        "year": work.get("publication_year"),
        "authors": [name for name in authors if name][:3],
        "doi": bare_doi(work.get("doi")),
        "count": count,
    })


def citation_edges(entries: dict[str, dict]) -> list[list[str]]:
    """[citing slug, cited slug] for each register work citing another."""
    slug_of = {entry["id"]: slug for slug, entry in entries.items()}
    edges = {
        (slug, slug_of[ref])
        for slug, entry in entries.items()
        for ref in entry.get("referenced_works") or []
        if ref in slug_of and slug_of[ref] != slug
    }
    return [list(edge) for edge in sorted(edges)]


def unmatched_entries(works: list[dict], matched: set[str]) -> list[dict]:
    rows = [
        compact({
            "id": short_id(work.get("id")),
            "title": work.get("title") or work.get("display_name"),
            "year": work.get("publication_year"),
            "doi": bare_doi(work.get("doi")),
            "type": work.get("type"),
        })
        for work in unique_works(works)
        if short_id(work.get("id")) not in matched
    ]
    return sorted(rows, key=lambda row: (-(row.get("year") or 0), id_key(row["id"])))


def build_payload(records: list[Record], details: dict[str, dict],
                  winners: dict[str, Claim], conflicts: list[dict],
                  unresolved: list[dict], affiliated: list[dict],
                  referenced: dict[str, dict], searched: dict[str, str] | None = None) -> dict:
    """Assemble openalex.json from matched claims and fetched works.

    ``details`` maps work ids to full works; ``referenced`` maps the ids of
    shared references to their (shorter) records; ``searched`` maps the slugs
    of records that went through matching without success to their
    fingerprints. Every collection is sorted here, whatever order the inputs
    came in.
    """
    fps = {record.slug: record.fp for record in records}
    entries = {
        slug: work_entry(details[claim.work_id], claim.method, fps.get(slug, ""))
        for slug, claim in sorted(winners.items())
    }
    shared = shared_references(entries)
    # A shared reference OpenAlex cannot resolve is a deleted record that
    # reference lists still point to; one is "cited" by 36 unrelated register
    # works. It is removed everywhere rather than shown as an untitled, much
    # cited work.
    dangling = set(shared) - set(referenced)
    if dangling:
        for entry in entries.values():
            kept = [ref for ref in entry.get("referenced_works", []) if ref not in dangling]
            if kept:
                entry["referenced_works"] = kept
            else:
                entry.pop("referenced_works", None)
        shared = {work_id: count for work_id, count in shared.items() if work_id not in dangling}
    matched_ids = {entry["id"] for entry in entries.values()}
    return {
        "source": SOURCE,
        "institution": dict(INSTITUTION),
        "coverage": {
            "register": len(records),
            "matched": {
                method: sum(1 for claim in winners.values() if claim.method == method)
                for method in METHODS
            },
            "with_references": sum(1 for entry in entries.values() if entry.get("referenced_works")),
            "affiliated_total": len(unique_works(affiliated)),
        },
        "works": entries,
        "references": {
            work_id: reference_entry(referenced[work_id], count)
            for work_id, count in shared.items()
        },
        "citations": citation_edges(entries),
        "unmatched_affiliated": unmatched_entries(affiliated, matched_ids),
        "unresolved_dois": sorted(unresolved, key=lambda item: (item["slug"], item["doi"])),
        "conflicts": sorted(conflicts, key=lambda item: (item["slug"], id_key(item["id"]))),
        # Records already matched without success, so the next run does not
        # search for them again while their fingerprint is unchanged.
        "searched": dict(sorted((searched or {}).items())),
    }


def gap_rows(payload: dict, records: dict[str, Record]) -> list[dict]:
    rows = [
        {
            "kind": "in_openalex_not_register",
            "id_or_slug": work["id"],
            "title": work.get("title", ""),
            "year": work.get("year", ""),
            "doi": work.get("doi", ""),
            "type": work.get("type", ""),
        }
        for work in payload["unmatched_affiliated"]
    ]
    for item in payload["unresolved_dois"]:
        record = records[item["slug"]]
        rows.append({
            "kind": "doi_unknown_to_openalex",
            "id_or_slug": item["slug"],
            "title": record.title,
            "year": record.year or "",
            "doi": item["doi"],
            "type": record.document_type,
        })
    return rows


def render_csv(rows: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=GAP_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# The run


@dataclass
class Cache:
    """What the previous openalex.json says about each record."""

    # slug → (fingerprint, work id, match method)
    matched: dict[str, tuple[str, str, str]] = field(default_factory=dict)
    # slug → fingerprint, for records matched without success
    searched: dict[str, str] = field(default_factory=dict)
    conflicts: list[dict] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.matched) + len(self.searched)


def load_cache(path: Path, refresh_all: bool = False) -> Cache:
    """Read the previous output as a cache; an absent or unreadable one is empty.

    Entries that do not have the expected shape are skipped rather than
    trusted: the record they describe is simply matched again.
    """
    if refresh_all or not path.is_file():
        return Cache()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"note: {path.name} is unreadable ({error}); matching every record afresh")
        return Cache()

    matched = {
        slug: (entry["fp"], entry["id"], entry["match"])
        for slug, entry in (payload.get("works") or {}).items()
        if isinstance(entry, dict) and isinstance(entry.get("fp"), str)
        and isinstance(entry.get("id"), str) and entry.get("match") in METHODS
    }
    searched = {
        slug: fp for slug, fp in (payload.get("searched") or {}).items()
        if isinstance(fp, str)
    }
    conflicts = [
        item for item in payload.get("conflicts") or []
        if isinstance(item, dict) and all(isinstance(item.get(key), str)
                                          for key in ("slug", "id", "kept"))
    ]
    return Cache(matched, searched, conflicts)


def partition(records: list[Record], cache: Cache) -> tuple[dict[str, tuple[str, str]], set[str]]:
    """Split records by what the cache already settles.

    Returns the records whose match is kept (slug → (work id, method)) and the
    records not to search again; everything else is matched from scratch. A
    record counts as settled only while its fingerprint is the one the cache
    recorded.
    """
    kept: dict[str, tuple[str, str]] = {}
    skipped: set[str] = set()
    for record in records:
        previous = cache.matched.get(record.slug)
        if previous and previous[0] == record.fp:
            kept[record.slug] = (previous[1], previous[2])
        elif cache.searched.get(record.slug) == record.fp:
            skipped.add(record.slug)
    return kept, skipped


def enrich(records: list[Record], client: OpenAlexClient, title_search: bool = True,
           cache: Cache | None = None) -> tuple[dict, dict]:
    """Match ``records`` and fetch everything openalex.json needs.

    With a ``cache`` from the previous run, a record whose fingerprint is
    unchanged keeps its match (refreshed by id) or, if it had none, is not
    searched for again. The cheap steps — DOI lookup, the affiliated works,
    matching against them, references — run for every record regardless, so
    a DOI OpenAlex has since learned, or a newly affiliated work, is still
    picked up.

    Returns the payload and a few diagnostics (ambiguous records) for the log.
    """
    cache = cache or Cache()
    by_slug = {record.slug: record for record in records}
    kept, skipped = partition(records, cache)
    if cache:
        print(f"Reusing {len(kept)} match(es) and {len(skipped)} unsuccessful search(es); "
              f"{len(records) - len(kept) - len(skipped)} record(s) to match afresh\n")
    details: dict[str, dict] = {}

    # 1. DOI, for every record: it is cheap, it refreshes DOI matches, and it
    # keeps unresolved_dois current for records matched by other means.
    dois = sorted({record.doi for record in records if record.doi})
    print(f"DOI lookup: {len(dois)} distinct DOI(s)")
    by_doi = fetch_by_dois(client, dois)
    for works in by_doi.values():
        details.update((short_id(work["id"]), work) for work in works)
    claims, unresolved = doi_claims(
        records, {doi: [candidate(work) for work in works] for doi, works in by_doi.items()}
    )
    print(f"  {len(by_doi)} found in OpenAlex, {len(claims)} record(s) matched, "
          f"{len(unresolved)} record(s) with a DOI OpenAlex does not know")
    if len(dois) >= 20 and len(by_doi) < len(dois) // 2:
        raise OpenAlexError(
            f"only {len(by_doi)} of {len(dois)} DOIs resolved; the DOI filter or "
            "the normalisation has probably broken"
        )

    # 2. ZMO affiliation: the listing, then the kept matches it did not cover.
    print(f"\nZMO-affiliated works ({INSTITUTION['id']})")
    affiliated = fetch_affiliated(client)
    if not affiliated:
        raise OpenAlexError("OpenAlex returned no ZMO-affiliated works; has the institution id changed?")
    details.update((short_id(work["id"]), work) for work in affiliated)

    if kept:
        stale = sorted({work_id for work_id, _ in kept.values()} - details.keys(), key=id_key)
        for work in fetch_by_values(client, "openalex", stale, DETAIL_FIELDS):
            details[short_id(work["id"])] = work
        # A kept match OpenAlex no longer has is matched again from scratch.
        vanished = sorted(slug for slug, (work_id, _) in kept.items() if work_id not in details)
        for slug in vanished:
            del kept[slug]
        print(f"  {len(kept)} previous match(es) refreshed"
              + (f"; {len(vanished)} no longer in OpenAlex" if vanished else ""))

    # A DOI claim supersedes a kept match: it is the stronger method, and the
    # same claim whenever nothing changed.
    doi_slugs = {claim.slug for claim in claims}
    claims.extend(
        Claim(slug, work_id, method,
              round(similarity(by_slug[slug].variants, candidate(details[work_id]).title), 4))
        for slug, (work_id, method) in sorted(kept.items())
        if slug not in doi_slugs
    )

    # Matching against the affiliated works costs nothing, so it runs for
    # records skipped from searching too.
    pool = [candidate(work) for work in affiliated]
    settled = {claim.slug for claim in claims}
    ambiguous: dict[str, tuple[str, ...]] = {}
    before = len(claims)
    for record in records:
        if record.slug in settled:
            continue
        choice = choose(record, pool)
        if choice and choice.work_id:
            claims.append(Claim(record.slug, choice.work_id, "affiliation", choice.similarity))
        elif choice:
            ambiguous[record.slug] = choice.tied
    print(f"  {len(affiliated)} work(s); {len(claims) - before} more record(s) matched")

    # 3. Title search
    if title_search:
        # A record refused as a tie is not searched again: the same tied works
        # would come back. Nor is one the previous run searched for in vain.
        settled = {claim.slug for claim in claims} | set(ambiguous) | skipped
        plan = plan_title_searches(records, settled)
        searching = {slug for queries in plan.batched.values() for slugs in queries.values()
                     for slug in slugs} | {slug for slug, _, _ in plan.narrowed}
        print(f"\nTitle search: {len(searching)} record(s), "
              f"{sum(len(q) for q in plan.batched.values())} batched queries, "
              f"{len(plan.narrowed)} narrowed by author")
        found = run_title_searches(client, plan, by_slug)
        before = len(claims)
        for slug in sorted(found):
            choice = choose(by_slug[slug], [candidate(work) for work in found[slug]])
            if choice and choice.work_id:
                claims.append(Claim(slug, choice.work_id, "title", choice.similarity))
            elif choice:
                ambiguous[slug] = choice.tied
        print(f"  {len(claims) - before} more record(s) matched")

        missing = sorted({claim.work_id for claim in claims} - details.keys(), key=id_key)
        if missing:
            for work in fetch_by_values(client, "openalex", missing, DETAIL_FIELDS):
                details[short_id(work["id"])] = work
            lost = [claim for claim in claims if claim.work_id not in details]
            for claim in lost:
                print(f"  warning: {claim.work_id} (for {claim.slug}) could not be fetched",
                      file=sys.stderr)
            claims = [claim for claim in claims if claim.work_id in details]

    winners, conflicts = resolve_claims(claims)

    # A record that lost a title match to another record is skipped from
    # searching, so its claim is not made again; its conflict is carried over
    # while the work is still held by the same record.
    lost = {item["slug"] for item in conflicts}
    conflicts.extend(
        item for item in cache.conflicts
        if item["slug"] in skipped and item["slug"] not in winners and item["slug"] not in lost
        and item["kept"] in winners and winners[item["kept"]].work_id == item["id"]
    )

    # Records matched without success, so the next run can skip them. Without
    # a title search only the ones already skipped have been fully tried.
    searched = {
        record.slug: record.fp for record in records
        if record.slug not in winners and (title_search or record.slug in skipped)
    }

    # References cited by two or more register works, resolved to titles.
    entries = {slug: work_entry(details[claim.work_id], claim.method)
               for slug, claim in winners.items()}
    shared = shared_references(entries)
    print(f"\nResolving {len(shared)} reference(s) cited by {MIN_CITING_WORKS}+ register works")
    referenced = {
        short_id(work["id"]): work
        for work in fetch_by_values(client, "openalex", list(shared), REFERENCE_FIELDS)
    }
    unresolved_refs = len(set(shared) - referenced.keys())
    if unresolved_refs:
        print(f"  {unresolved_refs} no longer exist in OpenAlex; dropped from every reference list")

    payload = build_payload(records, details, winners, conflicts, unresolved,
                            affiliated, referenced, searched)
    return payload, {"ambiguous": ambiguous}


def load_records(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    records = payload.get("publications") or []
    if not records:
        raise ValueError(f"no publications in {path}")
    return records


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input", type=Path, default=DEFAULT_INPUT,
        help="crawled register (default: data_prep/raw_data/publications.json)",
    )
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT,
        help="where to write the matches (default: data_prep/raw_data/openalex.json)",
    )
    parser.add_argument(
        "--report", type=Path, default=DEFAULT_REPORT,
        help="where to write the gap report (default: data_prep/reports/openalex-gaps.csv)",
    )
    parser.add_argument(
        "--limit", type=int, default=None, metavar="N",
        help="match only the first N register records; for trying it out",
    )
    parser.add_argument(
        "--refresh-all", action="store_true",
        help="ignore the previous output and match every record afresh",
    )
    parser.add_argument(
        "--no-title-search", action="store_true",
        help="match by DOI and ZMO affiliation only",
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=None,
        help="cache raw API responses here (development only: OpenAlex data changes)",
    )
    parser.add_argument(
        "--delay", type=float, default=0.15,
        help="minimum seconds between requests (default: 0.15)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="match and report without writing either file",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_console()
    args = parse_args(argv)
    started = time.monotonic()

    if not args.input.is_file():
        print(f"error: {args.input} not found; run scrape_publications.py first", file=sys.stderr)
        return 1
    raw = load_records(args.input)
    if args.limit is not None:
        raw = raw[:args.limit]
    records = [prepare_record(item) for item in raw]
    if len({record.slug for record in records}) != len(records):
        print("error: duplicate slugs in the register", file=sys.stderr)
        return 1

    client = OpenAlexClient(
        api_key=os.environ.get("OPENALEX_API_KEY") or None,
        mailto=os.environ.get("OPENALEX_MAILTO") or None,
        delay=args.delay,
        cache_dir=args.cache_dir,
    )
    print(f"{len(records)} register record(s); "
          f"{'with' if os.environ.get('OPENALEX_API_KEY') else 'without'} an API key")
    # The previous output is the cache, as publications.json is the scraper's.
    cache = load_cache(args.output, refresh_all=args.refresh_all)
    if args.refresh_all:
        print(f"--refresh-all: ignoring {args.output.name}")
    elif not cache:
        print(f"no usable {args.output.name}; matching every record")
    print()

    try:
        payload, diagnostics = enrich(records, client, title_search=not args.no_title_search,
                                      cache=cache)
    except OpenAlexError as error:
        print(f"error: {error}", file=sys.stderr)
        print(f"  after {client.requests} request(s), ${client.cost:.4f}; nothing written",
              file=sys.stderr)
        return 1

    coverage = payload["coverage"]
    matched = coverage["matched"]
    print(
        f"\n{sum(matched.values())} of {coverage['register']} record(s) matched "
        f"({matched['doi']} by DOI, {matched['affiliation']} by affiliation, "
        f"{matched['title']} by title); {coverage['with_references']} with references"
    )
    print(f"{len(payload['references'])} shared reference(s), "
          f"{len(payload['citations'])} citation(s) between register works")
    print(f"{len(payload['unmatched_affiliated'])} of {coverage['affiliated_total']} "
          f"ZMO-affiliated work(s) match no register record; "
          f"{len(payload['unresolved_dois'])} register DOI(s) unknown to OpenAlex")
    if payload["conflicts"]:
        print(f"{len(payload['conflicts'])} record(s) lost a work to a better match:")
        for item in payload["conflicts"]:
            print(f"  {item['slug']} -> {item['id']} (kept by {item['kept']})")
    ambiguous = diagnostics["ambiguous"]
    if ambiguous:
        print(f"{len(ambiguous)} record(s) refused as ambiguous:")
        for slug, tied in sorted(ambiguous.items()):
            print(f"  {slug}: {', '.join(tied)}")
    print(f"\n{client.requests} request(s), {client.cache_hits} from cache, "
          f"${client.cost:.4f} of OpenAlex budget, {time.monotonic() - started:.0f}s")

    if args.dry_run:
        print(f"dry run: would write {args.output} and {args.report}")
        return 0

    atomic_json(args.output, payload, indent=1)
    atomic_text(args.report, render_csv(gap_rows(payload, {r.slug: r for r in records})))
    print(f"wrote {args.output} and {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
