#!/usr/bin/env python3
"""Turn the crawled publication register into the dashboard's dataset.

Reads ``raw_data/publications.json`` (written by ``scrape_publications.py``)
and writes ``publications_dashboard/data/``:

  * ``publications.json`` — one slim record per publication, with author,
    journal, publisher and series names consolidated so the same entity is one
    entry in every chart;
  * ``meta.json`` — the source, the document types in filter order, and the
    counts the app shows before it has aggregated anything.

Fields the dashboard does not use — abstracts, cover images, ISBNs, the
chapter/volume links — stay in ``raw_data`` rather than being shipped to every
visitor.

The register is maintained by hand, so the same journal or person appears under
several spellings. Three rules run automatically:

  1. spellings that differ only by case, accents, punctuation, spacing or a
     leading article are one entity;
  2. an author's given name that is a prefix of exactly one longer form — an
     initial, or a name without its middle name — belongs to that form;
  3. an author cell holding several "Surname, Given" pairs is several authors.

Anything past that needs to know the field — no rule can tell a typo from a
different journal — so it lives in the hand-curated ``aliases.json``.

Usage:
    python data_prep/generate_publication_data.py
    python data_prep/generate_publication_data.py --report-merges
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent

DEFAULT_INPUT = SCRIPT_DIR / "raw_data" / "publications.json"
DEFAULT_ALIASES = SCRIPT_DIR / "aliases.json"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "publications_dashboard" / "data"

# Fields the dashboard actually reads. Everything else stays in raw_data — the
# publisher's own link, for one, is recorded for half the register and would add
# ~90 KB to a file every visitor downloads, for a second outbound link next to
# the DOI that nothing in the UI shows.
RECORD_FIELDS = (
    "slug", "url", "title", "subtitle", "authors", "type",
    "year", "journal", "publisher", "series", "doi",
)

# Venue fields that get the same consolidation, and the section of aliases.json
# each one reads.
VENUE_FIELDS = {"journal": "journals", "publisher": "publishers", "series": "series"}

# Trailing noise in an author cell: an editorship marker, a parenthetical role
# note, or "et al." in any of the spellings the register uses.
AUTHOR_NOISE = re.compile(
    r"\s*(\(.*?\)|\[.*?\]|,?\s*et\.?\s?al\.?|,?\s*u\.\s?a\.|,?\s*eds?\.?\)?)\s*$",
    re.IGNORECASE,
)

# Leading articles, dropped when comparing two spellings of a venue so that
# "The Journal of African History" and "Journal of African History" are one.
LEADING_ARTICLE = re.compile(r"^(the|le|la|les|der|die|das|el|al)\s+")

# Name particles that belong to the surname rather than the given names, so
# "Ludwig von Beethoven" yields "von Beethoven" and not "Beethoven".
PARTICLES = {
    "af", "al", "av", "bin", "ben", "bint", "da", "das", "de", "del", "della",
    "der", "di", "do", "dos", "du", "el", "ibn", "la", "le", "van", "von",
    "ter", "ten", "zu",
}

NOISE = {"et al.", "et al", "u.a.", "and others"}


def fold(text: str) -> str:
    """Lowercase and strip accents, for comparing two spellings of a name."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def merge_key(value: str) -> str:
    """The key two spellings of one entity share.

    Case, accents, punctuation, spacing and a leading article are all discarded,
    so "I.B.Tauris" and "I.B. Tauris" collapse, as do "de Gruyter" and
    "De Gruyter".

    Letters of any script are kept. Reducing to ASCII would key every Arabic or
    Cyrillic name to the empty string and fuse them all into one entity — which
    an early version of this did, merging a Russian publisher with an Arabic
    one.
    """
    folded = fold(value)
    cleaned = " ".join("".join(c if c.isalnum() else " " for c in folded).split())
    return LEADING_ARTICLE.sub("", cleaned) or folded.strip()


