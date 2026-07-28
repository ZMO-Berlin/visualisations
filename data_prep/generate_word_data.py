#!/usr/bin/env python3
"""Generate word-frequency data for the ZMO word cloud.

Reads one ``.txt`` file per research unit from ``raw_data/``, applies a light
NLP pipeline (tokenise, drop stopwords, lemmatise), and writes one JSON file per
unit plus a ``combined`` file aggregating them all.

Output goes straight to the directory the web app loads from, using the
filenames it expects (``<Unit>_word_frequencies.json``). Run with ``--help`` for
the available options.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import nltk
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
from nltk.tokenize import word_tokenize

# Paths are resolved relative to this file so the script works from any cwd.
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent

DEFAULT_INPUT_DIR = SCRIPT_DIR / "raw_data"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "units_wordcloud" / "data"

COMBINED_NAME = "combined"
MANIFEST_NAME = "units.json"

# Terms common to every unit's description; they crowd out the distinctive
# vocabulary the cloud is meant to surface.
CUSTOM_STOPWORDS = {
    "project", "research", "study", "analysis", "data",
    "also", "within", "including", "would", "may", "one", "two",
}

# NLTK 3.9 replaced the pickled ``punkt`` model with the ``punkt_tab`` tables and
# made ``word_tokenize`` require the latter. Requesting only ``punkt`` — as this
# script previously did — therefore raises LookupError at tokenisation time on
# any current NLTK. Both are listed so the script also works on older releases.
REQUIRED_CORPORA = ("punkt_tab", "punkt", "stopwords", "wordnet")


def ensure_corpora(quiet: bool = True) -> None:
    """Download NLTK corpora that are not already present.

    Checked before downloading so repeat runs stay offline-friendly.
    """
    lookups = {
        "punkt_tab": "tokenizers/punkt_tab",
        "punkt": "tokenizers/punkt",
        "stopwords": "corpora/stopwords",
        "wordnet": "corpora/wordnet",
    }

    for package in REQUIRED_CORPORA:
        try:
            nltk.data.find(lookups[package])
        except LookupError:
            # ``punkt`` is a legacy fallback; on NLTK >= 3.9 it may be absent
            # from the index, which is fine as long as punkt_tab resolved.
            nltk.download(package, quiet=quiet)


class TextProcessor:
    """Turns raw text into a list of lemmatised, filtered tokens."""

    def __init__(self, language: str = "english", min_length: int = 2) -> None:
        self.language = language
        self.min_length = min_length
        # Built once and reused: constructing the lemmatiser and stopword set
        # per file is pure overhead.
        self.lemmatizer = WordNetLemmatizer()
        self.stop_words = set(stopwords.words(language)) | CUSTOM_STOPWORDS

    def process(self, text: str) -> list[str]:
        tokens = word_tokenize(text.lower(), language=self.language)
        return [
            self.lemmatizer.lemmatize(token)
            for token in tokens
            if token.isalpha()
            and len(token) >= self.min_length
            and token not in self.stop_words
        ]


def read_unit_stems(input_dir: Path) -> set[str] | None:
    """Return the file stems that are research units, per the scraper manifest.

    ``scrape_zmo.py`` records which files it produced. Only those contribute to
    the ``combined`` aggregate, so text that lives in ``raw_data/`` without
    coming from a research-unit page — a workshop description, say — still gets
    its own word cloud but does not dilute "All Research Units".

    Returns None when no manifest is present, in which case every file counts.
    """
    manifest_path = input_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        return None

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        return {unit["stem"] for unit in manifest["units"]}
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        print(f"warning: ignoring unreadable {manifest_path.name}: {error}", file=sys.stderr)
        return None


def write_frequencies(counter: Counter, output_path: Path, top_n: int) -> int:
    """Write the ``top_n`` most common entries in the app's JSON shape."""
    payload = [{"text": word, "size": count} for word, count in counter.most_common(top_n)]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(payload)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input-dir", type=Path, default=DEFAULT_INPUT_DIR,
        help=f"directory of source .txt files (default: {DEFAULT_INPUT_DIR.relative_to(REPO_ROOT)})",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR,
        help=f"where to write the JSON files (default: {DEFAULT_OUTPUT_DIR.relative_to(REPO_ROOT)})",
    )
    parser.add_argument(
        "--top-n", type=int, default=100,
        help="number of words to keep per file (default: 100)",
    )
    parser.add_argument(
        "--min-length", type=int, default=2,
        help="discard tokens shorter than this (default: 2)",
    )
    parser.add_argument(
        "--language", default="english",
        help="language for tokenisation and stopwords (default: english)",
    )
    parser.add_argument(
        "--exclude", nargs="*", default=[], metavar="NAME",
        help="source file stems to skip entirely, e.g. --exclude Workshop",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.input_dir.is_dir():
        print(f"error: input directory not found: {args.input_dir}", file=sys.stderr)
        return 1

    excluded = set(args.exclude)
    sources = sorted(
        path for path in args.input_dir.glob("*.txt") if path.stem not in excluded
    )

    if not sources:
        print(f"error: no .txt files to process in {args.input_dir}", file=sys.stderr)
        return 1

    ensure_corpora()
    processor = TextProcessor(language=args.language, min_length=args.min_length)

    unit_stems = read_unit_stems(args.input_dir)
    combined: Counter = Counter()
    combined_sources = 0

    for source in sources:
        tokens = processor.process(source.read_text(encoding="utf-8"))

        in_combined = unit_stems is None or source.stem in unit_stems
        if in_combined:
            combined.update(tokens)
            combined_sources += 1

        output_path = args.output_dir / f"{source.stem}_word_frequencies.json"
        written = write_frequencies(Counter(tokens), output_path, args.top_n)
        flag = "" if in_combined else "  (not a research unit; excluded from combined)"
        print(f"{source.name:<40} {len(tokens):>6} tokens -> {written:>3} words  {output_path.name}{flag}")

    combined_path = args.output_dir / f"{COMBINED_NAME}_word_frequencies.json"
    written = write_frequencies(combined, combined_path, args.top_n)
    label = f"(combined: {combined_sources} unit(s))"
    print(f"{label:<40} {sum(combined.values()):>6} tokens -> {written:>3} words  {combined_path.name}")

    print(f"\nWrote {len(sources) + 1} files to {args.output_dir}")
    print(
        "Reminder: a unit only appears in the UI once it is listed in "
        "units_wordcloud/src/config/ConfigManager.js (groups.items)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
