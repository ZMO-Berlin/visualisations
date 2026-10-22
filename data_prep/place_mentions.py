#!/usr/bin/env python3
"""Places extracted from titles and abstracts by a language model, resolved to Wikidata.

The gazetteer (``regions.py``) finds the places it has names for; a title about
the Atakora mountains, Lake Van, Tranquebar or the Kamarob gorge names none of
them. So every record's title, subtitle and abstract were also read by Claude
Haiku 5.5 agents, which listed the places each publication is about — towns,
provinces, rivers, mountains, valleys, historical states, world regions — with
the exact words used, an English name, a type and a modern country. This module
turns their output into a committed list, ``place_mentions.json``:

* **Checked.** A mention whose words do not occur in the record is dropped: the
  model may name a place, never invent one. The generator checks again on
  every run, so a mention disappears when a corrected title no longer has it.
* **Resolved.** Each distinct name is matched first against the reviewed
  gazetteer, then against Wikidata's search, scored on the exact label, the
  kind of place and the country in the item's description. A name with no
  confident candidate is left unresolved and listed in the report rather than
  pinned to the wrong river. A decision can be corrected by hand in ``names``
  (``"how": "review"``); a later merge keeps it.
* **Placed.** Labels, a coordinate and the countries of every resolved item are
  fetched from Wikidata (for a historical state without a country, those of its
  capital). A place's region follows from its countries: the gazetteer says
  which region each country belongs to, and a place across several regions —
  the Nile, the Himalayas — is transregional. ``regions`` in the list gives the
  region of a country the gazetteer lacks (Belgium, Cambodia) and overrides a
  place whose countries mislead (French Sudan's country is France).

It is a list to refresh, not a pipeline that runs itself: CI has no language
model. ``--pending`` writes the records that are new or changed since their
extraction, in batches, for the next agent run; ``--merge`` takes the agents'
files back. Until then a new record still gets the gazetteer's places.

Usage:
    python data_prep/place_mentions.py --pending DIR          # write batches of records to extract
    python data_prep/place_mentions.py --merge DIR/out_*.json # check, resolve, store, report
    python data_prep/place_mentions.py --report               # rewrite reports/place-mentions.md
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import sys
import time
import unicodedata
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
MENTIONS = SCRIPT_DIR / "place_mentions.json"
REGISTER = SCRIPT_DIR / "raw_data" / "publications.json"
REPORT = SCRIPT_DIR / "reports" / "place-mentions.md"
API = "https://www.wikidata.org/w/api.php"
SPARQL = "https://query.wikidata.org/sparql"
USER_AGENT = "ZMO-Place-Mentions/1.0 (+https://github.com/ZMO-Berlin/visualisations; research data preparation)"
MODEL = {"name": "Claude Haiku 5.5", "id": "claude-haiku-5-5", "vendor": "Anthropic"}
BATCH = 100
README = [
    "Places named in titles, subtitles and abstracts, as listed by Claude Haiku 5.5 agents and",
    "resolved to Wikidata by place_mentions.py. 'records': per publication, the fingerprint of the",
    "text the agents read and the mentions kept (each one's words occur in that text). 'names':",
    "one decision per distinct name, type and country — a Wikidata id, or null when no candidate",
    "was confident; edit one by hand with \"how\": \"review\" and a merge keeps it. 'places':",
    "labels, coordinate and countries from Wikidata for ids the gazetteer does not have. 'regions':",
    "the region of a country the gazetteer does not have, or of a place whose countries mislead",
    "(French Sudan's is France), by Wikidata id.",
    "Refresh: --pending DIR, run the agents on the batches, then --merge DIR/out_*.json.",
]

# What each agent is told, one batch per agent; --pending writes it beside the batches.
PROMPT = """You extract places from publication records of the ZMO (Leibniz-Zentrum Moderner Orient) publication register.

Read the JSON file {batch} — a list of records with slug, type, year, title and sometimes abstract. Titles may be in English, German, French, Arabic, Turkish, Russian or other languages; Arabic is often transliterated.