def split_authors(cell: str) -> list[str]:
    """Split one author cell into names.

    The register separates authors with semicolons, but a handful of records use
    commas instead — "Bromber, Katrin, Steiner, Christian" is two people, not
    one person with a four-part name. A comma is also the separator *inside* a
    name, so the only safe reading is by shape: an even number of at least four
    parts is that many "Surname, Given" pairs.
    """
    names: list[str] = []

    for part in cell.split(";"):
        pieces = [piece.strip() for piece in part.split(",") if piece.strip()]

        if len(pieces) >= 4 and len(pieces) % 2 == 0:
            names.extend(
                f"{pieces[index]}, {pieces[index + 1]}"
                for index in range(0, len(pieces), 2)
            )
        elif part.strip():
            names.append(part.strip())

    return names


def strip_noise(name: str) -> str:
    """Remove trailing role markers and "et al.", however many are stacked."""
    previous = None
    current = name.strip().strip(",;")

    while current != previous:
        previous = current
        current = AUTHOR_NOISE.sub("", current).strip().strip(",;")

    return current


def canonical_name(raw: str) -> tuple[str, str] | None:
    """Return one name as ``(surname, given)``, or None if it is not a name.

    The register is inconsistent about order — "Kresse, Kai" and
    "Birgitte Holst" both occur, sometimes for the same person — so a name
    without a comma is read as "Given Surname" and turned around.
    """
    name = strip_noise(raw)
    if not name or fold(name) in NOISE:
        return None

    if "," in name:
        surname, _, given = name.partition(",")
        return surname.strip(), given.strip()

    tokens = name.split()
    if len(tokens) == 1:
        return tokens[0], ""

    for index in range(1, len(tokens)):
        if fold(tokens[index]).strip(".") in PARTICLES:
            return " ".join(tokens[index:]), " ".join(tokens[:index])
    return tokens[-1], " ".join(tokens[:-1])


def name_key(surname: str, given: str) -> str:
    return f"{merge_key(surname)}|{merge_key(given)}"


def extends(shorter: str, longer: str) -> bool:
    """True when ``longer`` is ``shorter`` with more given-name detail.

    Token by token, because a string prefix would make "Jo" a prefix of "John"
    and merge two different people. A token matches either exactly or as an
    initial of the fuller one: "s" extends to "samuli", "stefan" to "stefan b".
    """
    short_tokens = shorter.split()
    long_tokens = longer.split()

    if not short_tokens or len(short_tokens) >= len(long_tokens):
        return False

    return all(
        short == long or (len(short) == 1 and long.startswith(short))
        for short, long in zip(short_tokens, long_tokens)
    )


class NameIndex:
    """Collapses the register's spellings of a person into one display name.

    Two passes. The first counts every distinct (surname, given) pair. The
    second folds a shortened given name into the fuller one it must belong to —
    "Kirmse, Stefan" into "Kirmse, Stefan B.", "Schielke, S." into "Schielke,
    Samuli" — but **only when exactly one fuller name shares that surname and
    that prefix**. "Ahmed, M." cannot be assigned between a Mohammed and a
    Mahmoud without guessing, so it stays separate.
    """

    def __init__(self, aliases: dict[str, str] | None = None) -> None:
        self.aliases = {merge_key(key): value for key, value in (aliases or {}).items()}
        self.counts: Counter[str] = Counter()
        self.surface: dict[str, str] = {}
        self.by_surname: defaultdict[str, set[str]] = defaultdict(set)
        self.alias: dict[str, str] = {}
        # Curated aliases are applied before counting; recorded here so
        # --report-merges shows them rather than leaving them invisible.
        self.applied: dict[str, str] = {}

    def add(self, surname: str, given: str) -> str:
        display = f"{surname}, {given}".strip().strip(",")

        # A curated alias replaces the name before it is counted, so the variant
        # never becomes an entity of its own.
        target = self.aliases.get(merge_key(display))
        if target:
            parsed = canonical_name(target)
            if parsed:
                self.applied[display] = target
                surname, given = parsed
                display = f"{surname}, {given}".strip().strip(",")

        key = name_key(surname, given)
        self.counts[key] += 1
        # Keep the fullest spelling seen: "Kirmse, Stefan B." over "Kirmse, S."
        if len(display) > len(self.surface.get(key, "")):
            self.surface[key] = display
        self.by_surname[merge_key(surname)].add(key)
        return key

    def resolve(self) -> None:
        for key in list(self.counts):
            surname, _, given = key.partition("|")
            if not given:
                continue

            candidates = [
                other for other in self.by_surname[surname]
                if other != key and extends(given, other.partition("|")[2])
            ]
            if len(candidates) == 1:
                self.alias[key] = candidates[0]

        # One hop only: an alias chain would depend on dictionary order, and
        # every merge here is already a shorter form pointing at a longer one,
        # so a chain would mean the middle form had two fuller candidates — the
        # case the uniqueness test exists to refuse.
        self.alias = {
            key: target for key, target in self.alias.items()
            if target not in self.alias
        }

    def display(self, key: str) -> str:
        return self.surface[self.alias.get(key, key)]

    def merges(self) -> list[tuple[str, str]]:
        return sorted(
            [(self.surface[key], self.surface[target]) for key, target in self.alias.items()]
            + list(self.applied.items())
        )


