"""The enrichment layers of the publications dashboard.

``generate_publication_data.py`` builds the register itself; this module adds
what other sources say about it, each kept apart so its origin stays visible:

* ``raw_data/people.json`` (zmo.de people pages) → ``people.json``: which
  authors have a page on zmo.de, and what it shows (see ``people.py``);
* ``raw_data/openalex.json`` (OpenAlex) → ``openalex.json``: co-authors'
  institutions, the literature register works cite, and citations between
  register works — plus each record's open-access status;
* ``raw_data/themes.json`` (``build_themes.py``) and ``theme_labels.json``
  (written by Claude Opus 5.5) → ``themes.json``: themes, areas and map
  positions — plus each record's theme;
* ``languages.py`` → each record's detected language, and where it cannot
  tell, ``language_decisions.json`` (Claude Haiku 5.5, ``language_decisions.py``);
* ``gazetteer.json`` and ``regions_review.json`` (``regions.py``), with
  coordinates from ``raw_data/places.json`` (Wikidata), and the places Claude
  Haiku 5.5 found in titles and abstracts (``place_mentions.json``,
  ``place_mentions.py``) → ``regions.json``: the places each record names,
  their regions and positions, and the regional focus current researchers
  state on zmo.de — plus each record's places;
* ``raw_data/subjects.json`` (``fetch_subjects.py``) → ``subjects.json``: the
  GND subject headings German libraries gave the register's books — plus each
  book's headings.

Every layer is optional: a missing input leaves its fields out rather than
failing the register. A present but inconsistent one fails loudly — above all
theme labels written for a different clustering, which would otherwise put
confident names on the wrong groups.

The secondary files refer to records by their position in
``publications.json`` rather than repeating two thousand slugs, and carry the
dataset id they were built against, so the dashboard can refuse a mismatched
pair instead of attaching institutions to the wrong publications.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ZMO_INSTITUTION = "I2801953415"
OPEN_STATUSES = {"gold", "diamond", "hybrid", "bronze", "green"}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def load(raw_dir: Path, labels_path: Path) -> dict:
    return {
        "people": read_json(raw_dir / "people.json"),
        "openalex": read_json(raw_dir / "openalex.json"),
        "themes": read_json(raw_dir / "themes.json"),
        "labels": read_json(labels_path),
        "places": read_json(raw_dir / "places.json"),
        "subjects": read_json(raw_dir / "subjects.json"),
        "gazetteer": _gazetteer(),
        "mentions": read_json(SCRIPT_DIR / "place_mentions.json"),
        "decisions": read_json(SCRIPT_DIR / "language_decisions.json"),
    }


def _gazetteer():
    from regions import GAZETTEER, Gazetteer

    return Gazetteer.load() if GAZETTEER.is_file() else None


def check_labels(themes: dict, labels: dict | None) -> None:
    """Refuse labels that were written for a different clustering."""
    if labels is None:
        raise ValueError("raw_data/themes.json exists but theme_labels.json does not; "
                         "label the themes from reports/theme-brief.md")
    if labels.get("fit_signature") != themes["fit"]["signature"]:
        raise ValueError("theme_labels.json was written for another fit "
                         f"({labels.get('fit_signature')} ≠ {themes['fit']['signature']}); relabel")
    for theme in themes["themes"]:
        entry = labels["themes"].get(theme["id"])
        if not entry or entry.get("signature") != theme["signature"]:
            raise ValueError(f"theme {theme['id']} has no label for its current membership; relabel")
    for area in themes["areas"]:
        if area["id"] not in labels["areas"]:
            raise ValueError(f"area {area['id']} has no label; relabel")


def places_of(record: dict, gazetteer, mentions: dict | None) -> tuple[list[str], list[str]]:
    """A record's places: the gazetteer's, then those only the language model
    named. Returns them with the ones the model added."""
    from place_mentions import mentioned

    places = gazetteer.places_of(record)
    known = (mentions or {}).get("places", {})
    added = []
    for mention in mentioned(record, mentions):
        place = mention["id"]
        # A reviewed decision on this record (Jordan the river, not the
        # country) holds for the model's mention too.
        decision = gazetteer.decisions.get((record["slug"], place))
        if decision:
            place = decision.get("to") or (place if decision.get("accept", True) else None)
        if place and place not in places and (place in gazetteer.places or place in known):
            places.append(place)
            added.append(place)
    return places, added


def annotate(dataset: list[dict], records: list[dict], extras: dict) -> None:
    """Add per-record fields: language, theme, places, open access, OpenAlex id.

    What the language model contributed is counted in ``extras["stats"]``."""
    from language_decisions import decided_language
    from languages import UNDETERMINED, detect_language

    raw = {record["slug"]: record for record in records}
    works = (extras.get("openalex") or {}).get("works", {})
    themed = (extras.get("themes") or {}).get("records", {})
    gazetteer = extras.get("gazetteer")
    books = (extras.get("subjects") or {}).get("books", {})
    stats = extras.setdefault("stats", {"languageDecided": 0, "placesAdded": set(), "recordsWithAdded": 0})

    for record in dataset:
        source = raw[record["slug"]]
        lang = detect_language(source)
        if lang == UNDETERMINED:
            lang = decided_language(source, extras.get("decisions")) or UNDETERMINED
            stats["languageDecided"] += lang != UNDETERMINED
        if lang != UNDETERMINED:
            record["lang"] = lang
        if record["slug"] in themed:
            record["theme"] = themed[record["slug"]]["theme"]
        if gazetteer:
            places, added = places_of(source, gazetteer, extras.get("mentions"))
            if places:
                record["places"] = places
            stats["placesAdded"].update(added)
            stats["recordsWithAdded"] += bool(added)
        headings = [subject["id"] for subject in books.get(record["slug"], {}).get("subjects", [])]
        if headings:
            record["gnd"] = headings
        work = works.get(record["slug"])
        if work:
            record["openalex"] = work["id"]
            if work.get("oa_status"):
                record["oa"] = work["oa_status"]
            url = work.get("oa_url")
            # A free copy is worth a link only when it is not the DOI the
            # list already links to.
            if url and work.get("oa_status") in OPEN_STATUSES and not (
                    record.get("doi") and record["doi"].lower() in url.lower()):
                record["oaUrl"] = url


def people_file(dataset: list[dict], extras: dict) -> dict:
    from people import match_people, profile

    source = extras.get("people")
    if not source:
        return {}
    authors = sorted({name for record in dataset for name in record.get("authors", [])})
    matched = match_people(authors, source["people"])
    return {author: profile(person) for author, person in sorted(matched.items())}


def themes_file(dataset: list[dict], extras: dict, dataset_id: str) -> dict | None:
    themes, labels = extras.get("themes"), extras.get("labels")
    if not themes:
        return None
    check_labels(themes, labels)
    placed = themes["records"]
    counts = Counter(record.get("theme") for record in dataset if record.get("theme"))
    method = themes["method"]
    return {
        "datasetId": dataset_id,
        "attribution": {
            "labels": {"author": labels["author"], "model": labels["model"], "date": labels["date"],
                       **({"reviewed": labels["reviewed"]} if labels.get("reviewed") else {})},
            "embedding": {"model": method["embedding"]["model"],
                          "revision": method["embedding"]["model_revision"],
                          "url": f"https://huggingface.co/{method['embedding']['model']}"},
        },
        "method": method,
        "areas": [{"id": area["id"], "themes": area["themes"],
                   "label": {k: labels["areas"][area["id"]][k] for k in ("en", "de")},
                   "description": labels["areas"][area["id"]]["description"]}
                  for area in themes["areas"]],
        "themes": [{"id": theme["id"], "area": theme["area"], "size": counts[theme["id"]],
                    "terms": theme["terms"],
                    "label": {k: labels["themes"][theme["id"]][k] for k in ("en", "de")},
                    "description": labels["themes"][theme["id"]]["description"]}
                   for theme in themes["themes"]],
        # Aligned with publications.json; null for a record without a place.
        "points": {
            "x": [placed[r["slug"]]["x"] if r["slug"] in placed else None for r in dataset],
            "y": [placed[r["slug"]]["y"] if r["slug"] in placed else None for r in dataset],
            "added": [i for i, r in enumerate(dataset)
                      if r["slug"] in placed and placed[r["slug"]]["placed"] != "fit"],
        },
    }


def openalex_file(dataset: list[dict], extras: dict, dataset_id: str) -> dict | None:
    source = extras.get("openalex")
    if not source:
        return None
    index = {record["slug"]: i for i, record in enumerate(dataset)}
    works = {slug: work for slug, work in source["works"].items() if slug in index}

    institutions: dict[str, dict] = {}
    per_record = []
    for slug in sorted(works, key=index.get):
        ids = []
        for inst in works[slug].get("institutions", []):
            if inst["id"] == ZMO_INSTITUTION:
                continue
            institutions.setdefault(inst["id"], {"id": inst["id"], "name": inst["name"],
                                                 **({"country": inst["country"]} if inst.get("country") else {})})
            ids.append(inst["id"])
        if ids:
            per_record.append([index[slug], ids])
    order = sorted(institutions)
    position = {iid: n for n, iid in enumerate(order)}

    citing = defaultdict(list)
    for slug in sorted(works, key=index.get):
        for ref in works[slug].get("referenced_works", []):
            if ref in source["references"]:
                citing[ref].append(index[slug])

    references = [{"id": rid, **{k: v for k, v in ref.items() if k != "count"}, "by": citing[rid]}
                  for rid, ref in sorted(source["references"].items()) if citing[rid]]
    citations = sorted({(index[a], index[b]) for a, b in source["citations"] if a in index and b in index})
    coverage = source["coverage"]
    return {
        "datasetId": dataset_id,
        "source": source["source"],
        "coverage": {
            "register": len(dataset),
            "matched": len(works),
            "byMethod": coverage["matched"],
            "withReferences": sum(1 for w in works.values() if w.get("referenced_works")),
            "references": len(references),
            "citations": len(citations),
        },
        # Records whose OpenAlex entry has a reference list at all: the
        # denominator of every citation figure, since the rest cannot cite.
        "referenced": sorted(index[slug] for slug, work in works.items() if work.get("referenced_works")),
        "institutions": [institutions[iid] for iid in order],
        "works": [[record, [position[i] for i in ids]] for record, ids in per_record],
        "references": references,
        "citations": [list(pair) for pair in citations],
    }


def regions_file(dataset: list[dict], extras: dict, dataset_id: str, people: dict) -> dict | None:
    """Places, regions and researchers' stated focus, for the regions view."""
    gazetteer, coordinates = extras.get("gazetteer"), (extras.get("places") or {}).get("places", {})
    if not gazetteer:
        return None
    pages = (extras.get("people") or {}).get("people", [])
    author_of = {entry["url"]: name for name, entry in people.items()}
    focus = []
    for person in pages:
        current = any(category != "former-fellows-and-staff" for category in person.get("categories", []))
        if not current or not person.get("regional_focus"):
            continue
        found = list(dict.fromkeys(m.place for m in gazetteer.find(person["regional_focus"], "focus")))
        focus.append({"name": author_of.get(person["url"], person["name"]), "url": person["url"],
                      "text": person["regional_focus"], "places": found})
    used = {place for record in dataset for place in record.get("places", [])} | \
           {place for person in focus for place in person["places"]}
    slots = {macro["id"]: index + 1 for index, macro in enumerate(m for m in gazetteer.macros.values()
                                                                  if m["id"] != "transregional")}

    mentions = extras.get("mentions") or {}
    details, own_regions = mentions.get("places", {}), mentions.get("regions", {})

    def place_entry(pid: str) -> dict:
        from place_mentions import macro_of

        if pid in gazetteer.places:
            place = gazetteer.places[pid]
            entry = {"id": pid, "label": {"en": place["en"], "de": place["de"]}, "macro": place["macro"], "kind": place["kind"]}
            coord = coordinates.get(pid, {}).get("coord")
            if coord and place.get("mapped", True):
                entry["coord"] = coord
            return entry
        detail = details[pid]
        label = detail.get("label", {})
        en = label.get("en") or label.get("de") or label.get("fr") or pid
        entry = {"id": pid, "label": {"en": en, "de": label.get("de") or en},
                 "macro": macro_of(pid, detail, gazetteer, own_regions) or "transregional", "kind": detail.get("kind", "other")}
        # A world region has no single location, whatever Wikidata's centroid.
        if detail.get("coord") and entry["kind"] not in ("world", "continent"):
            entry["coord"] = detail["coord"]
        return entry

    reviewed = gazetteer.reviewed or {}
    stats = extras.get("stats") or {}
    attribution = {"gazetteer": len(gazetteer.places), "coordinates": "https://www.wikidata.org",
                   "reviewed": {k: reviewed[k] for k in ("by", "date", "scope", "scope_de") if k in reviewed}}
    if mentions:
        checked = mentions.get("reviewed", {})
        attribution["mentions"] = {
            "model": mentions["model"]["name"],
            "places": sum(1 for place in stats.get("placesAdded", ()) if place not in gazetteer.places),
            "records": stats.get("recordsWithAdded", 0),
            "reviewed": {k: checked[k] for k in ("by", "date", "scope", "scope_de") if k in checked},
        }
    return {
        "datasetId": dataset_id,
        "attribution": attribution,
        "macros": [{"id": macro["id"], "label": {"en": macro["en"], "de": macro["de"]},
                    **({"slot": slots[macro["id"]]} if macro["id"] in slots else {})}
                   for macro in gazetteer.macros.values()],
        "places": [place_entry(pid) for pid in sorted(used)],
        "focus": focus,
    }