For EACH record, list every geographic place the publication is about: countries, regions, provinces, cities, towns, villages, neighbourhoods, rivers, lakes, seas, gulfs, oceans, coasts, mountains and mountain ranges, valleys, deserts, islands, peninsulas, historical states and empires (Ottoman Empire, Mughal Empire, German Democratic Republic, Soviet Union), and larger world regions (Middle East, West Africa, Global South, Muslim world).
- Count a demonym or adjective when it points to a place: "Syrian refugees" → Syria; "osmanisch" → Ottoman Empire; "Kurdish" → Kurdistan.
- Exclude: publishers' cities and imprints; a place that is only part of the name of a university, archive, museum or institute ("Humboldt-Universität zu Berlin", "ZMO Berlin"), unless the place itself is studied; journal titles; personal names that look like places ("Daniel Jordan Smith"); words naming a language rather than a place ("translated from Urdu", "in English"); an ethnic group living elsewhere unless its home place is discussed ("Chinese Muslims in Indonesia" → Indonesia only).
- Do not invent places that are not in the text.

For each place give:
- text: the exact words as they appear in the record, copied character for character (this is checked automatically)
- name: the place's usual English name ("Cairo", "Nile", "Atlas Mountains", "Ottoman Empire")
- type: one of country, region, province, city, town, village, neighbourhood, river, lake, sea, ocean, gulf, coast, mountain, mountain range, valley, desert, island, peninsula, historical state, world region, other
- country: the modern country it lies in (English), or "" if it spans several countries or none

Write a JSON file to {out} with exactly this shape:
{{"batch": {n}, "records": [{{"slug": "...", "places": [{{"text": "...", "name": "...", "type": "...", "country": "..."}}]}}]}}
One entry per input record, in the same order, with the same slugs; a record with no place gets "places": []. Write valid JSON only (UTF-8). Do not modify any other file. Then reply with only: the number of records and the number of places you wrote.
"""

TYPES = {"country", "region", "province", "city", "town", "village", "neighbourhood", "river", "lake", "sea",
         "ocean", "gulf", "coast", "mountain", "mountain range", "valley", "desert", "island", "peninsula",
         "historical state", "world region", "other"}
# Physical features: never the country or city of the same name ("Niger",
# "Gambia", "Jordan" as rivers).
PHYSICAL = {"river", "lake", "sea", "ocean", "gulf", "coast", "mountain", "mountain range", "valley", "desert",
            "peninsula"}
# Words in a Wikidata description that say what kind of thing an item is.
TYPE_WORDS = {
    "country": {"country", "state", "republic", "kingdom"},
    "region": {"region", "area", "province", "historical", "territory", "land"},
    "province": {"province", "governorate", "state", "region", "oblast", "department", "district", "county",
                 "prefecture", "division"},
    "city": {"city", "capital", "town", "municipality", "metropolis"},
    "town": {"town", "city", "municipality", "commune", "village", "settlement"},
    "village": {"village", "town", "settlement", "commune"},
    "neighbourhood": {"neighbourhood", "neighborhood", "quarter", "district", "locality", "suburb"},
    "river": {"river", "tributary"},
    "lake": {"lake", "reservoir"},
    "sea": {"sea"},
    "ocean": {"ocean"},
    "gulf": {"gulf", "bay"},
    "coast": {"coast", "littoral", "coastline"},
    "mountain": {"mountain", "peak", "hill", "volcano"},
    "mountain range": {"mountain", "mountains", "range", "massif"},
    "valley": {"valley", "gorge", "canyon"},
    "desert": {"desert"},
    "island": {"island", "archipelago", "islands"},
    "peninsula": {"peninsula"},
    "historical state": {"empire", "kingdom", "sultanate", "caliphate", "state", "dynasty", "former", "historical",
                         "khanate", "emirate", "country", "protectorate", "colony", "mandate"},
    "world region": {"region", "area", "world", "geopolitical", "cultural"},
    "other": set(),
}
PLACE_WORDS = set().union(*TYPE_WORDS.values()) | {"oasis", "plateau", "basin", "strait", "delta", "corridor", "port"}
NOT_PLACES = {
    "film", "album", "song", "single", "band", "family name", "given name", "first name", "surname", "human", "person",
    "novel", "book", "journal", "magazine", "newspaper", "episode", "painting", "football", "club", "company",
    "ship", "genus", "species", "video game", "television", "tv series", "politician", "writer", "actor",
    "singer", "station", "airport", "university", "school", "hospital", "mosque", "church", "building",
    "battle", "treaty", "organization", "organisation", "party", "festival", "ethnic group", "people",
    "language", "dialect", "disambiguation", "wikimedia", "scholarly article", "article",
}
# The dashboard's kinds, from the agents' types.
KIND = {"historical state": "historical", "world region": "world", "ocean": "sea", "gulf": "sea",
        "town": "city", "village": "city"}
ACCEPT = 5


def fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", (text or "").lower())
    return " ".join("".join(c for c in decomposed if not unicodedata.combining(c)).replace("-", " ").split())


def title_of(record: dict) -> str:
    """The title the agents were given: a review's without its imprint."""
    from titles import own_title

    if record.get("document_type") == "Book reviews":
        return own_title(record)
    return " : ".join(part for part in (record.get("title"), record.get("subtitle")) if part)


