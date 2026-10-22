#!/usr/bin/env python3
"""Languages decided by a language model where the title detector could not tell.

``languages.py`` reads titles and returns ``und`` rather than guess: for book
reviews, whose title is the reviewed book's, and for bare names, single words
and bilingual titles. For those records Claude Haiku 5.5 agents were given the
title and subtitle, the journal or volume, publisher and series, and the start
of the abstract, and asked in which language the publication itself is
written, how sure they were and why — "German-language journal (H-Soz-Kult)",
"Name-only title; Encyclopaedia of Islam, Three is English". Their answers are
committed in ``language_decisions.json``:

* Only a decision of high or medium confidence is used; one the agent left
  ``und`` stays undetermined — above all reviews in multilingual journals such
  as Die Welt des Islams, where the venue does not say.
* A decision holds while the record still has the title and venue it was made
  on. When either changes, the record is undetermined again until the next
  run, rather than keeping a language decided for different words.
* The detector always goes first: a decision never overrides a language it
  found.

Like ``place_mentions.py``, this is a list to refresh, not a pipeline that
runs itself: CI has no language model.

Usage:
    python data_prep/language_decisions.py --pending DIR          # records to decide, in batches
    python data_prep/language_decisions.py --merge DIR/out_*.json # store the agents' answers
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DECISIONS = SCRIPT_DIR / "language_decisions.json"
REGISTER = SCRIPT_DIR / "raw_data" / "publications.json"
MODEL = {"name": "Claude Haiku 5.5", "id": "claude-haiku-5-5", "vendor": "Anthropic"}
USED = {"high", "medium"}
BATCH = 175
ABSTRACT_START = 400
README = [
    "Languages decided by Claude Haiku 5.5 agents for records whose title languages.py leaves",
    "undetermined (book reviews, bare names, bilingual titles). Per record: the language (ISO 639-1,",
    "or und), the agent's confidence and its reason, and a fingerprint of the title and venue it",
    "read. The generator uses high- and medium-confidence decisions whose fingerprint still matches.",
    "Refresh: --pending DIR, run the agents on the batches, then --merge DIR/out_*.json.",
]


# What each agent is told, one batch per agent; --pending writes it beside the batches.
PROMPT = """You decide the language publications are written in, for records of the ZMO (Leibniz-Zentrum Moderner Orient) publication register whose title alone does not tell.

Read the JSON file {batch} — a list of records with slug, type, title and, where the register has them, subtitle, journal, in_volume (the volume a contribution appeared in), publisher, series and abstract_start. Many are book reviews, whose title is the reviewed book's: the title says nothing about the language of the review, but the journal usually does. Others are bare names (encyclopaedia headwords), single words or bilingual titles.

For EACH record decide the language the publication itself is written in, from every clue: the journal's or volume's language, the publisher, the series, the abstract, genre words ("Rez.", "Tagungsbericht"). A "Rev.:" or "Rez.:" prefix is added by the register and is not a clue on its own.
- lang: the ISO 639-1 code (en, de, fr, ar, ru…), or "und" when the clues do not settle it — for instance a review in a journal that publishes in several languages.
- confidence: "high", "medium" or "low".
- basis: one short line naming the clue ("German-language journal (H-Soz-Kult)").
Do not guess from the reviewed book's title alone.

Write a JSON file to {out} with exactly this shape:
{{"records": [{{"slug": "...", "lang": "...", "confidence": "...", "basis": "..."}}]}}
One entry per input record, in the same order, with the same slugs. Write valid JSON only (UTF-8). Do not modify any other file. Then reply with only: the number of records and how many have a language other than "und".
"""


def volume_of(record: dict) -> str:
    """The title of the volume a contribution appeared in."""
    return (record.get("published_in") or {}).get("title", "")


def fingerprint(record: dict) -> str:
    text = "\n".join([record.get("title") or "", record.get("subtitle") or "", record.get("journal") or "",
                      volume_of(record)])
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def load(path: Path = DECISIONS) -> dict:
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"_readme": README, "model": MODEL, "records": {}}


def decided_language(record: dict, decisions: dict | None) -> str | None:
    """The agent's language for a record, if usable and still current."""
    entry = (decisions or {}).get("records", {}).get(record["slug"])
    if not entry or entry.get("confidence") not in USED or entry.get("lang", "und") == "und":
        return None
    return entry["lang"] if entry.get("fp") == fingerprint(record) else None