def subjects_file(dataset: list[dict], extras: dict, dataset_id: str) -> dict | None:
    """GND headings of the register's books, labelled as the catalogues give them."""
    source = extras.get("subjects")
    if not source:
        return None
    labels: dict[str, dict] = {}
    for book in source.get("books", {}).values():
        for subject in book.get("subjects", []):
            labels.setdefault(subject["id"], {"label": subject["label"], "type": subject.get("type", "SubjectHeading")})
    used = sorted({gid for record in dataset for gid in record.get("gnd", [])})
    in_scope = {"Monographs", "Edited volumes"}
    return {
        "datasetId": dataset_id,
        "sources": source.get("sources", {}),
        "coverage": {
            "books": sum(1 for record in dataset if record.get("type") in in_scope),
            "withHeadings": sum(1 for record in dataset if record.get("gnd")),
        },
        "headings": {gid: labels[gid] for gid in used},
    }


def coverage(dataset: list[dict], people: dict, extras: dict) -> dict:
    """The counts the dashboard states next to every enriched view."""
    languages = Counter(record.get("lang", "und") for record in dataset)
    access = Counter("open" if r.get("oa") in OPEN_STATUSES else "closed" if r.get("oa") == "closed"
                     else "unknown" for r in dataset)
    return {
        "languages": dict(sorted(languages.items(), key=lambda kv: (-kv[1], kv[0]))),
        "zmoAuthors": len(people),
        "withZmoAuthor": sum(1 for r in dataset if any(a in people for a in r.get("authors", []))),
        "openalex": sum(1 for r in dataset if r.get("openalex")),
        "access": dict(sorted(access.items())),
        "themed": sum(1 for r in dataset if r.get("theme")),
        "withPlace": sum(1 for r in dataset if r.get("places")),
        "languageDecided": (extras.get("stats") or {}).get("languageDecided", 0),
        "withHeadings": sum(1 for r in dataset if r.get("gnd")),
    }