def record_text(record: dict) -> str:
    return "\n".join(part for part in (title_of(record), record.get("abstract", "")) if part)


def fingerprint(record: dict) -> str:
    return hashlib.sha1(record_text(record).encode("utf-8")).hexdigest()[:10]


def load(path: Path = MENTIONS) -> dict:
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"_readme": README, "model": MODEL, "records": {}, "names": {}, "places": {}, "regions": {}}


def pending(records: list[dict], mentions: dict) -> list[dict]:
    """Records never extracted, or whose text changed since."""
    done = mentions.get("records", {})
    return [r for r in records if done.get(r["slug"], {}).get("fp") != fingerprint(r)]


def batch_items(records: list[dict]) -> list[dict]:
    items = []
    for r in records:
        item = {"slug": r["slug"], "type": r.get("document_type", ""), "year": r.get("year"), "title": title_of(r)}
        if r.get("abstract"):
            item["abstract"] = r["abstract"]
        items.append(item)
    return items


def check(out: dict, register: dict[str, dict]) -> tuple[dict[str, list[dict]], Counter]:
    """Agent output, with every mention verified against its record's text."""
    problems: Counter = Counter()
    checked: dict[str, list[dict]] = {}
    for entry in out.get("records", []):
        record = register.get(entry.get("slug"))
        if not record:
            problems["unknown slug"] += 1
            continue
        text = unicodedata.normalize("NFC", record_text(record)).casefold()
        kept = []
        for place in entry.get("places", []) or []:
            words = unicodedata.normalize("NFC", str(place.get("text", ""))).strip()
            name = str(place.get("name", "")).strip()
            kind = str(place.get("type", "other")).strip().lower()
            if not words or not name:
                problems["empty mention"] += 1
                continue
            if words.casefold() not in text:
                problems["words not in the record"] += 1
                continue
            kept.append({"text": words, "name": name, "type": kind if kind in TYPES else "other",
                         "country": str(place.get("country", "") or "").strip()})
        # One mention per distinct place name in a record.
        seen, unique = set(), []
        for place in kept:
            key = fold(place["name"])
            if key not in seen:
                seen.add(key)
                unique.append(place)
        checked[record["slug"]] = unique
    return checked, problems


def mentioned(record: dict, mentions: dict | None) -> list[dict]:
    """A record's resolved mentions whose words are still in its text."""
    entry = (mentions or {}).get("records", {}).get(record["slug"])
    if not entry:
        return []
    text = unicodedata.normalize("NFC", record_text(record)).casefold()
    return [place for place in entry["places"] if place.get("id") and place["text"].casefold() in text]


# --- Resolution ---------------------------------------------------------------

def name_key(place: dict) -> str:
    return f"{fold(place['name'])}|{place['type']}|{fold(place['country'])}"


def gazetteer_index(gazetteer) -> dict[str, str]:
    index: dict[str, str] = {}
    for place in gazetteer.data["places"]:
        for name in [place["en"], place["de"], place["fr"], place.get("wikidata_en", ""),
                     *(n.strip("=*") for n in place["names"] if not n.endswith("*"))]:
            if name:
                index.setdefault(fold(name), place["id"])
    return index


def from_gazetteer(place: dict, gazetteer, index: dict[str, str]) -> str | None:
    pid = index.get(fold(place["name"]))
    if not pid:
        return None
    if place["type"] in PHYSICAL and gazetteer.places[pid]["kind"] in ("country", "city"):
        return None
    return pid


def search(session, name: str) -> list[dict]:
    for attempt in range(4):
        response = session.get(API, params={"action": "wbsearchentities", "search": name, "language": "en",
                                            "type": "item", "limit": 10, "format": "json"}, timeout=30)
        if response.status_code == 200:
            return response.json().get("search", [])
        time.sleep(2 ** attempt)
    response.raise_for_status()
    return []


