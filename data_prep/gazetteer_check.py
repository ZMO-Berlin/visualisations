#!/usr/bin/env python3
"""Check the gazetteer against Wikidata and fetch what the map needs.

``gazetteer.json`` is curated by hand, and a hand-typed Wikidata id is easy to
get wrong — Q-numbers are not memorable, and a wrong one would put "Benin" on
the map wherever that item happens to be. This script asks Wikidata, for every
id, for its English, German and French labels and its coordinates, and
reports every place whose English label does not match the name the gazetteer
gives it, with the search results for that name as candidates.

It writes ``raw_data/places.json`` — labels and coordinates per id, sorted, no
timestamp — which the dashboard generator reads. Nothing else in the pipeline
talks to Wikidata, so CI never does.

Usage:
    python data_prep/gazetteer_check.py            # check, report, write places.json
    python data_prep/gazetteer_check.py --dry-run  # check and report only
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import unicodedata
from pathlib import Path

import requests

from output import atomic_json

SCRIPT_DIR = Path(__file__).resolve().parent
GAZETTEER = SCRIPT_DIR / "gazetteer.json"
OUTPUT = SCRIPT_DIR / "raw_data" / "places.json"
SPARQL = "https://query.wikidata.org/sparql"
API = "https://www.wikidata.org/w/api.php"
USER_AGENT = "ZMO-Gazetteer-Check/1.0 (+https://github.com/ZMO-Berlin/visualisations; research data preparation)"
BATCH = 80


def fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c)).replace("-", " ").strip()


def session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def fetch(s: requests.Session, ids: list[str]) -> dict[str, dict]:
    """Labels and one coordinate per id, in batches through the query service."""
    found: dict[str, dict] = {}
    for start in range(0, len(ids), BATCH):
        values = " ".join(f"wd:{qid}" for qid in ids[start:start + BATCH])
        query = f"""
        SELECT ?item ?en ?de ?fr (SAMPLE(?coord) AS ?point) WHERE {{
          VALUES ?item {{ {values} }}
          OPTIONAL {{ ?item rdfs:label ?en FILTER(LANG(?en) = "en") }}
          OPTIONAL {{ ?item rdfs:label ?de FILTER(LANG(?de) = "de") }}
          OPTIONAL {{ ?item rdfs:label ?fr FILTER(LANG(?fr) = "fr") }}
          OPTIONAL {{ ?item wdt:P625 ?coord }}
        }} GROUP BY ?item ?en ?de ?fr"""
        for attempt in range(4):
            response = s.get(SPARQL, params={"query": query, "format": "json"}, timeout=60)
            if response.status_code == 200:
                break
            time.sleep(2 ** attempt)
        response.raise_for_status()
        for row in response.json()["results"]["bindings"]:
            qid = row["item"]["value"].rsplit("/", 1)[-1]
            entry = {"label": {lang: row[lang]["value"] for lang in ("en", "de", "fr") if lang in row}}
            point = row.get("point", {}).get("value", "")
            if point.startswith("Point("):
                lon, lat = (float(v) for v in point[6:-1].split())
                entry["coord"] = [round(lon, 3), round(lat, 3)]
            found[qid] = entry
        time.sleep(1)
    return found


def candidates(s: requests.Session, name: str) -> list[str]:
    response = s.get(API, params={"action": "wbsearchentities", "search": name, "language": "en",
                                  "type": "item", "limit": 5, "format": "json"}, timeout=30)
    response.raise_for_status()
    return [f"{hit['id']} {hit.get('label', '')} — {hit.get('description', '')}" for hit in response.json().get("search", [])]


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    gazetteer = json.loads(GAZETTEER.read_text(encoding="utf-8"))
    places = gazetteer["places"]
    s = session()
    missing = [p for p in places if not p.get("id")]
    ids = sorted({p["id"] for p in places if p.get("id")})
    duplicates = sorted({qid for qid in ids if sum(p.get("id") == qid for p in places) > 1})
    found = fetch(s, ids)

    problems = 0
    for place in places:
        qid = place.get("id")
        entry = found.get(qid) if qid else None
        label = (entry or {}).get("label", {}).get("en", "")
        expected = place.get("wikidata_en", place["en"])
        mismatch = not entry or fold(label) != fold(expected)
        unmapped = place.get("mapped", True) and entry and "coord" not in entry
        if mismatch or unmapped or not qid:
            problems += 1
            reason = "no id" if not qid else "unknown id" if not entry else \
                f"label {label!r}" if mismatch else "no coordinates"
            print(f"{place['en']:<32} {qid or '—':<10} {reason}")
            if mismatch or not qid:
                for line in candidates(s, place["en"]):
                    print(f"      {line}")
                time.sleep(0.3)
    if duplicates:
        print("duplicate ids:", ", ".join(duplicates))
        problems += len(duplicates)

    print(f"{len(places)} places, {len(found)} found on Wikidata, {problems} to look at")
    if not args.dry_run:
        atomic_json(OUTPUT, {"source": "https://www.wikidata.org", "places": dict(sorted(found.items()))}, indent=1)
        print(f"wrote {OUTPUT}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