def item(record: dict) -> dict:
    """What the agents are given for one record."""
    entry = {"slug": record["slug"], "type": record.get("document_type", ""), "title": record.get("title", "")}
    for key, value in (("subtitle", record.get("subtitle")), ("journal", record.get("journal")),
                       ("in_volume", volume_of(record)), ("publisher", record.get("publisher")),
                       ("series", record.get("series"))):
        if value:
            entry[key] = value
    if record.get("abstract"):
        entry["abstract_start"] = record["abstract"][:ABSTRACT_START]
    return entry


def pending(records: list[dict], decisions: dict) -> list[dict]:
    """Undetermined records without a decision for their current title and venue."""
    from languages import UNDETERMINED, detect_language

    done = decisions.get("records", {})
    return [r for r in records if detect_language(r) == UNDETERMINED and done.get(r["slug"], {}).get("fp") != fingerprint(r)]


def merge(files: list[str]) -> int:
    from output import atomic_json

    register = {r["slug"]: r for r in json.loads(REGISTER.read_text(encoding="utf-8"))["publications"]}
    decisions = load()
    decisions["_readme"], decisions["model"] = README, MODEL
    problems: Counter = Counter()
    for path in sorted(files):
        for answer in json.loads(Path(path).read_text(encoding="utf-8")).get("records", []):
            record = register.get(answer.get("slug"))
            lang = str(answer.get("lang", "")).strip().lower()
            if not record:
                problems["unknown slug"] += 1
                continue
            if not (lang == "und" or (len(lang) == 2 and lang.isalpha())):
                problems["not an ISO 639-1 code"] += 1
                continue
            decisions["records"][record["slug"]] = {
                "fp": fingerprint(record), "lang": lang,
                "confidence": str(answer.get("confidence", "low")).strip().lower(),
                "basis": str(answer.get("basis", "")).strip(),
            }
    decisions["records"] = {slug: entry for slug, entry in sorted(decisions["records"].items()) if slug in register}
    atomic_json(DECISIONS, decisions, indent=1)
    usable = Counter(entry["lang"] for entry in decisions["records"].values()
                     if entry["confidence"] in USED and entry["lang"] != "und")
    print(f"{len(decisions['records'])} decision(s); {sum(usable.values())} usable: "
          + ", ".join(f"{lang} {n}" for lang, n in usable.most_common()))
    for problem, count in problems.most_common():
        print(f"  dropped {count}: {problem}")
    return 0


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pending", type=Path, help="write batch_NN.json files of records to decide here")
    parser.add_argument("--merge", nargs="+", help="agent output files to store")
    args = parser.parse_args(argv)

    if args.pending:
        from output import atomic_json, atomic_text

        records = json.loads(REGISTER.read_text(encoding="utf-8"))["publications"]
        todo = [item(r) for r in pending(records, load())]
        args.pending.mkdir(parents=True, exist_ok=True)
        prompts = []
        for n in range(0, len(todo), BATCH):
            number = n // BATCH + 1
            batch = args.pending.resolve() / f"batch_{number:02d}.json"
            atomic_json(batch, todo[n:n + BATCH], indent=1)
            prompts.append(PROMPT.format(batch=batch, out=batch.with_name(f"out_{number:02d}.json")))
        if prompts:
            atomic_text(args.pending / "prompts.md", "\n---\n\n".join(prompts))
        print(f"{len(todo)} record(s) to decide, in {len(prompts)} batch(es) under {args.pending}; "
              f"one agent per prompt in prompts.md, then --merge {args.pending / 'out_*.json'}")
        return 0
    if args.merge:
        return merge([f for pattern in args.merge for f in glob.glob(pattern)])
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
