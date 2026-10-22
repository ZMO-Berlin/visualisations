"""What a publication's title says about itself, without the formulas around it.

Shared by ``build_themes.py`` (the text a record is embedded from) and
``regions.py`` (the text places are looked for in). Kept free of numpy so the
dashboard generator, and CI, can import it.

Two kinds of noise are removed. Formulaic openings — "Rev.:", "Introduction:",
"Tagungsbericht:" — say what kind of text this is, not what it is about. And a
book review's title carries the reviewed book's imprint: "London: Hurst, 2020,
307 pp." made reviews a theme of their own and would make London a place ZMO
studies.
"""

from __future__ import annotations

import re
import unicodedata

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
