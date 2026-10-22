"""The places a publication is about, matched against a reviewed gazetteer.

The register records no place, so places are found by looking for the names in
``gazetteer.json`` — countries, regions, cities and seas, in English, German
and French, with their demonyms — in each record's title, subtitle and, where
the register has one, abstract; and in the "regional focus" line of zmo.de
people pages.

Matching is deliberately literal, because every match has to be checkable: the
dashboard keeps the matched words, and ``reports/regions-review.md`` lists them.
Four rules keep it honest:

1. **Longest name wins.** "Indian Ocean" is never India, "Niger Delta" is
   Nigeria and not Niger, "South Sudan" is not Sudan.
2. **Some phrases are removed first** (``ignore`` in the gazetteer): an
   institution's name ("ZMO Berlin"), a place named after another ("Gulf of
   Guinea"), a period ("Middle Ages").
3. **A review's imprint is not a place.** "London: Hurst, 2020" goes before
   matching, as it does for the thematic map (``titles.py``).
4. **Ambiguous names are decided record by record.** "Tripoli" (Libya or
   Lebanon), "Georgia", "Jordan" and "Benin" are flagged in the gazetteer, every
   match of theirs is listed in the review report, and ``regions_review.json``
   records the decisions — reject, or reassign to another place. A new match of
   an ambiguous name that no one has looked at yet keeps the gazetteer's default
   and is listed as unreviewed.

A place named is not always a place studied — a title can compare, contrast or
merely mention — and records with an abstract have more text to match. The
dashboard says both.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from titles import own_title

SCRIPT_DIR = Path(__file__).resolve().parent
GAZETTEER = SCRIPT_DIR / "gazetteer.json"
REVIEW = SCRIPT_DIR / "regions_review.json"
WORD = r"[^\W_]"
# A word keeps its inner hyphens and apostrophes ("Saudi-Arabien", "Côte
# d'Ivoire" is two words), so a name written with a hyphen matches as one word;
# the parts of a hyphenated word are looked up too ("Syrian-Turkish border").
TOKEN = re.compile(r"[^\W_]+(?:[-'][^\W_]+)*")
APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "ʼ": "'"})


def normalise(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(APOSTROPHES)


@dataclass(frozen=True)
class Name:
    words: tuple[str, ...]   # case-folded
    raw: tuple[str, ...]     # as written, for case-sensitive names
    prefix: bool             # the last word may continue ("syrisch*")
    sensitive: bool
    place: str

    @classmethod
    def parse(cls, name: str, place: str) -> "Name":
        sensitive, prefix = name.startswith("="), name.endswith("*")
        raw = tuple(normalise(name.strip("=*")).split())
        return cls(tuple(word.casefold() for word in raw), raw, prefix, sensitive, place)

    def length(self) -> int:
        return sum(len(word) for word in self.words) + len(self.words) - 1


@dataclass(frozen=True)
class Match:
    place: str      # Wikidata id
    field: str      # "title" or "abstract" (or "focus" for people)
    text: str       # the words that matched
    start: int


def _pattern(name: str) -> str:
    """One gazetteer name as a regular expression with word boundaries."""
    sensitive = name.startswith("=")
    prefix = name.endswith("*")
    core = name.strip("=*")
    body = r"\s+".join(re.escape(part) for part in core.split())
    if prefix:
        body += rf"{WORD}*"
    body = rf"(?<!{WORD}){body}(?!{WORD})"
    return f"(?-i:{body})" if sensitive else f"(?i:{body})"


class Gazetteer:
    def __init__(self, data: dict, review: dict | None = None):
        self.data = data
        self.places = {place["id"]: place for place in data["places"]}
        self.macros = {macro["id"]: macro for macro in data["macro_regions"]}
        self.ignore = re.compile("|".join(_pattern(phrase) for phrase in
                                          sorted(data.get("ignore", []), key=len, reverse=True)))
        # Names indexed by their first word. A one-word name ending in * is
        # indexed by its stem and found by trying each prefix of a word, which
        # is a handful of dictionary lookups rather than a regular expression
        # with a thousand alternatives (tried first, and fifty times slower).
        self.by_first: defaultdict[str, list[Name]] = defaultdict(list)
        self.by_stem: defaultdict[str, list[Name]] = defaultdict(list)
        for place in data["places"]:
            for raw in place["names"]:
                name = Name.parse(raw, place["id"])
                if name.prefix and len(name.words) == 1:
                    self.by_stem[name.words[0]].append(name)
                else:
                    self.by_first[name.words[0]].append(name)
        self.stem_lengths = sorted({len(stem) for stem in self.by_stem})
        review = review or {}
        self.decisions = {(d["slug"], d["place"]): d for d in review.get("decisions", [])}
        self.reviewed = review.get("reviewed")

    @classmethod
    def load(cls, gazetteer: Path = GAZETTEER, review: Path = REVIEW) -> "Gazetteer":
        data = json.loads(gazetteer.read_text(encoding="utf-8"))
        decisions = json.loads(review.read_text(encoding="utf-8")) if review.is_file() else None
        return cls(data, decisions)

    def find(self, text: str, field: str) -> list[Match]:
        """Every place named in ``text``; overlapping names resolve to the longest."""
        if not text:
            return []
        text = normalise(text)
        masked = self.ignore.sub(lambda m: " " * len(m.group(0)), text)
        words = [(m.start(), m.end(), m.group(0)) for m in TOKEN.finditer(masked)]
        candidates: list[tuple[int, int, str]] = []

        def word_matches(name: Name, i: int) -> bool:
            if i + len(name.words) > len(words):
                return False
            for offset, (expected, raw) in enumerate(zip(name.words, name.raw)):
                actual = words[i + offset][2]
                last = offset == len(name.words) - 1
                folded = actual.casefold()
                if not (folded == expected or (last and name.prefix and folded.startswith(expected))):
                    return False
                if name.sensitive and not (actual == raw or (last and name.prefix and actual.startswith(raw))):
                    return False
            return True

        def stems(start: int, end: int, word: str):
            folded = word.casefold()
            # A hyphenated word is read through its parts ("Syrian-Turkish" is
            # Syria and Turkey); only a stem with its own hyphen spans it whole.
            hyphenated = "-" in folded
            for length in self.stem_lengths:
                if length > len(folded):
                    break
                stem = folded[:length]
                if hyphenated and "-" not in stem:
                    continue
                for name in self.by_stem.get(stem, ()):
                    if not name.sensitive or word.startswith(name.raw[0]):
                        candidates.append((start, end, name.place))

        for i, (start, end, word) in enumerate(words):
            for name in self.by_first.get(word.casefold(), ()):
                if word_matches(name, i):
                    candidates.append((start, words[i + len(name.words) - 1][1], name.place))
            stems(start, end, word)
            if "-" in word:
                offset = start
                for part in word.split("-"):
                    for name in self.by_first.get(part.casefold(), ()):
                        if len(name.words) == 1 and (not name.sensitive or part == name.raw[0]):
                            candidates.append((offset, offset + len(part), name.place))
                    stems(offset, offset + len(part), part)
                    offset += len(part) + 1

        # Longest first, then leftmost; a shorter name inside a longer one's
        # span is dropped ("Indian" inside "Indian Ocean").
        chosen: list[Match] = []
        taken: list[tuple[int, int]] = []
        for start, end, place in sorted(set(candidates), key=lambda c: (-(c[1] - c[0]), c[0], c[2])):
            if all(end <= a or start >= b for a, b in taken):
                chosen.append(Match(place, field, text[start:end], start))
                taken.append((start, end))
        return sorted(chosen, key=lambda m: m.start)

    def record_matches(self, record: dict) -> list[Match]:
        title = own_title(record) if record.get("document_type") == "Book reviews" else \
            " ".join(part for part in (record.get("title"), record.get("subtitle")) if part)
        return self.find(title, "title") + self.find(record.get("abstract", ""), "abstract")

    def decide(self, slug: str, match: Match) -> str | None:
        """The place a match counts for after review, or None if rejected."""
        decision = self.decisions.get((slug, match.place))
        if decision:
            return decision.get("to") if not decision.get("accept", True) or decision.get("to") else match.place
        return match.place

    def places_of(self, record: dict) -> list[str]:
        """Distinct places, in order of first mention, after review decisions."""
        result: list[str] = []
        for match in self.record_matches(record):
            place = self.decide(record["slug"], match)
            if place and place not in result:
                result.append(place)
        return result

    def is_ambiguous(self, place: str) -> bool:
        return bool(self.places[place].get("ambiguous"))


# --- Review report ------------------------------------------------------------

SAMPLE_PER_REGION = 12
CONTEXT = 70


def snippet(text: str, match: Match) -> str:
    text = normalise(text)
    start = max(0, match.start - CONTEXT)
    end = min(len(text), match.start + len(match.text) + CONTEXT)
    body = text[start:match.start] + "**" + text[match.start:match.start + len(match.text)] + "**" + text[match.start + len(match.text):end]
    return ("…" if start else "") + body.replace("\n", " ") + ("…" if end < len(text) else "")


def report(gazetteer: Gazetteer, records: list[dict], people: list[dict]) -> str:
    """Markdown listing every place's matches for review."""
    import random
    from collections import Counter, defaultdict

    rng = random.Random(42)
    counts: Counter = Counter()
    fields: defaultdict[str, Counter] = defaultdict(Counter)
    by_place: defaultdict[str, list] = defaultdict(list)
    for record in records:
        texts = {"title": " ".join(p for p in (record.get("title"), record.get("subtitle")) if p),
                 "abstract": record.get("abstract", "")}
        if record.get("document_type") == "Book reviews":
            texts["title"] = own_title(record)
        for match in gazetteer.record_matches(record):
            by_place[match.place].append((record, match, texts[match.field]))
            fields[match.place][match.field] += 1
        for place in gazetteer.places_of(record):
            counts[place] += 1

    lines = ["# Regions review", "",
             "Generated by `python data_prep/regions.py --report`. Every place in `gazetteer.json` with the",
             "number of publications it is assigned to after review decisions, where the name was found,",
             "every match of a name marked ambiguous, and a seeded sample of the other matches.", ""]
    reviewed = gazetteer.reviewed
    if reviewed:
        lines += [f"Reviewed by {reviewed.get('by')} on {reviewed.get('date')}: {reviewed.get('scope', '')}", ""]
    lines += ["## Counts", "", "| Place | Region | Publications | In titles | In abstracts |", "| --- | --- | ---: | ---: | ---: |"]
    for place in sorted(gazetteer.places.values(), key=lambda p: (-counts[p["id"]], p["en"])):
        pid = place["id"]
        lines.append(f"| {place['en']} | {gazetteer.macros[place['macro']]['en']} | {counts[pid]} | "
                     f"{fields[pid]['title']} | {fields[pid]['abstract']} |")

    lines += ["", "## Ambiguous names, every match", ""]
    for place in sorted((p for p in gazetteer.places.values() if p.get("ambiguous")), key=lambda p: p["en"]):
        lines += [f"### {place['en']} ({place['id']})", ""]
        for record, match, text in by_place[place["id"]]:
            decision = gazetteer.decisions.get((record["slug"], place["id"]))
            state = "unreviewed" if not decision else ("→ " + gazetteer.places[decision["to"]]["en"]) if decision.get("to") \
                else ("accepted" if decision.get("accept", True) else "rejected")
            lines.append(f"- `{record['slug']}` [{state}] ({match.field}) {snippet(text, match)}")
        lines.append("")

    lines += ["## Sample of other matches", ""]
    for macro in gazetteer.macros.values():
        pool = [item for pid, items in by_place.items() if gazetteer.places[pid]["macro"] == macro["id"]
                and not gazetteer.places[pid].get("ambiguous") for item in items]
        pool.sort(key=lambda item: (item[0]["slug"], item[1].start))
        lines += [f"### {macro['en']} ({len(pool)} matches)", ""]
        for record, match, text in rng.sample(pool, min(SAMPLE_PER_REGION, len(pool))):
            lines.append(f"- {gazetteer.places[match.place]['en']} ({match.field}) {snippet(text, match)}")
        lines.append("")

    lines += ["## Researchers' stated regional focus", ""]
    for person in people:
        if person.get("regional_focus"):
            found = [gazetteer.places[m.place]["en"] for m in gazetteer.find(person["regional_focus"], "focus")]
            lines.append(f"- {person['name']}: {person['regional_focus']} → {', '.join(dict.fromkeys(found)) or 'nothing matched'}")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    import argparse
    import sys

    from output import atomic_text

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--report", type=Path, nargs="?", const=SCRIPT_DIR / "reports" / "regions-review.md",
                        help="write the review report (default: reports/regions-review.md)")
    args = parser.parse_args(argv)
    gazetteer = Gazetteer.load()
    records = json.loads((SCRIPT_DIR / "raw_data" / "publications.json").read_text(encoding="utf-8"))["publications"]
    people_path = SCRIPT_DIR / "raw_data" / "people.json"
    people = json.loads(people_path.read_text(encoding="utf-8"))["people"] if people_path.is_file() else []
    placed = sum(1 for record in records if gazetteer.places_of(record))
    print(f"{placed} of {len(records)} publications name at least one of {len(gazetteer.places)} places")
    if args.report:
        atomic_text(args.report, report(gazetteer, records, people))
        print(f"wrote {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