def score(candidate: dict, place: dict) -> int:
    label = fold(candidate.get("label", ""))
    description = fold(candidate.get("description", ""))
    words = set(description.replace(",", " ").replace("(", " ").replace(")", " ").split())
    points = 0
    if label == fold(place["name"]):
        points += 3
    elif candidate.get("match", {}).get("type") == "alias" and fold(candidate["match"].get("text", "")) == fold(place["name"]):
        points += 2
    if place["country"] and fold(place["country"]) in description:
        points += 2
    if words & TYPE_WORDS.get(place["type"], set()):
        points += 2
    elif words & PLACE_WORDS:
        points += 1
    if any(term in description for term in NOT_PLACES):
        points -= 6
    if not description:
        points -= 1
    return points


def resolve(names: dict[str, dict], keys: dict[str, dict], gazetteer, session) -> None:
    """Fill ``names`` with an id (or None) for every key not yet decided."""
    index = gazetteer_index(gazetteer)
    for key, place in sorted(keys.items()):
        if key in names:
            continue
        pid = from_gazetteer(place, gazetteer, index)
        if pid:
            names[key] = {"id": pid, "how": "gazetteer"}
            continue
        candidates = search(session, place["name"])
        time.sleep(0.2)
        ranked = sorted(((score(c, place), i, c) for i, c in enumerate(candidates)), key=lambda t: (-t[0], t[1]))
        if ranked and ranked[0][0] >= ACCEPT and (len(ranked) == 1 or ranked[0][0] > ranked[1][0] or ranked[0][1] == 0):
            best = ranked[0][2]
            names[key] = {"id": best["id"], "how": "search", "label": best.get("label", ""),
                          "description": best.get("description", "")}
        else:
            names[key] = {"id": None, "how": "unresolved",
                          "candidates": [f"{c['id']} {c.get('label', '')} — {c.get('description', '')}"
                                         for _, _, c in ranked[:5]]}


def sparql(session, query: str) -> list[dict]:
    for attempt in range(4):
        response = session.get(SPARQL, params={"query": query, "format": "json"}, timeout=90)
        if response.status_code == 200:
            return response.json()["results"]["bindings"]
        time.sleep(3 * (attempt + 1))
    response.raise_for_status()
    return []


def fetch_details(session, ids: list[str]) -> dict[str, dict]:
    """Labels, one coordinate and the countries of each id."""
    found: dict[str, dict] = {qid: {"label": {}, "countries": set()} for qid in ids}
    for start in range(0, len(ids), 60):
        values = " ".join(f"wd:{qid}" for qid in ids[start:start + 60])
        rows = sparql(session, f"""
        SELECT ?item ?lang ?label WHERE {{
          VALUES ?item {{ {values} }} VALUES ?lang {{ "en" "de" "fr" }}
          ?item rdfs:label ?label FILTER(LANG(?label) = ?lang)
        }}""")
        for row in rows:
            found[row["item"]["value"].rsplit("/", 1)[-1]]["label"][row["lang"]["value"]] = row["label"]["value"]
        # The smallest coordinate string, so a refetch picks the same point.
        rows = sparql(session, f"""
        SELECT ?item (MIN(STR(?coord)) AS ?point) WHERE {{
          VALUES ?item {{ {values} }} ?item wdt:P625 ?coord
        }} GROUP BY ?item""")
        for row in rows:
            point = row["point"]["value"]
            if point.startswith("Point("):
                lon, lat = (float(v) for v in point[6:-1].split())
                found[row["item"]["value"].rsplit("/", 1)[-1]]["coord"] = [round(lon, 3), round(lat, 3)]
        # Countries; for a former state without one, its capital's.
        rows = sparql(session, f"""
        SELECT ?item ?country WHERE {{
          VALUES ?item {{ {values} }}
          {{ ?item wdt:P17 ?country }} UNION
          {{ FILTER NOT EXISTS {{ ?item wdt:P17 [] }} ?item wdt:P36/wdt:P17 ?country }}
        }}""")
        for row in rows:
            found[row["item"]["value"].rsplit("/", 1)[-1]]["countries"].add(row["country"]["value"].rsplit("/", 1)[-1])
        time.sleep(1)
    for entry in found.values():
        entry["label"] = {lang: entry["label"][lang] for lang in ("en", "de", "fr") if lang in entry["label"]}
        entry["countries"] = sorted(entry["countries"], key=lambda q: int(q[1:]))
    return found