class VenueIndex:
    """Folds spellings of one journal, publisher or series into the commonest.

    Unlike names there is no structure to exploit, so this is purely the
    normalisation key plus the curated aliases. The form kept is the one the
    register uses most often — ties going to the longer, then the
    alphabetically first, so the output does not depend on iteration order.
    """

    def __init__(self, aliases: dict[str, str] | None = None) -> None:
        self.aliases = {merge_key(key): value for key, value in (aliases or {}).items()}
        self.variants: defaultdict[str, Counter[str]] = defaultdict(Counter)
        self.canonical: dict[str, str] = {}
        # Curated aliases are applied before counting, so the variant never
        # becomes a surface form of its own. Recording them here is what keeps
        # them visible to --report-merges instead of silently disappearing.
        self.applied: defaultdict[str, set[str]] = defaultdict(set)

    def add(self, value: str) -> str:
        target = self.aliases.get(merge_key(value), value)
        if target != value:
            self.applied[merge_key(target)].add(value)
        self.variants[merge_key(target)][target] += 1
        return merge_key(target)

    def resolve(self) -> None:
        for key, counts in self.variants.items():
            # Most used, then longest, then alphabetically first — the last two
            # only to make the choice deterministic when the register uses two
            # spellings equally often.
            self.canonical[key] = sorted(
                counts, key=lambda name: (-counts[name], -len(name), name)
            )[0]

    def display(self, key: str) -> str:
        return self.canonical[key]

    def merges(self) -> list[tuple[str, list[str]]]:
        folded = []
        for key, counts in self.variants.items():
            variants = {name for name in counts if name != self.canonical[key]}
            variants |= self.applied.get(key, set()) - {self.canonical[key]}
            if variants:
                folded.append((self.canonical[key], sorted(variants)))
        return sorted(folded)


def build_dataset(records: list[dict], aliases: dict) -> tuple[list[dict], NameIndex, dict]:
    """Consolidate names and venues, then reduce each record to what is shipped."""
    names = NameIndex(aliases.get("authors"))
    venues = {
        field: VenueIndex(aliases.get(section))
        for field, section in VENUE_FIELDS.items()
    }

    staged: list[tuple[dict, list[str], dict[str, str]]] = []

    for record in records:
        keys = []
        for cell in record.get("authors", []):
            for raw in split_authors(cell):
                parsed = canonical_name(raw)
                if parsed:
                    keys.append(names.add(*parsed))

        venue_keys = {
            field: venues[field].add(record[field])
            for field in VENUE_FIELDS
            if record.get(field)
        }
        staged.append((record, keys, venue_keys))

    names.resolve()
    for index in venues.values():
        index.resolve()

    dataset = []
    for record, keys, venue_keys in staged:
        # dict.fromkeys keeps first-seen order while dropping the duplicate a
        # merge can introduce ("Sinha, N." and "Sinha, Nitin" on one record).
        slim = {
            "slug": record["slug"],
            "url": record["url"],
            "title": record.get("title", ""),
            "subtitle": record.get("subtitle", ""),
            "authors": list(dict.fromkeys(names.display(key) for key in keys)),
            "type": record.get("document_type", ""),
            "year": record.get("year"),
            "journal": "",
            "publisher": "",
            "series": "",
            "doi": record.get("doi", ""),
        }
        for field, key in venue_keys.items():
            slim[field] = venues[field].display(key)

        dataset.append({
            key: slim[key] for key in RECORD_FIELDS
            if slim[key] not in ("", [], None)
        })

    return dataset, names, venues


