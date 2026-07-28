#!/usr/bin/env python3
"""Collect research-unit and project text from the ZMO website.

For each research unit this fetches:

  * the unit's own title and abstract, from its overview page;
  * every project listed under "Research Projects", following each link to
    pick up the project's title and abstract.

The result is written to ``raw_data/<Stem>.txt`` in the same shape the files
previously maintained by hand had — one paragraph per line, blank line between
paragraphs — so ``generate_word_data.py`` consumes it unchanged.

A ``raw_data/units.json`` manifest records what was scraped. The frequency
generator reads it to decide which files are research units, so text sitting in
``raw_data/`` that did not come from the site (a workshop description, say) gets
its own word cloud but stays out of the ``combined`` aggregate.

Usage:
    python data_prep/scrape_zmo.py              # refresh everything
    python data_prep/scrape_zmo.py --dry-run    # report, write nothing
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin

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
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "raw_data"
MANIFEST_NAME = "units.json"

# Identify the crawler so ZMO can see what is hitting the site.
USER_AGENT = f"ZMO-WordCloud-Scraper/1.0 {USER_AGENT_SUFFIX}"


@dataclass(frozen=True)
class Unit:
    """A research unit and the filename its text is written to.

    ``stem`` is not derived from ``slug``: the existing filenames are irregular
    ("State_Society" but "Religion-Intellectual-Culture"), and each one is also
    the ``value`` of an entry in
    ``units_wordcloud/src/config/ConfigManager.js`` and the prefix of a file in
    ``units_wordcloud/data/``. Renaming a stem means changing all three.
    """

    slug: str
    stem: str

    @property
    def url(self) -> str:
        return f"{BASE_URL}/en/research/{self.slug}"


UNITS = (
    Unit(slug="state-and-society", stem="State_Society"),
    Unit(slug="lives-and-ecologies", stem="Lives_Ecologies"),
    Unit(slug="religion-and-intellectual-culture", stem="Religion-Intellectual-Culture"),
)


@dataclass
class Entry:
    """One titled block of text below a unit's abstract.

    A unit page lists two kinds of project:

    * individual projects (``h2.bb-entry--title``), whose abstract lives on
      their own page and has to be fetched — ``url`` is set;
    * umbrella projects such as MIDA or CRAFTE (``h2.bb-section--title``),
      whose description is printed inline on the listing page above their
      sub-projects — ``inline`` is True and no request is needed.

    Umbrella descriptions are easy to miss: they are not in the link list, so
    extracting only the linked projects silently drops several hundred words
    per unit.
    """

    title: str
    url: str | None = None
    inline: bool = False
    paragraphs: list[str] = field(default_factory=list)


# Academic titles that mark a byline rather than prose.
BYLINE_PREFIX = re.compile(r"^(Dr\.|Prof\.|PD\b|Priv\.-Doz\.|Dipl\.)", re.IGNORECASE)
BYLINE_MAX_WORDS = 12


def is_byline(paragraph, text: str) -> bool:
    """True for a paragraph naming the researcher rather than describing work.

    Project pages open with the researcher's name, sometimes as a link to their
    profile and sometimes as plain text with an academic title. Either way it is
    metadata, and it contributes personal names to the word cloud, so it is
    dropped — as the hand-maintained files also did.
    """
    links = paragraph.find_all("a", href=True)
    if links and all("/people/" in link["href"] for link in links):
        return True
    return len(text.split()) <= BYLINE_MAX_WORDS and bool(BYLINE_PREFIX.match(text))


def extract_paragraphs(container) -> list[str]:
    """Collapse a ``.ce-bodytext`` block into clean one-line paragraphs."""
    paragraphs: list[str] = []

    for node in container.find_all("p"):
        text = clean_text(node)
        if not text:
            continue

        # Only strip bylines before any prose has been seen. A short sentence
        # opening with a title mid-abstract is part of the text, not a byline.
        if not paragraphs and is_byline(node, text):
            continue

        paragraphs.append(text)

    return paragraphs


def first_bodytext(soup) -> list[str]:
    block = soup.select_one(".ce-bodytext")
    return extract_paragraphs(block) if block else []


def scrape_unit_page(fetcher: Fetcher, unit: Unit) -> tuple[str, list[str], list[Entry]]:
    """Return the unit's title, its abstract, and every entry below it.

    The page is walked in document order rather than queried for links alone,
    so inline umbrella descriptions keep their position relative to the
    sub-projects they introduce.
    """
    soup = content_root(fetcher.get(unit.url))

    heading = soup.select_one("h1")
    if not heading:
        raise ScrapeError(f"{unit.url}: no <h1>; the page layout has changed")
    title = clean_text(heading)

    abstract: list[str] = []
    entries: list[Entry] = []
    seen_urls: set[str] = set()
    pending_umbrella: Entry | None = None

    # select() preserves document order, so a `.ce-bodytext` seen right after an
    # umbrella heading is that umbrella's description.
    for node in soup.select("h2.bb-entry--title, h2.bb-section--title, .ce-bodytext"):
        classes = node.get("class") or []

        if node.name == "h2":
            link = node.find("a", href=True)
            heading_text = clean_text(node)

            if "bb-section--title" in classes:
                pending_umbrella = Entry(title=heading_text, inline=True)
                entries.append(pending_umbrella)
            else:
                pending_umbrella = None
                if not link:
                    continue
                url = urljoin(BASE_URL, link["href"])
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                entries.append(Entry(title=heading_text, url=url))
            continue

        # A .ce-bodytext block.
        paragraphs = extract_paragraphs(node)
        if not paragraphs:
            continue

        if pending_umbrella is not None:
            pending_umbrella.paragraphs = paragraphs
            pending_umbrella = None
        elif not entries:
            # Before any project heading: this is the unit's own abstract.
            abstract.extend(paragraphs)

    if not abstract:
        raise ScrapeError(f"{unit.url}: no .ce-bodytext abstract found")
    if not entries:
        raise ScrapeError(f"{unit.url}: no projects found under Research Projects")

    return title, abstract, entries


def scrape_entry(fetcher: Fetcher, entry: Entry) -> None:
    """Fill in an entry's abstract, fetching its page when it has one."""
    if entry.inline:
        return  # description was already read from the listing page

    soup = content_root(fetcher.get(entry.url))
    entry.paragraphs = first_bodytext(soup)

    # A project page with no prose is worth reporting but not worth aborting
    # the whole run for — some entries are genuinely stubs.
    if not entry.paragraphs:
        print(f"  ! no abstract: {entry.url}", file=sys.stderr)


