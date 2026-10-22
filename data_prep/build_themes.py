#!/usr/bin/env python3
"""Embed, cluster and map the publication register for the thematic map.

Reads ``raw_data/publications.json`` and writes ``raw_data/themes.json``: for
every publication, a theme and a position on a two-dimensional map; for every
theme, its broad area, its size and its most distinctive terms. With
``--refit`` it also writes ``reports/theme-brief.md``, the evidence the theme
labels in ``theme_labels.json`` are written from.

How the pieces fit:

* **Embeddings.** Each record's title and subtitle are embedded with
  EmbeddingGemma 2 (``gemma_encoder.py``: pinned ONNX export, fp32, the
  model's clustering prefix). Abstracts are deliberately *not* used: only a
  quarter of the register has one, and in a trial run with them the clusters
  split by whether a record had an abstract (0–99% per cluster) rather than by
  subject. Formulaic prefixes ("Rev.:", "Introduction:") and a review's imprint
  are removed, and a title too generic to say anything ("Introduction") is
  given the title of the volume it appeared in as context.
* **Language centring.** The multilingual model still places German titles
  near German titles. Each language's mean vector is subtracted (languages
  with enough records, detected on the embedded text with ``languages.py``),
  so that what remains is closer to subject than to language. Without it the trial produced a "German-language
  Islam" cluster and a "French-language history" cluster.
* **Themes.** k-means on the centred, re-normalised vectors, with a fixed seed.
* **Areas.** Themes grouped by agglomerative clustering of their centroids
  (Ward linkage on unit vectors) into at most eight — the size of the site's
  categorical palette, so each area can have its own colour on the map.
* **Map.** UMAP to two dimensions (cosine metric, fixed seed).

Stability. A full fit (``--refit``) is a deliberate, local act, followed by
relabelling: the labels file records a signature of the membership it was
written for, and the dashboard generator refuses labels whose signature no
longer matches. Without ``--refit`` the existing fit is kept and records it does
not yet contain are assigned to the theme with the nearest centroid and placed
at the similarity-weighted mean position of their nearest fitted neighbours —
which is what the scheduled workflow runs after each monthly refresh.

Embeddings are cached in ``data_prep/.cache/`` (not committed), keyed by the
exact input text and model revision, so a rerun embeds only what changed.

Usage:
    python data_prep/build_themes.py              # assign records missing from themes.json
    python data_prep/build_themes.py --refit      # full re-cluster and re-projection
    python data_prep/build_themes.py --brief      # rewrite the labelling brief only

Dependencies are in ``requirements-themes.txt``, not ``requirements.txt``: the
dashboard generator reads the committed ``themes.json`` and never needs them.
On Windows on ARM, numba (used by UMAP) crashes inside LLVM; use an x64 Python.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = SCRIPT_DIR / "raw_data" / "publications.json"
DEFAULT_OUTPUT = SCRIPT_DIR / "raw_data" / "themes.json"
DEFAULT_BRIEF = SCRIPT_DIR / "reports" / "theme-brief.md"
DEFAULT_CACHE = SCRIPT_DIR / ".cache" / "theme-embeddings.npz"

SEED = 42
THEMES = 24
AREAS = 8
UMAP_NEIGHBOURS = 15
UMAP_MIN_DIST = 0.1
# Neighbours whose positions place a record added after the fit.
PLACEMENT_NEIGHBOURS = 5
# A language needs this many records for its mean to be subtracted; below it
# the mean is mostly the few titles themselves.
CENTRING_MIN = 20
# Titles with fewer content words than this get their container as context.
SHORT_TITLE = 4
TERMS_PER_THEME = 10
# A distinctive term must occur in this many of a theme's records, so that one
# volume's chapters repeating its title cannot fill the list.
MIN_TERM_RECORDS = 3
BRIEF_TITLES = 18
BRIEF_SAMPLE = 8

# Formulaic openings that say what kind of text this is, not what it is about.
PREFIX = re.compile(
    r"^\s*(rev|rez|review|rezension|tagungsbericht|forschungsbericht|literaturbericht|"
    r"conference report|special issue|sonderheft|editorial|editors?['’]? preface|"
    r"introduction|einleitung|einführung|preface|vorwort|foreword|afterword|nachwort|"
    r"epilogue|prologue|conclusion|schluss|commentary|kommentar)\s*[:.–—-]\s*",
    re.IGNORECASE,
)
# Where a reviewed book's imprint begins. Places are listed rather than matched
# as "Word: Word", because titles have colons too: "Locale, Everyday Islam and
# Modernity: Qasbah Towns" must not be cut at "Modernity".
PUBLISHING_PLACES = (
    "London|New York|Oxford|Cambridge|Princeton|Stanford|Leiden|Boston|Berlin|Paris|Chicago|"
    "Edinburgh|Bloomington|Durham|Wiesbaden|Göttingen|Würzburg|Istanbul|Beirut|Cairo|Austin|"
    "Berkeley|Los Angeles|Ithaca|Manchester|Toronto|New Delhi|Delhi|Seattle|Syracuse|Minneapolis|"
    "Philadelphia|Bielefeld|Frankfurt|München|Munich|Hamburg|Leipzig|Abingdon|Basingstoke|"
    "Farnham|Amsterdam|Tübingen|Baden-Baden|Bern|Wien|Vienna|Moscow|Montreal|Albany|Lanham|"
    "Bristol|Lahore|Karachi|Dhaka|Tehran|Ankara|Tunis|Rabat|Casablanca|Dakar|Nairobi|"
    "Johannesburg|Cape Town|Madison|New Haven|Ann Arbor|Columbus|Notre Dame|Pittsburgh|"
    "Baltimore|Washington|Lincoln|Rome|Roma|Milano|Madrid|Barcelona|Lisboa|Konstanz|Zürich|"
    "Freiburg|Heidelberg|Köln|Cologne|Bonn|Münster|Bochum|Halle|Marburg|Erlangen|Bamberg|"
    "Hildesheim|Stuttgart|Bayreuth|Mainz|Aix-en-Provence|Marseille|Lyon|Louvain|Brussels"
)
IMPRINT = [
    re.compile(rf"[,.;(]\s*(?:{PUBLISHING_PLACES})\b(?:,\s*[A-Z][\w.]*)?\s*[:,]"),  # ", London: Hurst"
    re.compile(r"[,;(]\s*(?:\d+\s*(?:pp|S|pages)\b|\d{4}\b)"),                   # ", 2005", ", 307 pp"
    re.compile(r"[,;:]\s*(?:by|ed\.|eds\.|hrsg\.)\s", re.IGNORECASE),            # "; by …", ": by …"
    re.compile(r"\s[Bb]y\s[A-Z][\w'’.-]+\s[A-Z]"),                                # " by Nomi Stone"
    re.compile(r"[,;]\s*[^,;]*\b(?:University Press|Press|Verlag|Publishers|Publishing)\b"),
]
# "Dennerlein, Bettina: Religion als Reform" — the reviewed author, inverted.
# Given names are one to three capitalised words, so "Locale, Everyday Islam and
# Modernity:" — a title — is left alone.
LEADING_AUTHOR = re.compile(r"^[A-ZÀ-Ž][\w'’.-]+,\s+[A-ZÀ-Ž][\w'’.-]*(?:\s[A-ZÀ-Ž][\w'’.-]*){0,2}:\s+(?=[A-ZÀ-Ž\"“‘'])")
GENERIC = {
    "introduction", "einleitung", "einführung", "editorial", "preface", "vorwort",
    "foreword", "afterword", "nachwort", "epilogue", "prologue", "conclusion",
    "commentary", "response", "reply", "beiträge", "editor's preface",
    "editors' preface", "editorial preface", "introduction to the special issue",
}

# Function words, from languages.py, plus words that describe the genre of a
# title rather than its subject. Used only for the distinctive-term lists.
GENRE_WORDS = set("""
introduction einleitung einführung editorial preface review rev rez special issue
vol volume part chapter essays essay studies study perspectives approaches
reflections research new history histories historical case report notes book
""".split())


def fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def clean_title(text: str) -> str:
    previous = None
    while previous != text:
        previous = text
        text = PREFIX.sub("", text)
    return text.strip(" :.-–—")


def strip_imprint(text: str) -> str:
    """A reviewed book's title without its place, publisher, year and pages.

    Left in, "London: Hurst, 2020, 307 pp." made reviews a theme of their own,
    held together by "Press", "University" and "Verlag".
    """
    text = LEADING_AUTHOR.sub("", text)
    cut = min((m.start() for m in (pattern.search(text) for pattern in IMPRINT) if m), default=len(text))
    return text[:cut].strip(" ,;:.([")


def own_title(record: dict) -> str:
    """Cleaned title and subtitle: what the record says about itself."""
    title = clean_title(record.get("title") or "")
    subtitle = (record.get("subtitle") or "").strip()
    head = f"{title}: {subtitle}" if title and subtitle else title or subtitle
    if record.get("document_type") == "Book reviews":
        head = strip_imprint(head)
    return head


def theme_text(record: dict, by_slug: dict[str, dict]) -> str:
    """The text a record is embedded from: its own title, with the title of
    the volume it appeared in when its own says too little.

    Only a containing volume is used as context. Journal and series names were
    tried and made genre into themes — encyclopaedia entries, a project's online
    resources — because many short titles share one container.
    """
    head = own_title(record)
    words = re.findall(r"[^\W\d_]{3,}", head)
    if fold(head) in GENERIC or len(words) < SHORT_TITLE:
        parent = record.get("published_in") or {}
        container = clean_title(by_slug.get(parent.get("slug"), {}).get("title") or parent.get("title") or "")
        if container and fold(container) != fold(head):
            head = f"{head} — {container}" if head else container
    return head or (record.get("slug") or "")


# --- Embedding cache ---------------------------------------------------------

def cache_key(text: str, settings: dict) -> str:
    return hashlib.sha1(json.dumps([settings["model_revision"], settings["onnx_export"],
                                    settings["prefix"], text]).encode("utf-8")).hexdigest()


def embed(texts: list[str], cache_path: Path, threads: int) -> np.ndarray:
    from gemma_encoder import GemmaEncoder, clustering_text, model_settings

    settings = model_settings()
    keys = [cache_key(text, settings) for text in texts]
    cached: dict[str, np.ndarray] = {}
    if cache_path.is_file():
        data = np.load(cache_path)
        cached = dict(zip(data["keys"].tolist(), data["vectors"]))

    missing = sorted({k for k in keys if k not in cached})
    if missing:
        print(f"embedding {len(missing)} of {len(texts)} text(s) with {settings['model']}")
        encoder = GemmaEncoder(threads=threads)
        todo = {k: t for k, t in zip(keys, texts) if k in set(missing)}
        order = list(todo)
        vectors = encoder.encode_all([clustering_text(todo[k]) for k in order],
                                     progress=lambda d, n: print(f"  {d}/{n}", end="\r"))
        print()
        cached.update(zip(order, vectors))
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        live = sorted(set(keys))
        np.savez(cache_path, keys=np.array(live), vectors=np.stack([cached[k] for k in live]))
    return np.stack([cached[k] for k in keys]).astype(np.float64)


# --- Geometry ----------------------------------------------------------------

def normalise(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return matrix / np.where(norms == 0, 1, norms)


def language_means(vectors: np.ndarray, languages: list[str]) -> dict[str, np.ndarray]:
    counts = Counter(languages)
    overall = vectors.mean(axis=0)
    return {lang: vectors[[i for i, l in enumerate(languages) if l == lang]].mean(axis=0) - overall
            for lang, n in counts.items() if n >= CENTRING_MIN and lang != "und"}


def centre(vectors: np.ndarray, languages: list[str], means: dict[str, np.ndarray]) -> np.ndarray:
    shifted = vectors.copy()
    for i, lang in enumerate(languages):
        if lang in means:
            shifted[i] -= means[lang]
    return normalise(shifted)


def signature(slugs) -> str:
    return hashlib.sha256("\n".join(sorted(slugs)).encode("utf-8")).hexdigest()[:16]


def fit(vectors: np.ndarray, k: int, n_areas: int):
    from sklearn.cluster import AgglomerativeClustering, KMeans

    model = KMeans(n_clusters=k, n_init=20, random_state=SEED).fit(vectors)
    labels = model.labels_
    centroids = normalise(model.cluster_centers_)
    # Ward on unit vectors (where Euclidean distance orders pairs as cosine
    # does): average linkage left one area holding seven themes and two areas
    # holding one each.
    areas = AgglomerativeClustering(n_clusters=n_areas, linkage="ward").fit(centroids).labels_
    return labels, centroids, areas


def project(vectors: np.ndarray) -> np.ndarray:
    import umap

    reducer = umap.UMAP(n_components=2, n_neighbors=UMAP_NEIGHBOURS, min_dist=UMAP_MIN_DIST,
                        metric="cosine", random_state=SEED)
    coords = reducer.fit_transform(vectors)
    # Centred and scaled to [-1, 1] on the longer axis, so the file does not
    # carry UMAP's arbitrary offset and the dashboard needs no extent pass.
    coords = coords - (coords.max(axis=0) + coords.min(axis=0)) / 2
    return coords / np.abs(coords).max()


def place(new: np.ndarray, fitted: np.ndarray, coords: np.ndarray, centroids: np.ndarray):
    """Theme and position for records added after the fit."""
    themes = (new @ centroids.T).argmax(axis=1)
    sims = new @ fitted.T
    nearest = np.argsort(-sims, axis=1)[:, :PLACEMENT_NEIGHBOURS]
    weights = np.clip(np.take_along_axis(sims, nearest, axis=1), 1e-6, None)
    positions = (coords[nearest] * weights[..., None]).sum(axis=1) / weights.sum(axis=1, keepdims=True)
    return themes, positions


# --- Distinctive terms ---------------------------------------------------------

def stopwords() -> set[str]:
    from languages import FUNCTION_WORDS

    words = {w for line in FUNCTION_WORDS.values() for w in line.split()}
    return words | GENRE_WORDS


def tokens(text: str, stop: set[str]) -> list[str]:
    return [t for t in re.findall(r"[^\W\d_]{3,}", fold(text)) if t not in stop]


def distinctive_terms(texts: list[str], labels: list[str], top: int) -> dict[str, list[str]]:
    """c-TF-IDF: a term's frequency in a theme, weighted by how rare it is
    across themes. Ties are broken alphabetically so the list is stable."""
    stop = stopwords()
    per_theme: dict[str, Counter] = defaultdict(Counter)
    for text, label in zip(texts, labels):
        per_theme[label].update(set(tokens(text, stop)))
    overall = Counter()
    for counts in per_theme.values():
        overall.update(counts)
    average = sum(sum(c.values()) for c in per_theme.values()) / max(len(per_theme), 1)
    result = {}
    for label, counts in per_theme.items():
        total = sum(counts.values()) or 1
        scored = [(count / total * math.log(1 + average / overall[term]), term)
                  for term, count in counts.items() if count >= MIN_TERM_RECORDS]
        result[label] = [term for _, term in sorted(scored, key=lambda s: (-s[0], s[1]))[:top]]
    return result


# --- Output --------------------------------------------------------------------

def build_fit(records, texts, vectors, languages, k, n_areas):
    means = language_means(vectors, languages)
    centred = centre(vectors, languages, means)
    labels, centroids, area_of = fit(centred, k, n_areas)
    coords = project(centred)

    sizes = Counter(labels.tolist())
    area_sizes = Counter()
    for cluster, size in sizes.items():
        area_sizes[area_of[cluster]] += size
    # Areas by size, themes by size within their area: ids follow that order,
    # so t01 is the largest theme of the largest area.
    area_order = sorted(area_sizes, key=lambda a: (-area_sizes[a], a))
    cluster_order = sorted(sizes, key=lambda c: (area_order.index(area_of[c]), -sizes[c], c))
    theme_id = {c: f"t{n + 1:02d}" for n, c in enumerate(cluster_order)}
    area_id = {a: f"a{n + 1}" for n, a in enumerate(area_order)}

    slugs = [r["slug"] for r in records]
    members = defaultdict(list)
    for slug, cluster in zip(slugs, labels):
        members[theme_id[cluster]].append(slug)
    terms = distinctive_terms([own_title(r) for r in records], [theme_id[c] for c in labels], TERMS_PER_THEME)

    payload = {
        "method": method_block(k, n_areas, sorted(means)),
        "fit": {"records": len(slugs), "signature": signature(slugs)},
        "areas": [{"id": area_id[a], "themes": [theme_id[c] for c in cluster_order if area_of[c] == a]}
                  for a in area_order],
        "themes": [{"id": theme_id[c], "area": area_id[area_of[c]], "size": sizes[c],
                    "signature": signature(members[theme_id[c]]), "terms": terms[theme_id[c]]}
                   for c in cluster_order],
        "records": {slug: {"theme": theme_id[cluster], "x": round(float(x), 4), "y": round(float(y), 4),
                           "placed": "fit"}
                    for slug, cluster, (x, y) in sorted(zip(slugs, labels, coords))},
    }
    return payload, centred, centroids, theme_id, labels


def method_block(k, n_areas, centred_languages):
    from gemma_encoder import model_settings

    return {
        "embedding": {**model_settings(),
                      "input": "title and subtitle; formulaic prefixes and review imprints removed; "
                               "the containing volume's title added when the record's own is generic "
                               "or under four words"},
        "language_centring": centred_languages,
        "themes": {"algorithm": "k-means", "k": k, "n_init": 20, "seed": SEED},
        "areas": {"algorithm": "agglomerative over unit-length theme centroids", "linkage": "ward",
                  "n": n_areas},
        "map": {"algorithm": "UMAP", "metric": "cosine", "n_neighbors": UMAP_NEIGHBOURS,
                "min_dist": UMAP_MIN_DIST, "seed": SEED},
        "placement": f"records added after the fit: nearest theme centroid; position = "
                     f"similarity-weighted mean of the {PLACEMENT_NEIGHBOURS} nearest fitted records",
    }


def assign_new(records, vectors, languages, existing):
    """Keep the fit; give records it does not contain a theme and a place."""
    fitted_slugs = [s for s, r in existing["records"].items() if r["placed"] == "fit"]
    index = {r["slug"]: i for i, r in enumerate(records)}
    present = [s for s in fitted_slugs if s in index]
    fit_rows = [index[s] for s in present]
    fit_langs = [languages[i] for i in fit_rows]
    means = language_means(vectors[fit_rows], fit_langs)
    centred = centre(vectors, languages, means)

    theme_ids = [t["id"] for t in existing["themes"]]
    member_rows = defaultdict(list)
    for slug in present:
        member_rows[existing["records"][slug]["theme"]].append(index[slug])
    centroids = normalise(np.stack([centred[member_rows[t]].mean(axis=0) for t in theme_ids]))
    coords = np.array([[existing["records"][s]["x"], existing["records"][s]["y"]] for s in present])

    # Withdrawn records leave; new ones are placed. Previously placed records
    # are placed again, so a corrected title moves its point.
    current = {r["slug"] for r in records}
    kept = {s: r for s, r in existing["records"].items() if s in current and r["placed"] == "fit"}
    new = [r["slug"] for r in records if r["slug"] not in kept]
    if new:
        themes, positions = place(centred[[index[s] for s in new]], centred[fit_rows], coords, centroids)
        for slug, theme, (x, y) in zip(new, themes, positions):
            kept[slug] = {"theme": theme_ids[theme], "x": round(float(x), 4), "y": round(float(y), 4),
                          "placed": "nearest"}
    existing["records"] = dict(sorted(kept.items()))
    return existing, len(new)


def write_brief(path: Path, payload: dict, records: list[dict], texts: list[str], centred: np.ndarray):
    """The evidence each theme label is written from, one section per theme."""
    from output import atomic_text

    index = {r["slug"]: i for i, r in enumerate(records)}
    rng = np.random.default_rng(SEED)
    lines = [
        "# Theme brief",
        "",
        "Generated by `data_prep/build_themes.py --refit`. The theme and area labels in",
        "`data_prep/theme_labels.json` are written from this file by Claude Opus 5.5 (Anthropic).",
        "Each theme lists its size, when and in what form its publications appeared, its most",
        "distinctive terms, the titles nearest its centre and a seeded random sample of the rest.",
        "Author names are deliberately left out so that labels describe subjects, not people.",
        "",
        f"Fit signature: `{payload['fit']['signature']}` · {payload['fit']['records']} records · "
        f"{len(payload['themes'])} themes in {len(payload['areas'])} areas",
        "",
    ]
    by_theme = defaultdict(list)
    for slug, entry in payload["records"].items():
        if entry["placed"] == "fit":
            by_theme[entry["theme"]].append(slug)
    for area in payload["areas"]:
        lines += [f"## Area {area['id']}", ""]
        for theme in (t for t in payload["themes"] if t["area"] == area["id"]):
            slugs = by_theme[theme["id"]]
            rows = [index[s] for s in slugs]
            centroid = normalise(centred[rows].mean(axis=0, keepdims=True))[0]
            ranked = [rows[i] for i in np.argsort(-(centred[rows] @ centroid), kind="stable")]
            years = sorted(records[i]["year"] for i in rows if records[i].get("year"))
            types = Counter(records[i].get("document_type", "untyped") for i in rows).most_common(3)
            rest = ranked[BRIEF_TITLES:]
            sample = sorted(rng.choice(rest, size=min(BRIEF_SAMPLE, len(rest)), replace=False).tolist()) if rest else []
            lines += [
                f"### {theme['id']} · {theme['size']} publications · signature `{theme['signature']}`",
                "",
                f"- Years: {years[0]}–{years[-1]}, median {years[len(years) // 2]}" if years else "- Years: none recorded",
                "- Forms: " + ", ".join(f"{t} {n}" for t, n in types),
                "- Distinctive terms: " + ", ".join(theme["terms"]),
                "",
                "Nearest the centre:",
                "",
                *[f"1. {texts[i]}" for i in ranked[:BRIEF_TITLES]],
                "",
                "Sample of the rest:",
                "",
                *[f"- {texts[i]}" for i in sample],
                "",
            ]
    atomic_text(path, "\n".join(lines))


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--brief-path", type=Path, default=DEFAULT_BRIEF)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--refit", action="store_true", help="re-cluster and re-project everything")
    parser.add_argument("--brief", action="store_true", help="only rewrite the labelling brief")
    parser.add_argument("--themes", type=int, default=THEMES)
    parser.add_argument("--areas", type=int, default=AREAS)
    parser.add_argument("--threads", type=int, default=4,
                        help="onnxruntime threads; more is slower on hybrid-core laptops")
    args = parser.parse_args(argv)

    from languages import detect_language
    from output import atomic_json

    records = json.loads(args.input.read_text(encoding="utf-8"))["publications"]
    by_slug = {r["slug"]: r for r in records}
    texts = [theme_text(r, by_slug) for r in records]
    # The language of the text that is embedded, which for a review or a short
    # title with its container added is not the publication's language.
    languages = [detect_language({"title": text}) for text in texts]
    vectors = normalise(embed(texts, args.cache, args.threads))

    if args.refit or not args.output.is_file():
        payload, centred, _, _, _ = build_fit(records, texts, vectors, languages, args.themes, args.areas)
        atomic_json(args.output, payload, indent=1)
        write_brief(args.brief_path, payload, records, texts, centred)
        print(f"fitted {len(records)} records into {args.themes} themes and {args.areas} areas; "
              f"relabel from {args.brief_path}")
        return 0

    existing = json.loads(args.output.read_text(encoding="utf-8"))
    if args.brief:
        fitted = [s for s, r in existing["records"].items() if r["placed"] == "fit"]
        means = language_means(vectors[[i for i, r in enumerate(records) if r["slug"] in set(fitted)]],
                               [languages[i] for i, r in enumerate(records) if r["slug"] in set(fitted)])
        write_brief(args.brief_path, existing, records, texts, centre(vectors, languages, means))
        return 0

    payload, added = assign_new(records, vectors, languages, existing)
    atomic_json(args.output, payload, indent=1)
    print(f"kept the fit of {payload['fit']['records']} records; placed {added} record(s) beside it")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