def country_macros(gazetteer) -> dict[str, str]:
    return {pid: place["macro"] for pid, place in gazetteer.places.items() if place["kind"] in ("country", "historical")}


def macro_of(qid: str, detail: dict, gazetteer, regions: dict[str, str] | None = None) -> str | None:
    """The region of a place: its own entry in ``regions``, else the one its
    countries share; None when no country is known."""
    regions = regions or {}
    if qid in regions:
        return regions[qid]
    known = {**country_macros(gazetteer), **regions}
    macros = {known[c] for c in detail.get("countries", []) if c in known}
    if len(macros) == 1:
        return macros.pop()
    return "transregional" if macros else None


def merge(files: list[str]) -> int:
    import requests

    from output import atomic_json
    from regions import Gazetteer

    gazetteer = Gazetteer.load()
    register = {r["slug"]: r for r in json.loads(REGISTER.read_text(encoding="utf-8"))["publications"]}
    mentions = load()
    mentions["_readme"], mentions["model"] = README, MODEL
    totals: Counter = Counter()
    for path in sorted(files):
        checked, problems = check(json.loads(Path(path).read_text(encoding="utf-8")), register)
        totals.update(problems)
        for slug, places in checked.items():
            mentions["records"][slug] = {"fp": fingerprint(register[slug]), "places": places}
    # Withdrawn records leave.
    mentions["records"] = {slug: entry for slug, entry in sorted(mentions["records"].items()) if slug in register}

    keys = {name_key(p): p for entry in mentions["records"].values() for p in entry["places"]}
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    names = mentions.setdefault("names", {})
    resolve(names, keys, gazetteer, session)
    mentions["names"] = dict(sorted((k, v) for k, v in names.items() if k in keys))
    for entry in mentions["records"].values():
        for place in entry["places"]:
            place["id"] = mentions["names"][name_key(place)]["id"]

    # Details for ids the gazetteer does not have, with the kind most mentions
    # give unless a reviewed decision sets one.
    kinds: dict[str, Counter] = {}
    for entry in mentions["records"].values():
        for place in entry["places"]:
            if place["id"] and place["id"] not in gazetteer.places:
                decision = mentions["names"][name_key(place)]
                kinds.setdefault(place["id"], Counter())[decision.get("kind", place["type"])] += 1
    places = {qid: detail for qid, detail in mentions.get("places", {}).items() if qid in kinds}
    for qid, detail in fetch_details(session, sorted(set(kinds) - set(places))).items():
        places[qid] = detail
    for qid, counter in kinds.items():
        kind = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        places[qid]["kind"] = KIND.get(kind, kind)
    mentions["places"] = dict(sorted(places.items(), key=lambda kv: int(kv[0][1:])))
    mentions["regions"] = dict(sorted(mentions.get("regions", {}).items(), key=lambda kv: int(kv[0][1:])))
    atomic_json(MENTIONS, mentions, indent=1)

    resolved = sum(1 for v in mentions["names"].values() if v["id"])
    print(f"{len(mentions['records'])} record(s) extracted; {sum(len(e['places']) for e in mentions['records'].values())} "
          f"mention(s); {resolved} of {len(mentions['names'])} distinct name(s) resolved")
    for problem, count in totals.most_common():
        print(f"  dropped {count}: {problem}")
    write_report(mentions, gazetteer, register)
    return 0


# --- Report -------------------------------------------------------------------

