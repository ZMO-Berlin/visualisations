#!/usr/bin/env python3
"""Crawl ZMO's public people directory into one JSON file.

The publication register names its authors as plain text and never links them
to their zmo.de profile, so the only way to tell which authors are (or were)
ZMO people is to read the people directory itself. Two passes over
https://www.zmo.de/en/people:

1. every page of each listing (directorate, research fellows, associated and
   affiliated researchers, guests, research support, former fellows and
   staff), to learn who is in which category. A person can be in several —
   the directors are also research fellows;
2. one page per person, for the name as printed, the position line, the
   research projects linked under "Research project" / "Current research"
   (whose URLs carry the research-unit slug), the stated regional focus and an
   ORCID iD if one is linked.

Projects, and so research units, are read only from that current-research
block. CV and profile text on the same page link earlier projects too, and
counting those would turn a unit into "ever worked on a project there" rather
than current membership.

Student assistants are deliberately not crawled: they are not publication
authors, and collecting them would add personal data for no purpose. Contact
details (email, phone) and CV or biography text are never stored, even though
the pages print them.

The result is written to ``raw_data/people.json``: one record per person,
sorted by slug, empty fields omitted, with no run timestamp, so a crawl of an
unchanged site produces a byte-identical file.

Usage:
    python data_prep/scrape_people.py                # crawl everything
    python data_prep/scrape_people.py --dry-run      # report, write nothing
    python data_prep/scrape_people.py --limit 10     # a quick sample
    python data_prep/scrape_people.py --cache-dir /tmp/zmo-people   # reuse downloaded HTML
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlparse

from output import atomic_json
from scrape_zmo import UNITS
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
DEFAULT_OUTPUT = SCRIPT_DIR / "raw_data" / "people.json"

USER_AGENT = f"ZMO-People-Scraper/1.0 {USER_AGENT_SUFFIX}"

PEOPLE_PATH = "/en/people"
PEOPLE_URL = f"{BASE_URL}{PEOPLE_PATH}"

# Where research pages live. English pages are under /en/research/; German ones
# under /forschung/ (German is the site's default language, so it has no
# prefix), occasionally /de/forschung/, and a few profiles link a mis-prefixed
# /en/forschung/. Longest first, so /en/forschung/ is not read as /en/....
RESEARCH_PREFIXES = ("/en/research/", "/en/forschung/", "/de/forschung/", "/forschung/")

# German unit slugs and their English equivalents, read from the hreflang
# alternates of each unit page on 22 October 2026
# (https://www.zmo.de/en/research/state-and-society ->
# https://www.zmo.de/forschung/staat-und-gesellschaft, and so on).
GERMAN_UNIT_SLUGS = {
    "staat-und-gesellschaft": "state-and-society",
    "lebenswege-und-oekologien": "lives-and-ecologies",
    "religion-und-intellektuelle-kultur": "religion-and-intellectual-culture",
}

# The info-line labels (case-folded, colon dropped) whose links are the
# person's current projects. "Research topic" is a third wording of the same
# line; Anna Safronova's profile, for one, links her project under it.
PROJECT_LABELS = frozenset({
    "research project", "research projects", "current research", "research topic",
})

# The listings crawled, in the order a person's categories are reported.
LISTINGS = (
    "directorate",
    "research-fellows",
    "associated-researchers",
    "affiliated-researchers",
    "guests",
    "research-support",
    "former-fellows-and-staff",
)

# Linked from the same navigation but never crawled; see the module docstring.
SKIPPED_LISTINGS = ("student-assistants",)

# A listing's own URL has the same one-segment shape as a person's
# (/en/people/<slug>), and every listing page links them all, so these slugs are
# navigation, never people.
NAVIGATION_SLUGS = frozenset(LISTINGS + SKIPPED_LISTINGS)

# The research units, in the order scrape_zmo.py knows them. A project URL whose
# unit segment is anything else is not counted as a unit.
UNIT_SLUGS = tuple(unit.slug for unit in UNITS)

# A pagination cap. The longest listing has ~20 pages; this only exists so a
# crawl cannot spin forever if the "next page" link ever points backwards.
MAX_PAGES = 100

PERSON_PATH_RE = re.compile(r"^/en/people/([a-z0-9][a-z0-9-]*)/?$")
PAGE_NUMBER_RE = re.compile(r"/page-(\d+)/?$")
ORCID_RE = re.compile(r"orcid\.org/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\b", re.IGNORECASE)

# Academic titles and degrees printed around a name. The site prints names in
# "Given Surname" order behind any number of these ("Prof. Dr.", "PD Dr.",
# "Dr. habil.", "Dipl.-Soz., Dipl.-Krim."), so prefixes are peeled one at a
# time. Every alternative needs its full punctuation or a following separator,
# which keeps a given name such as "Ma" or an initial such as "M." intact.
HONORIFIC_PREFIX = re.compile(
    r"^(?:"
    r"Prof\.|Professor(?:in)?\b|Jun\.-Prof\.|apl\.\s*Prof\.|"
    r"Dr\.|PD\b\.?|Priv\.-Doz\.|Dozent(?:in)?\b|"
    r"habil\.|des\.|phil\.|rer\.\s*(?:nat|pol|soc)\.|h\.\s*c\.|"
    r"Dipl\.-[^\s,.]+\.?|"
    r"M\.\s?A\.|MA\b|M\.\s?Sc\.|MSc\b|Ph\.\s?D\.?|PhD\b"
    r")[\s,]*"
)
DEGREE_SUFFIX = re.compile(
    r"[\s,]+(?:M\.\s?A\.|MA|M\.\s?Sc\.|MSc|M\.\s?Phil\.|MPhil|Ph\.\s?D\.?|PhD|"
    r"Dr\.\s?des\.|Dr\.\s?phil\.|LL\.\s?M\.)$"
)


@dataclass
class Person:
    """One person in the directory.

    Field order is the order of the JSON record. Only public, professional
    facts are modelled; there is deliberately no field for contact details or
    biography text, so nothing downstream can start relying on them.
    """

    slug: str
    url: str
    name: str
    display_name: str = ""   # as printed, only when it differs from ``name``
    categories: list[str] = field(default_factory=list)
    position: str = ""
    units: list[str] = field(default_factory=list)
    projects: list[dict] = field(default_factory=list)  # [{"title", "url"}]
    regional_focus: str = ""
    orcid: str = ""


def listing_url(listing: str) -> str:
    return f"{PEOPLE_URL}/{listing}"


def person_url(slug: str) -> str:
    return f"{PEOPLE_URL}/{slug}"


def person_slug(href: str) -> str | None:
    """The person slug an href points at, or None if it is not a person page.

    Listing URLs (``/en/people/research-fellows``) have the same shape as
    person URLs and are excluded by name; their pagination
    (``/en/people/research-fellows/page-2``) has two segments and never
    matches.
    """
    parsed = urlparse(urljoin(BASE_URL, href))
    if parsed.netloc not in ("www.zmo.de", "zmo.de"):
        return None
    match = PERSON_PATH_RE.match(parsed.path)
    if not match or match.group(1) in NAVIGATION_SLUGS:
        return None
    return match.group(1)


def strip_honorifics(name: str) -> str:
    """Drop academic titles and degrees, keeping the name as printed.

    ``"Prof. Dr. Ulrike Freitag"`` -> ``"Ulrike Freitag"``,
    ``"PD Dr. Nora Lafi"`` -> ``"Nora Lafi"``,
    ``"Jane Doe, M.A."`` -> ``"Jane Doe"``.
    """
    text = " ".join(name.split())
    previous = None
    while text != previous:
        previous = text
        text = HONORIFIC_PREFIX.sub("", text, count=1)
        text = DEGREE_SUFFIX.sub("", text, count=1)
    return text.strip(" ,")


def parse_listing_page(html: str) -> tuple[list[str], str | None]:
    """Return the person slugs on one listing page and the next page's URL.

    People are read from the result items rather than from every link on the
    page: the filter form, sort control and pagination all link back to the
    listing, and an item is the only thing that says "this is a member".
    """
    soup = content_root(html)
    slugs: list[str] = []

    for item in soup.select("article.bb-persons--result__item"):
        for link in item.find_all("a", href=True):
            slug = person_slug(link["href"])
            if slug:
                if slug not in slugs:
                    slugs.append(slug)
                break

    next_link = soup.select_one(".bb-pagination a[rel~=next][href]")
    next_url = urljoin(BASE_URL, next_link["href"]) if next_link else None
    return slugs, next_url


def last_page_number(html: str) -> int:
    """The highest page number the pagination control offers (1 if none)."""
    soup = content_root(html)
    numbers = [1]
    for link in soup.select(".bb-pagination a[href]"):
        match = PAGE_NUMBER_RE.search(urlparse(urljoin(BASE_URL, link["href"])).path)
        if match:
            numbers.append(int(match.group(1)))
    return max(numbers)


def crawl_listing(fetcher: Fetcher, listing: str) -> list[str]:
    """Every person slug in one listing, following its pagination to the end.

    The listings are paginated ten to a page ("former fellows and staff" runs to
    twenty pages), so reading only the first page silently drops most people.
    The walk follows the "next" link and is checked against the last page
    number the first page advertises, so a pagination change fails loudly.
    """
    url: str | None = listing_url(listing)
    seen_urls: set[str] = set()
    slugs: list[str] = []
    expected_pages = 1
    pages = 0

    while url:
        if url in seen_urls:
            raise ScrapeError(f"{listing_url(listing)}: pagination loops back to {url}")
        if pages >= MAX_PAGES:
            raise ScrapeError(f"{listing_url(listing)}: exceeded {MAX_PAGES} pages")
        seen_urls.add(url)

        html = fetcher.get(url)
        pages += 1
        if pages == 1:
            expected_pages = last_page_number(html)

        page_slugs, url = parse_listing_page(html)
        fresh = [slug for slug in page_slugs if slug not in slugs]
        if not fresh:
            raise ScrapeError(
                f"{listing_url(listing)}: page {pages} lists no new people; "
                "the listing layout or its pagination has changed"
            )
        slugs.extend(fresh)

    if pages < expected_pages:
        raise ScrapeError(
            f"{listing_url(listing)}: walked {pages} page(s) but the pagination "
            f"advertises {expected_pages}"
        )
    return slugs


def info_lines(soup) -> list[tuple[str, object]]:
    """The labelled lines under a person's name, as (label, entry node).

    The profile prints "Research project:", "Current research:" and "Regional
    focus:" as ``.bb-person--info__line`` blocks. Labels are returned without
    the trailing colon and case-folded, so callers compare on meaning.
    """
    lines = []
    for line in soup.select(".bb-person--info__line"):
        label_node = line.select_one(".bb-person--info__label")
        entry_node = line.select_one(".bb-person--info__entry")
        if label_node is None or entry_node is None:
            continue
        label = clean_text(label_node).rstrip(":").strip().casefold()
        lines.append((label, entry_node))
    return lines


def research_rest(path: str) -> str | None:
    """The part of a path after its research prefix, or None if it has none."""
    for prefix in RESEARCH_PREFIXES:
        if path.startswith(prefix):
            return path[len(prefix):]
    return None


def project_link(href: str) -> str | None:
    """The canonical URL of a ZMO research page, or None for any other link.

    English and German research pages both count, absolute or relative (see
    ``RESEARCH_PREFIXES``), including legacy ``/forschung/projekte_<years>/*.html``
    pages that carry no unit slug. External project sites are ignored. The URL
    is made absolute on https://www.zmo.de and its fragment and query dropped,
    so the same project linked to two anchors is one project.
    """
    parsed = urlparse(urljoin(BASE_URL, href))
    if parsed.scheme not in ("http", "https") or parsed.netloc not in ("www.zmo.de", "zmo.de"):
        return None
    # Stripping the slash first means a bare "/forschung" or "/en/research"
    # (the research overview, not a project) matches no prefix.
    path = parsed.path.rstrip("/")
    if research_rest(path) is None:
        return None
    return f"{BASE_URL}{path}"


def research_segment(url: str) -> str:
    """The first path segment after the research prefix, as linked.

    That is the unit slug, in English or German, for current projects, and
    something else for older programmes ("mainresearchprogram",
    "projekte_2006", ...).
    """
    rest = research_rest(urlparse(url).path) or ""
    return rest.split("/", 1)[0]


def unit_of(url: str) -> str | None:
    """The English research-unit slug a project URL belongs to, if any."""
    segment = research_segment(url)
    segment = GERMAN_UNIT_SLUGS.get(segment, segment)
    return segment if segment in UNIT_SLUGS else None


def extract_projects(soup) -> list[dict]:
    """The person's current projects, deduplicated by URL, in page order.

    Only links in the "Research project" / "Current research" lines count; see
    the module docstring for why CV and profile text are left out.
    """
    projects: list[dict] = []
    seen: set[str] = set()
    for label, entry in info_lines(soup):
        if label not in PROJECT_LABELS:
            continue
        for link in entry.find_all("a", href=True):
            url = project_link(link["href"])
            if not url or url in seen:
                continue
            seen.add(url)
            title = clean_text(link)
            projects.append({"title": title, "url": url} if title else {"url": url})
    return projects


def extract_units(projects: list[dict]) -> list[str]:
    """The known research units the projects belong to, in canonical order."""
    found = {unit_of(project["url"]) for project in projects}
    return [slug for slug in UNIT_SLUGS if slug in found]


def orcids_in(scope) -> list[str]:
    """Distinct ORCID iDs linked within a node, in page order."""
    found: list[str] = []
    for link in scope.find_all("a", href=True):
        match = ORCID_RE.search(link["href"])
        if match and match.group(1).upper() not in found:
            found.append(match.group(1).upper())
    return found


def extract_orcid(soup) -> str:
    """The person's bare ORCID iD, or "" if the page links none.

    The site prints it as the "Personal website" in the contact block, so an iD
    there wins. Failing that, a single iD anywhere in the profile is taken; two
    different ones are ambiguous (one is presumably a co-author's in a
    publication list), so they are reported and neither is kept.
    """
    contact = soup.select_one(".bb-person--contact")
    for scope in (contact, soup):
        if scope is None:
            continue
        found = orcids_in(scope)
        if len(found) == 1:
            return found[0]
        if found:
            print(f"  ! several ORCID iDs ({', '.join(found)}); none kept", file=sys.stderr)
            return ""
    return ""


def parse_person(html: str, slug: str) -> Person:
    """Read one person page into a record (categories are filled by the caller)."""
    url = person_url(slug)
    soup = content_root(html)

    heading = soup.select_one(".bb-person--header__name") or soup.select_one(
        ".bb-person--detail h1"
    )
    printed = clean_text(heading) if heading else ""
    if not printed:
        raise ScrapeError(f"{url}: no person name; the profile layout has changed")

    name = strip_honorifics(printed)
    if not name:
        raise ScrapeError(f"{url}: name {printed!r} is nothing but titles")

    position_node = soup.select_one(".bb-person--header__jobtitle")
    position = clean_text(position_node) if position_node else ""

    regional_focus = ""
    for label, entry in info_lines(soup):
        if label == "regional focus":
            regional_focus = clean_text(entry)
            break

    scope = soup.select_one(".bb-person--detail") or soup
    projects = extract_projects(scope)

    return Person(
        slug=slug,
        url=url,
        name=name,
        display_name=printed if printed != name else "",
        position=position,
        units=extract_units(projects),
        projects=projects,
        regional_focus=regional_focus,
        orcid=extract_orcid(scope),
    )


def coverage_problem(people: list[Person]) -> str | None:
    """Explain why a full crawl looks broken, or return None if it looks sane.

    Most people (the former staff) have no position or project, so a missing
    field is normal per person. But a full crawl in which *nobody* has one
    means a selector stopped matching, and writing that file would quietly
    empty the field for everyone.
    """
    if not any(person.position for person in people):
        return "no person page yielded a position; the profile header has changed"
    if not any(person.projects for person in people):
        return "no person page yielded a research project; the link format has changed"
    return None


def to_record(person: Person) -> dict:
    """Serialise, dropping empty fields so the JSON stays readable."""
    return {
        key: value for key, value in asdict(person).items()
        if value not in ("", [], None, {})
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT,
        help="where to write the JSON (default: data_prep/raw_data/people.json)",
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
        "--limit", type=int, default=None, metavar="N",
        help="fetch only the first N people (by slug); for trying the parser out",
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

    try:
        print("Reading the listings")
        categories: dict[str, list[str]] = {}
        for listing in LISTINGS:
            # Raises if the listing yields nobody, or stops short of its last page.
            slugs = crawl_listing(fetcher, listing)
            print(f"  {listing}: {len(slugs)}")
            for slug in slugs:
                categories.setdefault(slug, []).append(listing)

        slugs = sorted(categories)
        print(f"  {len(slugs)} distinct people\n")
        if args.limit is not None:
            slugs = slugs[:args.limit]

        print("Fetching person pages")
        people: list[Person] = []
        for index, slug in enumerate(slugs, start=1):
            person = parse_person(fetcher.get(person_url(slug)), slug)
            person.categories = categories[slug]
            people.append(person)
            if index % 25 == 0 or index == len(slugs):
                print(f"  {index}/{len(slugs)}")

    except ScrapeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    unknown_units = sorted({
        research_segment(project["url"])
        for person in people for project in person.projects
        if unit_of(project["url"]) is None
    })
    no_position = [person.slug for person in people if not person.position]
    current_without_unit = [
        person.slug for person in people
        if not person.units and person.categories != ["former-fellows-and-staff"]
    ]

    def count(attribute: str) -> int:
        return sum(1 for person in people if getattr(person, attribute))

    print(
        f"\n{len(people)} people: {count('units')} with a research unit, "
        f"{count('projects')} with projects, {count('regional_focus')} with a "
        f"regional focus, {count('orcid')} with an ORCID iD, "
        f"{len(no_position)} without a position"
    )
    if unknown_units:
        print(f"note: research paths outside the known units: {', '.join(unknown_units)}")
    if current_without_unit:
        print(
            f"note: {len(current_without_unit)} current people have no research unit: "
            f"{', '.join(current_without_unit)}"
        )

    problem = coverage_problem(people) if args.limit is None else None
    if problem:
        print(f"error: {problem}", file=sys.stderr)
        return 1

    # Sorted by slug and with no run timestamp, so an unchanged site produces a
    # byte-identical file and the monthly workflow commits nothing.
    payload = {
        "source": PEOPLE_URL,
        "listings": list(LISTINGS),
        "people": [to_record(person) for person in sorted(people, key=lambda p: p.slug)],
    }

    if args.dry_run:
        print(f"dry run: would write {len(people)} record(s) to {args.output}")
        return 0

    atomic_json(args.output, payload, indent=1)
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