def build_meta(dataset: list[dict], source: str, document_types: list[str]) -> dict:
    years = sorted(record["year"] for record in dataset if record.get("year"))
    authors = {name for record in dataset for name in record.get("authors", [])}
    types = Counter(record.get("type", "") for record in dataset)
    per_year = Counter(years)

    return {
        "source": source,
        # Filter order, then whatever the crawl found that the filter does not
        # list, so a new type appears in the UI rather than vanishing.
        "documentTypes": [label for label in document_types if types[label]]
        + sorted(label for label in types if label and label not in document_types),
        "counts": {
            "publications": len(dataset),
            "authors": len(authors),
            "untyped": types[""],
            "withoutYear": sum(1 for record in dataset if not record.get("year")),
        },
        "years": {"min": years[0], "max": years[-1]} if years else None,
        # One count per year across the whole span, gaps included as zero. The
        # landing page draws its preview of the dashboard from this: without it
        # that page would have to fetch the megabyte of publications.json to
        # show a chart the size of a postage stamp, or the shape would be drawn
        # by hand and be a picture of nothing.
        "perYear": [
            {"year": year, "count": per_year[year]}
            for year in range(years[0], years[-1] + 1)
        ]
        if years
        else [],
    }


def read_aliases(path: Path) -> dict:
    """Load the curated merges, tolerating an absent file."""
    if not path.is_file():
        print(f"note: {path.name} not found; using the automatic rules only")
        return {}

    payload = json.loads(path.read_text(encoding="utf-8"))
    return {key: value for key, value in payload.items() if not key.startswith("_")}


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )


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
        "--aliases", type=Path, default=DEFAULT_ALIASES,
        help="curated spelling merges (default: data_prep/aliases.json)",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR,
        help=f"where to write the JSON (default: {DEFAULT_OUTPUT_DIR.relative_to(REPO_ROOT)})",
    )
    parser.add_argument(
        "--report-merges", action="store_true",
        help="list every spelling that was folded into another",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    args = parse_args(argv)

    if not args.input.is_file():
        print(
            f"error: {args.input} not found; run scrape_publications.py first",
            file=sys.stderr,
        )
        return 1

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    records = payload.get("publications") or []
    if not records:
        print(f"error: no publications in {args.input}", file=sys.stderr)
        return 1

    dataset, names, venues = build_dataset(records, read_aliases(args.aliases))
    meta = build_meta(
        dataset,
        source=payload.get("source", ""),
        document_types=payload.get("document_types", []),
    )

    if args.report_merges:
        print("\nauthors")
        for variant, target in names.merges():
            print(f"  {variant!r} -> {target!r}")
        for field, section in VENUE_FIELDS.items():
            print(f"\n{section}")
            for target, variants in venues[field].merges():
                print(f"  {', '.join(repr(v) for v in variants)} -> {target!r}")
        print()

    write_json(args.output_dir / "publications.json", dataset)
    write_json(args.output_dir / "meta.json", meta)

    counts = meta["counts"]
    merged = len(names.merges()) + sum(len(venues[field].merges()) for field in VENUE_FIELDS)
    print(
        f"{counts['publications']} publication(s), {counts['authors']} author(s), "
        f"{merged} spelling(s) consolidated"
    )
    for field, section in VENUE_FIELDS.items():
        distinct = len(venues[field].canonical)
        print(f"  {section}: {distinct} distinct after {len(venues[field].merges())} merge(s)")
    if meta["years"]:
        print(f"years {meta['years']['min']}–{meta['years']['max']}, "
              f"{counts['withoutYear']} without one, {counts['untyped']} without a type")
    print(f"wrote {args.output_dir / 'publications.json'} and meta.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