def render_document(title: str, abstract: list[str], entries: list[Entry]) -> str:
    """Assemble the text file: one paragraph per line, blank line between."""
    blocks = [title, *abstract]
    for entry in entries:
        blocks.append(entry.title)
        blocks.extend(entry.paragraphs)
    return "\n\n".join(blocks) + "\n"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR,
        help="where to write the .txt files (default: data_prep/raw_data)",
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
        "--only", nargs="*", metavar="SLUG", default=None,
        help="scrape only these unit slugs, e.g. --only lives-and-ecologies",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="report what would be written without touching any file",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_console()
    args = parse_args(argv)

    units = UNITS
    if args.only:
        wanted = set(args.only)
        units = tuple(unit for unit in UNITS if unit.slug in wanted)
        unknown = wanted - {unit.slug for unit in UNITS}
        if unknown:
            print(f"error: unknown unit slug(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            return 1
        if not units:
            print("error: --only matched no units", file=sys.stderr)
            return 1

    fetcher = Fetcher(
        delay=args.delay, timeout=args.timeout, cache_dir=args.cache_dir,
        user_agent=USER_AGENT,
    )
    manifest_units = []

    try:
        for unit in units:
            print(f"{unit.slug}")
            title, abstract, entries = scrape_unit_page(fetcher, unit)
            inline_count = sum(1 for entry in entries if entry.inline)
            print(
                f"  {title!r}: {len(abstract)} abstract paragraph(s), "
                f"{len(entries)} entries ({inline_count} inline umbrella, "
                f"{len(entries) - inline_count} linked)"
            )

            for index, entry in enumerate(entries, start=1):
                scrape_entry(fetcher, entry)
                marker = "~" if entry.inline else " "
                print(f"  [{index:>2}/{len(entries)}]{marker}{len(entry.paragraphs):>2}p  {entry.title[:60]}")

            document = render_document(title, abstract, entries)
            destination = args.output_dir / f"{unit.stem}.txt"

            if args.dry_run:
                print(f"  would write {len(document.split())} words to {destination}")
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(document, encoding="utf-8")
                print(f"  wrote {len(document.split())} words to {destination}")

            manifest_units.append({
                "stem": unit.stem,
                "slug": unit.slug,
                "label": title,
                "url": unit.url,
                "projects": [
                    {
                        "title": entry.title,
                        "url": entry.url,
                        "kind": "umbrella" if entry.inline else "project",
                    }
                    for entry in entries
                ],
            })
            print()

    except ScrapeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if args.dry_run:
        print("dry run: no files written")
        return 0

    # Only rewrite the manifest on a full run; a partial one would drop the
    # units that were skipped.
    if args.only:
        print("note: --only was used, so units.json was left unchanged")
    else:
        # Deliberately no timestamp: the manifest has to be byte-identical when
        # the site has not changed, otherwise the monthly workflow commits a
        # diff on every run and republishes the site for nothing. Git already
        # records when each refresh landed.
        manifest = {
            "source": BASE_URL,
            "units": manifest_units,
        }
        manifest_path = args.output_dir / MANIFEST_NAME
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {manifest_path}")

    print("\nNext: python data_prep/generate_word_data.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
