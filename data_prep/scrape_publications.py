#!/usr/bin/env python3
"""Crawl the ZMO publication register into one JSON file.

Three passes over https://www.zmo.de/en/publications/publication-search:

1. the unfiltered result pages, to discover every publication's slug;
2. the same listing filtered by each document type, because the type is not
   printed on any page but *is* a filter — so which listing a slug appears in
   is the only way to learn it;
3. one detail page per publication, for the fields the listing omits:
   publisher, series, ISBN/ISSN, DOI, external link, abstract, cover image and
   the links between a chapter and the volume it appeared in.

The result is written to ``raw_data/publications.json``: one record per
publication, sorted by slug, with no run timestamp, so a crawl of an unchanged
site produces no diff. ``generate_publication_data.py`` turns it into what the
dashboard loads.

That output file is also the cache. Every run re-reads the listing — it is the
only statement of which publications exist, so it is what detects both new
records and withdrawn ones — but a publication whose listing entry is unchanged
keeps the record already on disk instead of having its detail page fetched
again. A first crawl is ~2,400 requests; a monthly top-up is ~200 plus a
handful. ``--refresh-all`` forces the long way round.

Usage:
    python data_prep/scrape_publications.py                 # crawl, reusing cached records
    python data_prep/scrape_publications.py --refresh-all   # refetch every detail page
    python data_prep/scrape_publications.py --dry-run       # report, write nothing
    python data_prep/scrape_publications.py --limit 30      # a quick sample
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from zmo_site import (
    BASE_URL,
    USER_AGENT_SUFFIX,
    Fetcher,
    ScrapeError,
    clean_text,
    configure_console,
    content_root,
)

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = SCRIPT_DIR / "raw_data" / "publications.json"

USER_AGENT = f"ZMO-Publications-Scraper/1.0 {USER_AGENT_SUFFIX}"

LISTING_PATH = "/en/publications/publication-search"
LISTING_URL = f"{BASE_URL}{LISTING_PATH}"

# The plugin's filter, as GET parameters. The form posts, but the sort links on
# the page prove the controller reads the same arguments from the query string,
# which keeps every request cacheable and re-runnable from a browser.
FILTER_PARAM = "tx_publications_publications[publicationFilter][documenttype]"

# Document types and their internal ids, read from the filter's <select>. The
# ids are TYPO3 record uids: stable, but if the list ever changes the crawl
# reports the mismatch rather than silently mislabelling everything.
DOCUMENT_TYPES = {
    21: "Monographs",
    38: "Book reviews",
    20: "Contributions to an edited volume",
    31: "Editorship of journal, book series",
    22: "Edited volumes",
    32: "Journal articles",
    30: "Other publications",
    42: "Special Issues",
    41: "Working Papers",
}

# A pagination cap. The register has ~200 pages; this only exists so a crawl
# cannot spin forever if the "next page" link ever starts pointing at itself.
MAX_PAGES = 500

DATE_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")
YEAR_RE = re.compile(r"\b(1[89]\d{2}|20\d{2})\b")
# The register keeps ISSNs in the ISBN field, hyphenated or not.
ISSN_RE = re.compile(r"^\d{4}-?\d{3}[\dXx]$")


@dataclass
class Reference:
    """A pointer from one publication in the register to another."""

    slug: str | None
    title: str
    subtitle: str = ""
    authors: list[str] = field(default_factory=list)
    role: str = ""  # "Ed." when the listing marks the names as editors


@dataclass
class Publication:
    """One record of the register.

    Field names follow the page, not a bibliographic standard: ``publisher``
    and ``periodical`` are separate blocks in the markup and are never both
    fully populated, so keeping them apart avoids inventing a merged model the
    source does not have.
    """

    slug: str
    url: str
    title: str
    subtitle: str = ""
    authors: list[str] = field(default_factory=list)
    document_type: str = ""
    year: int | None = None
    date: str = ""          # ISO, only when the page gives a full date
    journal: str = ""
    volume: str = ""
    issue: str = ""
    publisher: str = ""
    places: list[str] = field(default_factory=list)
    series: str = ""
    pages: str = ""
    isbn: str = ""
    issn: str = ""
    doi: str = ""
    link: str = ""
    abstract: str = ""
    note: str = ""          # the "Info" variant of the body text
    cover: str = ""
    published_in: Reference | None = None   # the volume a chapter appeared in
    contributions: list[Reference] = field(default_factory=list)  # ZMO chapters within
    # Everything the listing already knew. Kept so --incremental can tell
    # whether a record needs its detail page fetched again.
    fingerprint: str = ""


def listing_url(page: int, document_type: int | None = None) -> str:
    url = f"{LISTING_URL}/page-{page}"
    if document_type is not None:
        url += "?" + urlencode({FILTER_PARAM: document_type})
    return url


def detail_url(slug: str) -> str:
    return f"{LISTING_URL}/{slug}"


def slug_of(href: str) -> str | None:
    """The publication slug in a listing link, or None if it is not one."""
    if not href.startswith(LISTING_PATH + "/"):
        return None
    slug = href[len(LISTING_PATH) + 1:].split("?")[0].strip("/")
    if not slug or slug.startswith("page-"):
        return None
    return slug


def parse_listing(html: str) -> tuple[list[dict], int | None]:
    """Return this page's entries and the number of the last page.

    Each entry carries what the listing itself shows. The detail page repeats
    all of it, so this is used for discovery and for the change fingerprint,
    not as a second source of truth.
    """
    soup = content_root(html)
    entries: list[dict] = []

    for article in soup.select("article.bb-publication--item"):
        link = article.select_one("h2.bb-publication--header__subheadline a[href]")
        if not link:
            continue
        slug = slug_of(link["href"])
        if not slug:
            continue

        authors = article.select_one("h3.bb-entry--authors")
        publisher = article.select_one(".bb-publication--publisher")
        periodical = article.select_one(".bb-publication--periodical")

        entries.append({
            "slug": slug,
            "title": clean_text(link),
            "authors": clean_text(authors) if authors else "",
            "publisher": clean_text(publisher) if publisher else "",
            "periodical": clean_text(periodical) if periodical else "",
        })

    last_page = None
    end_link = soup.select_one(".bb-pagination--item__end a[href]")
    if end_link:
        match = re.search(r"/page-(\d+)", end_link["href"])
        if match:
            last_page = int(match.group(1))

    return entries, last_page


def crawl_listing(fetcher: Fetcher, document_type: int | None = None,
                  label: str = "all", limit: int | None = None) -> list[dict]:
    """Walk every result page of one listing, following its own pagination."""
    entries: list[dict] = []
    seen: set[str] = set()
    page = 1
    last_page: int | None = None

    while page <= MAX_PAGES:
        html = fetcher.get(listing_url(page, document_type))
        found, end = parse_listing(html)

        if page == 1:
            last_page = end or 1
            if not found:
                raise ScrapeError(
                    f"{listing_url(1, document_type)}: no publications found; "
                    "the .bb-publication--item markup has changed"
                )

        for entry in found:
            if entry["slug"] not in seen:
                seen.add(entry["slug"])
                entries.append(entry)

        print(f"  [{label}] page {page}/{last_page}: {len(found)} item(s), {len(entries)} total")

        if limit is not None and len(entries) >= limit:
            return entries[:limit]
        if last_page is None or page >= last_page:
            break
        page += 1

    return entries


def tag_document_types(fetcher: Fetcher, pending: set[str],
                       limit: int | None = None) -> dict[str, str]:
    """Map slugs to document types by seeing which filtered listing lists them.

    The nine listings are walked a page at a time in *parallel* rather than one
    to exhaustion before the next. Results are sorted newest first, so on a
    top-up run each new publication sits on the first page or two of whichever
    listing it belongs to — and the walk stops as soon as nothing is left to
    identify. Taking the listings in order instead would page through all 68
    pages of "Contributions to an edited volume" before ever reaching a new
    journal article.
    """
    types: dict[str, str] = {}
    next_page = {type_id: 1 for type_id in DOCUMENT_TYPES}
    last_page: dict[int, int] = {}
    requests = 0

    while next_page and pending:
        for type_id in list(next_page):
            page = next_page[type_id]
            entries, end = parse_listing(fetcher.get(listing_url(page, type_id)))
            requests += 1

            if page == 1:
                last_page[type_id] = end or 1

            for entry in entries:
                types[entry["slug"]] = DOCUMENT_TYPES[type_id]
                pending.discard(entry["slug"])

            if page >= last_page[type_id] or (limit and len(types) >= limit):
                del next_page[type_id]
            else:
                next_page[type_id] = page + 1

            if not pending:
                break

        print(f"  {requests} page(s) read, {len(types)} tagged, {len(pending)} still unidentified")

    return types


def split_names(text: str) -> list[str]:
    """Split one author cell into names.

    The register separates names with semicolons. Their internal shape is not
    consistent — "Kresse, Kai" and "Birgitte Holst" both occur — and is left
    alone here; ``generate_publication_data.py`` normalises it.
    """
    return [part.strip() for part in text.split(";") if part.strip()]


def block_lines(node) -> list[str]:
    """Split a block that uses ``<br>`` as its line separator.

    The publisher block stacks imprint and series in one ``<p>`` with a ``<br>``
    between them, so the tag has to be honoured; ``get_text`` alone would run
    the two together.
    """
    if node is None:
        return []
    parts = re.split(r"<br\s*/?>", node.decode_contents(), flags=re.IGNORECASE)
    lines = [clean_text(BeautifulSoup(part, "html.parser")) for part in parts]
    return [line for line in lines if line]


def parse_publisher(lines: list[str], record: Publication) -> None:
    """Read the publisher block, whose contents depend on the document type.

    The same block holds a bare date for an article ("04/05/2026"), a bare year
    for a special issue ("2026"), or an imprint for a book ("Berghahn Books,
    Oxford, New York, 2026"). Anything after the first line is a series.
    """
    for index, line in enumerate(lines):
        if index == 0:
            parts = [part.strip() for part in line.split(",") if part.strip()]
            trailing = parts[-1] if parts else ""

            date = DATE_RE.match(trailing)
            if date:
                day, month, year = date.groups()
                record.date = f"{year}-{month}-{day}"
                record.year = int(year)
                parts = parts[:-1]
            elif re.fullmatch(r"\d{4}", trailing):
                record.year = int(trailing)
                parts = parts[:-1]

            if parts:
                record.publisher = parts[0]
                record.places = parts[1:]
        elif line.lower().startswith("serie"):
            record.series = line.split(":", 1)[-1].strip()


def parse_periodical(lines: list[str], record: Publication) -> None:
    """Read "Journal, volume, issue" — where the tail is often absent.

    Only trailing numeric parts are treated as volume and issue; a journal name
    containing a comma therefore stays intact, and a note such as "online first"
    stays attached to the name rather than being mistaken for a volume.
    """
    if not lines:
        return

    parts = [part.strip() for part in lines[0].split(",") if part.strip()]
    tail: list[str] = []
    while len(parts) > 1 and re.fullmatch(r"[\d/–—-]+", parts[-1]):
        tail.insert(0, parts.pop())

    record.journal = ", ".join(parts)
    if tail:
        record.volume = tail[0]
    if len(tail) > 1:
        record.issue = tail[1]


def parse_identifiers(node, record: Publication) -> None:
    """Read the ISBN / DOI / link block.

    The ISBN field doubles as the ISSN field for journals and working-paper
    series, so an 8-digit value is recorded as an ISSN instead.
    """
    for line in block_lines(node):
        if line.lower().startswith("isbn"):
            value = line.split(None, 1)[-1].strip()
            if ISSN_RE.match(value):
                record.issn = value
            else:
                record.isbn = value
        elif line.lower().startswith("doi"):
            value = line.split(":", 1)[-1].strip()
            record.doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", value)

    link = node.select_one("p.bb-publication--link a[href]") if node else None
    if link:
        record.link = link["href"]


def parse_reference(node) -> Reference | None:
    """Read the "In: <editors> (Ed.) <volume>" block above a chapter."""
    link = node.select_one("a[href]")
    names = [clean_text(span) for span in node.select("span.bb-entry--authors__user")]
    authors: list[str] = []
    for name in names:
        authors.extend(split_names(name))

    text = clean_text(node)
    title = clean_text(link) if link else ""
    subtitle = ""

    if link:
        # What follows the link, on its own line, is the volume's subtitle.
        after = text.split(title, 1)[-1].strip()
        subtitle = after.strip(" ,")

    if not title and not authors:
        return None

    return Reference(
        slug=slug_of(link["href"]) if link else None,
        title=title,
        subtitle=subtitle,
        authors=authors,
        role="Ed." if "(Ed" in text else "",
    )


def parse_contributions(marker) -> list[Reference]:
    """Read the "Contributions from ZMO" list under a volume or special issue.

    The list is not a list: the label, the author spans and the chapter links
    are loose siblings in the page's main cell, with ``<br>`` between rows. So
    it is walked forward from the label in document order, each link taking the
    names most recently seen before it.
    """
    references: list[Reference] = []
    pending: list[str] = []

    for node in marker.next_siblings:
        if getattr(node, "name", None) is None:
            continue
        tags = [node] if node.name in ("span", "a") else node.select("span, a[href]")

        for tag in tags:
            if tag.name == "span":
                pending = split_names(clean_text(tag))
            elif tag.has_attr("href"):
                slug = slug_of(tag["href"])
                if slug:
                    references.append(
                        Reference(slug=slug, title=clean_text(tag), authors=pending)
                    )
                    pending = []

    return references


def parse_detail(html: str, slug: str) -> Publication:
    """Turn a publication's own page into a record."""
    soup = content_root(html)
    article = soup.select_one("article.bb-publication--detail")
    if not article:
        raise ScrapeError(f"{detail_url(slug)}: no article.bb-publication--detail on the page")

    heading = article.select_one("h1.bb-publication--header__headline")
    if not heading:
        raise ScrapeError(f"{detail_url(slug)}: no headline; the detail layout has changed")

    record = Publication(slug=slug, url=detail_url(slug), title=clean_text(heading))

    header = article.select_one("header.bb-publication--header")
    subtitle = header.select_one("h2.bb-publication--header__subheadline") if header else None
    if subtitle:
        record.subtitle = clean_text(subtitle)

    authors = article.select_one("h3.bb-publication--authors")
    if authors:
        record.authors = split_names(clean_text(authors))

    parse_publisher(block_lines(article.select_one(".bb-publication--publisher")), record)
    parse_periodical(block_lines(article.select_one(".bb-publication--periodical")), record)

    body = article.select_one(".bb-publication--bodytext")
    if body:
        # The same block is labelled "Abstract" or "Info"; only the first is a
        # summary of the work itself.
        heading_text = clean_text(body.select_one("strong")) if body.select_one("strong") else ""
        paragraphs = [clean_text(p) for p in body.select("p")]
        text = "\n\n".join(part for part in paragraphs if part)
        if heading_text.lower().startswith("info"):
            record.note = text
        else:
            record.abstract = text

    cover = article.select_one("figure.bb-publication__cover img[src]")
    if cover:
        record.cover = BASE_URL + cover["src"] if cover["src"].startswith("/") else cover["src"]

    # The "In:" reference sits inside the header; the identifiers and any
    # "Contributions from ZMO" share one unclassed div below it.
    if header:
        for div in header.find_all("div", class_=False, recursive=False):
            reference = parse_reference(div)
            if reference:
                record.published_in = reference

    main_cell = article.select_one(".cell.medium-9") or article
    for div in main_cell.find_all("div", class_=False, recursive=False):
        parse_identifiers(div, record)

    contributions = main_cell.find(
        "strong", string=re.compile("Contributions from ZMO", re.IGNORECASE)
    )
    if contributions:
        record.contributions = parse_contributions(contributions)

    for paragraph in main_cell.find_all("p", class_=False, recursive=False):
        text = clean_text(paragraph)
        if re.match(r"^(p\.|pp\.|\d+\s*p\.)", text, re.IGNORECASE):
            record.pages = text
            break

    # A record with no year of its own inherits none: better an empty field
    # than a year guessed from a series title.
    if record.year is None:
        for source in (record.series, record.pages):
            match = YEAR_RE.search(source or "")
            if match:
                record.year = int(match.group(1))
                break

    return record


def fingerprint(entry: dict) -> str:
    """What the listing knows about an entry, as one comparable string."""
    return " | ".join(
        entry.get(key, "") for key in ("title", "authors", "publisher", "periodical")
    )


def load_previous(path: Path) -> dict[str, dict]:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return {record["slug"]: record for record in payload.get("publications", [])}
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        print(f"warning: ignoring unreadable {path.name}: {error}", file=sys.stderr)
        return {}


def to_record(publication: Publication) -> dict:
    """Serialise, dropping empty fields so the JSON stays readable."""
    data = asdict(publication)
    return {
        key: value for key, value in data.items()
        if value not in ("", [], None, {})
    }


def from_record(data: dict) -> Publication:
    """Rebuild a cached record.

    Unknown keys are dropped rather than passed to the constructor: a field
    removed from ``Publication`` in a later version would otherwise make every
    cached record raise TypeError, turning a schema change into a crash instead
    of a re-fetch.
    """
    known = {field.name for field in fields(Publication)}
    values = {key: value for key, value in data.items() if key in known}

    reference_fields = {field.name for field in fields(Reference)}
    if values.get("published_in"):
        values["published_in"] = Reference(**{
            key: value for key, value in values["published_in"].items()
            if key in reference_fields
        })
    values["contributions"] = [
        Reference(**{key: value for key, value in ref.items() if key in reference_fields})
        for ref in values.get("contributions", [])
    ]

    return Publication(**values)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT,
        help="where to write the JSON (default: data_prep/raw_data/publications.json)",
    )
    parser.add_argument(
        "--delay", type=float, default=0.5,
        help="minimum seconds between requests (default: 0.5)",
    )
    parser.add_argument(
        "--timeout", type=float, default=30.0,
        help="per-request timeout in seconds (default: 30)",
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=None,
        help="reuse downloaded HTML from this directory instead of refetching",
    )
    parser.add_argument(
        "--refresh-all", action="store_true",
        help="refetch every detail page instead of reusing unchanged records",
    )
    parser.add_argument(
        "--limit", type=int, default=None, metavar="N",
        help="stop after N publications; for trying the parser out",
    )
    parser.add_argument(
        "--skip-types", action="store_true",
        help="skip the per-document-type listings (leaves every type empty)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="crawl and report without writing the output file",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_console()
    args = parse_args(argv)

    fetcher = Fetcher(
        delay=args.delay, timeout=args.timeout, cache_dir=args.cache_dir,
        user_agent=USER_AGENT,
    )
    previous = {} if args.refresh_all else load_previous(args.output)

    try:
        # The full listing is always walked: it is the only statement of which
        # publications exist, so it is what detects additions *and* removals.
        # At ~200 pages it is also the cheap part of the crawl.
        print("Listing every publication")
        entries = crawl_listing(fetcher, limit=args.limit)
        print(f"  {len(entries)} publication(s)")

        stale = [
            entry for entry in entries
            if previous.get(entry["slug"], {}).get("fingerprint") != fingerprint(entry)
        ]
        if previous:
            print(f"  {len(entries) - len(stale)} unchanged since the last crawl, "
                  f"{len(stale)} new or edited")
        print()

        types: dict[str, str] = {}
        if not args.skip_types:
            # Only records being refetched need a type looked up; the rest keep
            # the one already recorded.
            print("Reading the document-type filters")
            types = tag_document_types(
                fetcher, {entry["slug"] for entry in stale}, limit=args.limit
            )
            print()

        print("Fetching detail pages")
        records: list[Publication] = []
        reused = 0

        for index, entry in enumerate(entries, start=1):
            slug = entry["slug"]
            mark = fingerprint(entry)
            cached = previous.get(slug)

            if cached and cached.get("fingerprint") == mark:
                record = from_record(cached)
                reused += 1
            else:
                record = parse_detail(fetcher.get(detail_url(slug)), slug)
                record.fingerprint = mark

            record.document_type = types.get(slug, record.document_type)
            records.append(record)

            if index % 25 == 0 or index == len(entries):
                print(f"  {index}/{len(entries)} ({reused} reused)")

    except ScrapeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    missing_year = sum(1 for record in records if record.year is None)
    with_abstract = sum(1 for record in records if record.abstract)
    print(
        f"\n{len(records)} record(s): {with_abstract} with an abstract, "
        f"{missing_year} without a year"
    )

    if missing_year > len(records) // 4:
        print(
            f"error: {missing_year} of {len(records)} records have no year, which "
            "means the publisher block is no longer being parsed",
            file=sys.stderr,
        )
        return 1

    # Sorted by slug and with no run timestamp, so an unchanged site produces a
    # byte-identical file and the monthly workflow commits nothing.
    payload = {
        "source": LISTING_URL,
        "document_types": list(DOCUMENT_TYPES.values()),
        "publications": [to_record(record) for record in sorted(records, key=lambda r: r.slug)],
    }

    if args.dry_run:
        print(f"dry run: would write {len(records)} record(s) to {args.output}")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {args.output}")
    print("\nNext: python data_prep/generate_publication_data.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