def write_report(mentions: dict, gazetteer, register: dict[str, dict]) -> None:
    from output import atomic_text

    uses: Counter = Counter()
    for entry in mentions["records"].values():
        for place in entry["places"]:
            uses[name_key(place)] += 1
    names = mentions["names"]
    by_search = [(k, v) for k, v in names.items() if v["how"] in ("search", "review") and v["id"]]
    unresolved = [(k, v) for k, v in names.items() if not v["id"]]
    places = mentions.get("places", {})
    gained = sum(1 for slug, entry in mentions["records"].items()
                 if slug in register and any(p.get("id") for p in entry["places"]) and not gazetteer.places_of(register[slug]))
    lines = [
        "# Places named in titles and abstracts",
        "",
        f"Written by `place_mentions.py` from the output of {MODEL['name']} agents. "
        f"{len(mentions['records'])} records read; {sum(uses.values())} mentions of {len(names)} distinct names, "
        f"{len(names) - len(unresolved)} resolved to Wikidata ({sum(1 for v in names.values() if v['how'] == 'gazetteer')} "
        f"through the gazetteer). {gained} records name no gazetteer place but have a resolved mention.",
        "",
        "Correct a decision in `place_mentions.json` → `names` (set `id`, and `\"how\": \"review\"`), "
        "then run `--report` again.",
        "",
        "## Resolved by Wikidata search",
        "",
        "Check these: the search found one confident candidate, which may still be a namesake.",
        "",
        "| Name | Type | Country given | Mentions | Wikidata | Description | Region |",
        "|---|---|---|---:|---|---|---|",
    ]
    for key, decision in sorted(by_search, key=lambda kv: (-uses[kv[0]], kv[0])):
        name, kind, country = key.split("|")
        detail = places.get(decision["id"], {})
        macro = "gazetteer" if decision["id"] in gazetteer.places else             macro_of(decision["id"], detail, gazetteer, mentions.get("regions")) or "**none**"
        coord = "" if detail.get("coord") or decision["id"] in gazetteer.places else " (no coordinate)"
        lines.append(f"| {name} | {kind} | {country} | {uses[key]} | [{decision['id']}](https://www.wikidata.org/wiki/{decision['id']}) "
                     f"{decision.get('label', '')} | {decision.get('description', '').replace('|', '/')}{coord} | {macro} |")
    lines += ["", "## Unresolved", "", "No candidate was confident enough; these mentions are not shown.", "",
              "| Name | Type | Country given | Mentions | Best candidates |", "|---|---|---|---:|---|"]
    for key, decision in sorted(unresolved, key=lambda kv: (-uses[kv[0]], kv[0])):
        name, kind, country = key.split("|")
        lines.append(f"| {name} | {kind} | {country} | {uses[key]} | {'; '.join(decision.get('candidates', [])[:3]).replace('|', '/')} |")
    outside = sorted(qid for qid, detail in places.items() if macro_of(qid, detail, gazetteer, mentions.get("regions")) is None)
    lines += ["", "## Places without a region", "",
              "None of their countries is in the gazetteer; add the country there to place them.", ""]
    lines += [f"- [{qid}](https://www.wikidata.org/wiki/{qid}) {places[qid]['label'].get('en', '')} "
              f"({', '.join(places[qid].get('countries', [])) or 'no country'})" for qid in outside] or ["None."]
    atomic_text(REPORT, "\n".join(lines) + "\n")
    print(f"wrote {REPORT.relative_to(SCRIPT_DIR.parent)}")


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pending", type=Path, help="write batch_NN.json files of records to extract here")
    parser.add_argument("--merge", nargs="+", help="agent output files to check, resolve and store")
    parser.add_argument("--report", action="store_true", help="rewrite reports/place-mentions.md")
    args = parser.parse_args(argv)

    if args.pending:
        from output import atomic_json, atomic_text

        records = json.loads(REGISTER.read_text(encoding="utf-8"))["publications"]
        todo = batch_items(pending(records, load()))
        args.pending.mkdir(parents=True, exist_ok=True)
        prompts = []
        for n in range(0, len(todo), BATCH):
            number = n // BATCH + 1
            batch = args.pending.resolve() / f"batch_{number:02d}.json"
            atomic_json(batch, todo[n:n + BATCH], indent=1)
            prompts.append(PROMPT.format(batch=batch, out=batch.with_name(f"out_{number:02d}.json"), n=number))
        if prompts:
            atomic_text(args.pending / "prompts.md", "\n---\n\n".join(prompts))
        print(f"{len(todo)} record(s) to extract, in {len(prompts)} batch(es) under {args.pending}; "
              f"one agent per prompt in prompts.md, then --merge {args.pending / 'out_*.json'}")
        return 0
    if args.merge:
        return merge([f for pattern in args.merge for f in glob.glob(pattern)])
    if args.report:
        from regions import Gazetteer

        register = {r["slug"]: r for r in json.loads(REGISTER.read_text(encoding="utf-8"))["publications"]}
        write_report(load(), Gazetteer.load(), register)
        return 0
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
