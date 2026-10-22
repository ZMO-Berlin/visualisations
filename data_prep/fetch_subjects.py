#!/usr/bin/env python3
"""Look up library subject headings (GND) for the register's books by ISBN.

Reads ``raw_data/publications.json`` (written by ``scrape_publications.py``)
and writes ``raw_data/subjects.json``: for every monograph and edited volume
with an ISBN, the catalogue records that carry that ISBN in the hbz union
catalogue (lobid-resources) and the German National Library (DNB), and the
GND subject headings and DDC notations those records give it.

Why library headings: they are assigned by subject librarians from a controlled
vocabulary, the Gemeinsame Normdatei, so "Islam", "Sufismus" or "Sansibar" mean
the same thing on every book that carries them, in whatever language the book
was written. They describe books best where OpenAlex is weakest. Chapters are
not looked up: they carry their volume's ISBN, and a volume's headings do not
describe one chapter of it.

ISBNs. The register's ``isbn`` field is typed by hand: hyphenated or not,
ISBN-10 or ISBN-13, sometimes two values ("9783111696492 / 9783111697215",
"Print-ISBN: …; PDF-ISBN: …"), sometimes a URL or a truncated number. Every
run of digits (hyphens and spaces allowed inside it) is a candidate; a
candidate counts only when its check digit is right. A valid ISBN-10 is
converted to ISBN-13, which is the form recorded and compared, and both forms
are sent in queries. A book whose field yields no valid ISBN is listed under
``invalid_isbn`` and not looked up.

Sources, both queried for every book, one request each:

  * **lobid-resources** (hbz, JSON), ``q=isbn:(<isbn13> OR <isbn10>)``. The
    ``isbn`` field holds both forms without hyphens; a free query (``q=978…``)
    also matches the ISBNs of *related* editions, so it is not used. lobid
    returns one record per library network that holds the book (hbz, hebis,
    …), each with its own subject indexing; GND headings are the components
    of ``subject[].componentList`` (RSWK chains) with a ``d-nb.info/gnd`` id.
    Free keywords, LCSH, FAST, BIC and RVK entries are not GND and are skipped.
  * **DNB SRU** (MARC21-xml, no key), ``query=num=<isbn13> or num=<isbn10>``.
    GND headings are the 689 chains and the 600/610/611/630/650/651 fields
    with ``$2 gnd``; DDC is field 082. The DNB collects what is published in
    Germany, so it covers the German books, which it indexes itself; lobid
    reaches the English and French books German libraries hold.

Both are queried rather than one as a fallback for the other because they
complement each other: for a German book lobid's records mostly repeat the
DNB's chains, sometimes flattened into alphabetical order, while the DNB
record keeps the national bibliography's own chain order; for a book from
Leiden, London or Paris the DNB has nothing and lobid is the only source.

Matching. A catalogue record is accepted only when its *own* ISBN list
(lobid ``isbn``; MARC 020 $a/$9, never 020 $z or 776) contains one of the
book's ISBNs: a search index can match an ISBN of a related edition, and the
DNB's ``num`` index also matches its own record numbers, so the ISBN-10
1409409759 finds DNB record 1409409759, an unrelated recording. A title guard
then catches ISBNs that are wrong in the register, which the catalogues
answer faithfully with another book: an ISBN is used only if at least one
record carrying it shares a distinctive title word with the register's title
and subtitle (see ``titles_agree``). Refused records are listed in the log,
not in the file. Headings from all accepted records are merged, deduplicated
by GND id, in order of first appearance: DNB records first (their chain order
is the national bibliography's), then lobid records, each catalogue's records
sorted by id so that the order does not depend on search ranking. Where lobid
has the heading, its label and class are kept: lobid gives the GND preferred
name and class, MARC only the parts of a name.

Headings the DNB marks as machine-generated are dropped: a subject field
whose ``$8`` link points to an 883 provenance field with first indicator 0
(fully) or 1 (partially machine-generated, e.g. concordance mappings from
another thesaurus). Librarian-assigned headings (883 indicator 2, or no 883)
are kept. The same rule applies to DDC numbers. In October 2026 machine
indexing would have given headings to only two more books, and its errors are
of the kind a reader notices: "Arabischer Frühling" on a book about Palestine
and National Socialism. lobid's records carry no provenance and are taken as
they come; for 2 of the 11 books with machine-generated DNB headings, a lobid
record has one of them too. Genre and form terms (655, lobid
``natureOfContent``: "Konferenzschrift", "Aufsatzsammlung") and time spans
("Geschichte 1920-1940", which have no GND id) are not subjects and are not
collected.

``type`` is one short GND class: SubjectHeading, PlaceOrGeographicName,
CorporateBody, Person, Work, ConferenceOrEvent or Family. lobid's GND
subclasses are folded into these (DifferentiatedPerson → Person, Territorial-
CorporateBodyOrAdministrativeUnit → PlaceOrGeographicName, …; see
``GND_CLASSES``); MARC gives the class by 689 $D code or by tag. A class
outside the mapping is read as SubjectHeading, which is what GND's remaining
classes (ethnographic names, languages, historic events) are subclasses of.
Labels are the catalogue's, in German. Finally each GND id is given one label
and class across all books (the most frequent; ties by sort order), so the
same heading never appears under two spellings.

The output file is also the cache, as ``openalex.json`` is for
``enrich_openalex.py``. Each book carries ``fp``, a hash of its valid ISBNs.
While it is unchanged, a book keeps its entry, and a book looked up without
success (listed under ``searched``) is not looked up again. ``--refresh-all``
ignores the cache: catalogue records gain headings over time, so it is worth
running now and then, and after any change to the parsing rules.

The output is built in memory and written atomically, sorted, without a
timestamp. A request that still fails after retries stops the run with a
non-zero exit and leaves the previous file untouched.

Usage:
    python data_prep/fetch_subjects.py                    # reuse the previous output
    python data_prep/fetch_subjects.py --refresh-all      # look every book up afresh
    python data_prep/fetch_subjects.py --dry-run          # report, write nothing
    python data_prep/fetch_subjects.py --limit 20         # a quick sample
    python data_prep/fetch_subjects.py --cache-dir /tmp/subjects   # development only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlencode

import requests

from output import atomic_json, identity
from zmo_site import USER_AGENT_SUFFIX, configure_console

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = SCRIPT_DIR / "raw_data" / "publications.json"
DEFAULT_OUTPUT = SCRIPT_DIR / "raw_data" / "subjects.json"

LOBID_SEARCH = "https://lobid.org/resources/search"
DNB_SRU = "https://services.dnb.de/sru/dnb"
SOURCES = {"lobid": "https://lobid.org/resources", "dnb": DNB_SRU}
# Merge order: the DNB's chain order first (see the module docstring).
CATALOGUES = ("dnb", "lobid")
USER_AGENT = f"ZMO-Subject-Headings/1.0 {USER_AGENT_SUFFIX}"

IN_SCOPE_TYPES = ("Monographs", "Edited volumes")

# Results per request. One ISBN rarely finds more than ten records; more pages
# are fetched if it does, up to MAX_RESULTS, beyond which the query is
# assumed to be broken rather than paged through.
PAGE_SIZE = 50
MAX_RESULTS = 200

RETRY_STATUS = {429, 500, 502, 503, 504}
FINGERPRINT_LENGTH = 10

# With at least this many books looked up, a catalogue that accepted no record
# at all means its query or its parsing has broken, not that it lacks the books.
SANITY_MIN_LOOKUPS = 20

GND_PREFIXES = ("https://d-nb.info/gnd/", "http://d-nb.info/gnd/")
MARC_NS = "http://www.loc.gov/MARC21/slim"
SRW_NS = "http://www.loc.gov/zing/srw/"

# lobid's GND classes folded into the seven short ones. Anything not listed
# is read as SubjectHeading (see ``gnd_class``).
GND_CLASSES = {
    "Person": "Person",
    "DifferentiatedPerson": "Person",
    "UndifferentiatedPerson": "Person",
    "RoyalOrMemberOfARoyalHouse": "Person",
    "Pseudonym": "Person",
    "CollectivePseudonym": "Person",
    "LiteraryOrLegendaryCharacter": "Person",
    "Gods": "Person",
    "Spirits": "Person",
    "Family": "Family",
    "CorporateBody": "CorporateBody",
    "OrganOfCorporateBody": "CorporateBody",
    "ProjectOrProgram": "CorporateBody",
    "Company": "CorporateBody",
    "FictiveCorporateBody": "CorporateBody",
    "MusicalCorporateBody": "CorporateBody",
    "ReligiousAdministrativeUnit": "CorporateBody",
    "ReligiousCorporateBody": "CorporateBody",
    "ConferenceOrEvent": "ConferenceOrEvent",
    "SeriesOfConferenceOrEvent": "ConferenceOrEvent",
    "Work": "Work",
    "Collection": "Work",
    "CollectiveManuscript": "Work",
    "Expression": "Work",
    "Manuscript": "Work",
    "MusicalWork": "Work",
    "ProvenanceCharacteristic": "Work",
    "VersionOfAMusicalWork": "Work",
    "PlaceOrGeographicName": "PlaceOrGeographicName",
    "TerritorialCorporateBodyOrAdministrativeUnit": "PlaceOrGeographicName",
    "AdministrativeUnit": "PlaceOrGeographicName",
    "Country": "PlaceOrGeographicName",
    "MemberState": "PlaceOrGeographicName",
    "NaturalGeographicUnit": "PlaceOrGeographicName",
    "BuildingOrMemorial": "PlaceOrGeographicName",
    "ExtraterrestrialTerritory": "PlaceOrGeographicName",
    "FictivePlace": "PlaceOrGeographicName",
    "NameOfSmallGeographicUnitLyingWithinAnotherGeographicUnit": "PlaceOrGeographicName",
    "ReligiousTerritory": "PlaceOrGeographicName",
    "WayBorderOrLine": "PlaceOrGeographicName",
    "SubjectHeading": "SubjectHeading",
    "SubjectHeadingSensoStricto": "SubjectHeading",
    "HistoricSingleEventOrEra": "SubjectHeading",
    "EthnographicName": "SubjectHeading",
    "GroupOfPersons": "SubjectHeading",
    "Language": "SubjectHeading",
    "CharactersOrMorphemes": "SubjectHeading",
    "FictiveTerm": "SubjectHeading",
    "MeansOfTransportWithIndividualName": "SubjectHeading",
    "NomenclatureInBiologyOrChemistry": "SubjectHeading",
    "ProductNameOrBrandName": "SubjectHeading",
    "SoftwareProduct": "SubjectHeading",
}
# When an entity carries several classes, the most specific wins: a
# Gebietskörperschaft ("Iran") is a place before it is a corporate body.
CLASS_PRIORITY = ("Person", "Family", "ConferenceOrEvent", "Work",
                  "PlaceOrGeographicName", "CorporateBody", "SubjectHeading")

# MARC 689 $D (or $A) codes, and the class each 6XX tag implies.
MARC_CODES = {
    "p": "Person",
    "b": "CorporateBody",
    "f": "ConferenceOrEvent",
    "u": "Work",
    "g": "PlaceOrGeographicName",
    "s": "SubjectHeading",
}
MARC_TAGS = {
    "600": "Person",
    "610": "CorporateBody",
    "611": "ConferenceOrEvent",
    "630": "Work",
    "650": "SubjectHeading",
    "651": "PlaceOrGeographicName",
}
# 883 first indicators marking machine-generated content: 0 fully, 1 partly.
MACHINE_INDICATORS = {"0", "1"}
# MARC title, part and series subfields read by the title guard.
TITLE_FIELDS = {
    "245": ("a", "b", "n", "p"),
    "246": ("a", "b"),
    "490": ("a",),
    "773": ("t",),
    "800": ("t",),
    "810": ("t",),
    "830": ("a", "p"),
}

# A run of digits, hyphens and spaces allowed inside it, an X allowed last.
ISBN_RUN = re.compile(r"\d[\d\s\-‐-–]*[\dXx]")
DASHES = re.compile(r"[\-‐-–]")
# Shorter digit runs in an ISBN field are years, page counts or URL debris,
# not mistyped ISBNs.
MIN_CANDIDATE = 9
DDC_PATTERN = re.compile(r"^\d{3}(?:\.\d+)?$")

# The title guard (see ``titles_agree``) compares words of this length or
# more, without these function words, which titles in any of the register's
# languages share without being about the same thing. Accents are folded
# before the comparison, so "über" is listed as "uber".
MIN_TITLE_WORD = 4
STOPWORDS = frozenset("""
    about after against among between beyond from into over their them these
    they this those through under upon what when where which with within
    without aber auch beim dass eine einem einen einer eines fur gegen
    nach uber unter zwischen avec dans entre leur leurs pour sans sous
    como para sobre
""".split())
# Latin letters that Unicode decomposition does not reduce to ASCII.
LATIN_FOLDS = str.maketrans({"ß": "ss", "ı": "i", "ø": "o", "ł": "l", "đ": "d",
                             "æ": "ae", "œ": "oe", "þ": "th"})
# Removed outright, so "Taʾaddüd" and "Ta'addüd" give the same word.
APOSTROPHES = set("'\u2019\u2018\u02bc\u02bb\u02be\u02bf`\u00b4\u02b9")


class SubjectsError(RuntimeError):
    """A catalogue request failed in a way that retrying will not fix.

    Raised rather than skipped: carrying on would write a file that silently
    covers fewer books than the last one.
    """


# ---------------------------------------------------------------------------
# ISBNs


def isbn10_check(first9: str) -> str:
    total = sum((10 - position) * int(digit) for position, digit in enumerate(first9))
    check = (11 - total % 11) % 11
    return "X" if check == 10 else str(check)


def isbn13_check(first12: str) -> str:
    total = sum(int(digit) * (3 if position % 2 else 1) for position, digit in enumerate(first12))
    return str((10 - total % 10) % 10)


def is_isbn10(value: str) -> bool:
    return (len(value) == 10 and value[:9].isdigit()
            and (value[9].isdigit() or value[9] == "X")
            and isbn10_check(value[:9]) == value[9])


def is_isbn13(value: str) -> bool:
    return (len(value) == 13 and value.isdigit() and value[:3] in ("978", "979")
            and isbn13_check(value[:12]) == value[12])


def compact_isbn(value: str) -> str:
    """Strip hyphens, spaces and an ``ISBN`` label; upper-case a final x."""
    return re.sub(r"[^0-9X]", "", (value or "").upper().replace("ISBN", ""))


def to_isbn13(value: str) -> str | None:
    """The ISBN-13 of a valid ISBN-10 or ISBN-13, or None for anything else."""
    value = compact_isbn(value)
    if is_isbn13(value):
        return value
    if is_isbn10(value):
        body = "978" + value[:9]
        return body + isbn13_check(body)
    return None


def to_isbn10(isbn13: str) -> str | None:
    """The ISBN-10 of a 978 ISBN-13; 979 numbers have none."""
    if not is_isbn13(isbn13) or not isbn13.startswith("978"):
        return None
    body = isbn13[3:12]
    return body + isbn10_check(body)


def split_isbn_field(value: str | None) -> list[str]:
    """Candidate ISBNs in a register ``isbn`` field, compacted, in order.

    Separators ("/", ";", labels such as "PDF-ISBN:") end a run. Two numbers
    separated only by a space form one run; when the whole run is not an ISBN
    its space-separated groups are accumulated until they make one.
    """
    candidates: list[str] = []
    for run in ISBN_RUN.findall(value or ""):
        groups = [DASHES.sub("", group).upper() for group in run.split()]
        whole = "".join(groups)
        if len(groups) == 1 or to_isbn13(whole):
            pieces = [whole]
        else:
            pieces, current = [], ""
            for group in groups:
                current += group
                if len(current) in (10, 13) and to_isbn13(current):
                    pieces.append(current)
                    current = ""
            if current:
                pieces.append(current)
        candidates.extend(piece for piece in pieces if len(piece) >= MIN_CANDIDATE)
    return candidates


def parse_isbns(value: str | None) -> tuple[list[str], list[str]]:
    """(valid ISBN-13s, invalid candidates) of a register ``isbn`` field."""
    valid: list[str] = []
    invalid: list[str] = []
    for candidate in split_isbn_field(value):
        isbn = to_isbn13(candidate)
        if isbn:
            if isbn not in valid:
                valid.append(isbn)
        elif candidate not in invalid:
            invalid.append(candidate)
    return valid, invalid


def query_forms(isbns: list[str] | tuple[str, ...]) -> list[str]:
    """Every ISBN-13 with its ISBN-10, for queries."""
    forms: list[str] = []
    for isbn in isbns:
        for form in (isbn, to_isbn10(isbn)):
            if form and form not in forms:
                forms.append(form)
    return forms


# ---------------------------------------------------------------------------
# HTTP


class CatalogueClient:
    """GET requests with retries, a delay between requests and a tally."""

    def __init__(self, delay: float = 0.3, timeout: float = 60.0, retries: int = 5,
                 cache_dir: Path | None = None) -> None:
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.cache_dir = cache_dir
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.requests: Counter[str] = Counter()
        self.cache_hits = 0
        self._last_request = 0.0
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def get(self, catalogue: str, base: str, params: dict) -> str:
        url = f"{base}?{urlencode(params)}"
        cached = self._cache_path(url)
        if cached and cached.exists():
            self.cache_hits += 1
            return cached.read_text(encoding="utf-8")
        text = self._request(catalogue, url)
        if cached:
            cached.write_text(text, encoding="utf-8")
        return text

    def _request(self, catalogue: str, url: str) -> str:
        last_error = ""
        for attempt in range(1, self.retries + 1):
            self._throttle()
            wait = 2 ** (attempt - 1)
            try:
                response = self.session.get(url, timeout=self.timeout)
            except requests.RequestException as error:
                last_error = str(error)
            else:
                self.requests[catalogue] += 1
                if response.status_code == 200:
                    response.encoding = "utf-8"
                    return response.text
                if response.status_code not in RETRY_STATUS:
                    raise SubjectsError(
                        f"HTTP {response.status_code} for {url}: {response.text[:300]}"
                    )
                last_error = f"HTTP {response.status_code}"
                try:
                    wait = max(wait, int(float(response.headers.get("Retry-After") or 0)))
                except ValueError:
                    pass
            if attempt < self.retries:
                print(f"  retry {attempt}/{self.retries - 1} in {wait}s: {last_error}",
                      file=sys.stderr)
                time.sleep(wait)
        raise SubjectsError(f"could not fetch {url}: {last_error}")

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_request = time.monotonic()

    def _cache_path(self, url: str) -> Path | None:
        if not self.cache_dir:
            return None
        return self.cache_dir / f"{hashlib.sha256(url.encode('utf-8')).hexdigest()[:32]}.txt"


# ---------------------------------------------------------------------------
# Catalogue records


@dataclass(frozen=True)
class Heading:
    id: str
    label: str
    type: str


@dataclass(frozen=True)
class CatalogueRecord:
    catalogue: str
    id: str
    isbns: frozenset[str]
    title: str = ""
    # Words of the title, subtitle, part and series fields, for the guard.
    words: frozenset[str] = frozenset()
    subjects: tuple[Heading, ...] = ()
    ddc: tuple[str, ...] = ()
    # Headings and DDC numbers dropped as machine-generated (DNB only).
    machine: int = 0


def clean_label(value) -> str:
    """NFC (the DNB sends decomposed accents), whitespace collapsed, and
    MARC's non-sorting markers (U+0098, U+009C around "The", "Das") removed."""
    if not isinstance(value, str):
        return ""
    value = value.replace("\x98", "").replace("\x9c", "")
    return " ".join(unicodedata.normalize("NFC", value).split())


def title_words(*texts: str) -> frozenset[str]:
    """Distinctive Latin-script words of a title: accents and apostrophes
    folded, function words and words under four letters dropped.

    Only Latin script is compared: a title in Arabic or Georgian script yields
    no words, so it cannot clash with the catalogue's transliteration.
    """
    words: set[str] = set()
    for text in texts:
        folded = unicodedata.normalize("NFKD", clean_label(text).lower().translate(LATIN_FOLDS))
        folded = "".join(char for char in folded
                         if not unicodedata.combining(char) and char not in APOSTROPHES)
        words.update(word for word in re.findall(r"[a-z]+", folded)
                     if len(word) >= MIN_TITLE_WORD and word not in STOPWORDS)
    return frozenset(words)


def gnd_id(value) -> str | None:
    """``https://d-nb.info/gnd/4027743-4`` or ``(DE-588)4027743-4`` → ``4027743-4``."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    for prefix in (*GND_PREFIXES, "(DE-588)"):
        if value.startswith(prefix):
            bare = value[len(prefix):].strip().rstrip("/")
            return bare if re.fullmatch(r"[0-9A-Za-z-]+", bare) else None
    return None


def gnd_class(types) -> str:
    """One short class for lobid's list of GND classes (see ``GND_CLASSES``)."""
    if isinstance(types, str):
        types = [types]
    mapped = {GND_CLASSES.get(name) for name in types or [] if isinstance(name, str)}
    for name in CLASS_PRIORITY:
        if name in mapped:
            return name
    return "SubjectHeading"


def clean_ddc(value) -> str | None:
    """A DDC number without segmentation marks, or None if it is not one."""
    if not isinstance(value, str):
        return None
    value = re.sub(r"['/\s]", "", value)
    return value if DDC_PATTERN.match(value) else None


def isbn13_set(values) -> frozenset[str]:
    found: set[str] = set()
    for value in values:
        if isinstance(value, str):
            for candidate in split_isbn_field(value):
                isbn = to_isbn13(candidate)
                if isbn:
                    found.add(isbn)
    return frozenset(found)


def unique(values) -> list:
    return list(dict.fromkeys(values))


# lobid ---------------------------------------------------------------------


def lobid_record_id(value) -> str:
    """``http://lobid.org/resources/99…#!`` → ``https://lobid.org/resources/99…``."""
    value = (value or "").split("#", 1)[0].rstrip("/")
    return re.sub(r"^http://", "https://", value)


def lobid_heading(entry) -> Heading | None:
    if not isinstance(entry, dict):
        return None
    identifier = gnd_id(entry.get("id"))
    label = clean_label(entry.get("label"))
    if not identifier or not label:
        return None
    return Heading(identifier, label, gnd_class(entry.get("type")))


def parse_lobid_record(member: dict) -> CatalogueRecord:
    headings: list[Heading] = []
    ddc: list[str] = []
    for entry in member.get("subject") or []:
        if not isinstance(entry, dict):
            continue
        components = entry.get("componentList")
        if isinstance(components, list):
            headings.extend(h for h in map(lobid_heading, components) if h)
            continue
        heading = lobid_heading(entry)
        if heading:
            headings.append(heading)
        source = entry.get("source") if isinstance(entry.get("source"), dict) else {}
        if (source.get("label") or "").startswith("Dewey"):
            notation = clean_ddc(entry.get("notation"))
            if notation:
                ddc.append(notation)
    title = member.get("title") if isinstance(member.get("title"), str) else ""
    texts = [title] + [
        value for key in ("otherTitleInformation", "alternativeTitle")
        for value in (member.get(key) or []) if isinstance(value, str)
    ] + [
        superordinate.get("label")
        for part in member.get("isPartOf") or [] if isinstance(part, dict)
        for superordinate in part.get("hasSuperordinate") or [] if isinstance(superordinate, dict)
    ]
    return CatalogueRecord(
        catalogue="lobid",
        id=lobid_record_id(member.get("id")),
        isbns=isbn13_set(member.get("isbn") or []),
        title=clean_label(title),
        words=title_words(*[text for text in texts if isinstance(text, str)]),
        subjects=tuple(headings),
        ddc=tuple(unique(ddc)),
    )


def parse_lobid_response(text: str) -> tuple[list[dict], int]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise SubjectsError(f"lobid did not return JSON: {error}") from None
    members = data.get("member") if isinstance(data, dict) else None
    total = data.get("totalItems") if isinstance(data, dict) else None
    if not isinstance(members, list) or not isinstance(total, int):
        raise SubjectsError("unexpected lobid response shape (no member list or totalItems)")
    return [member for member in members if isinstance(member, dict)], total


def lobid_query(forms: list[str]) -> str:
    if len(forms) == 1:
        return f"isbn:{forms[0]}"
    return "isbn:(" + " OR ".join(forms) + ")"


def fetch_lobid(client: CatalogueClient, forms: list[str]) -> list[CatalogueRecord]:
    members: list[dict] = []
    while True:
        params = {"q": lobid_query(forms), "format": "json", "size": PAGE_SIZE,
                  "from": len(members)}
        page, total = parse_lobid_response(client.get("lobid", LOBID_SEARCH, params))
        members.extend(page)
        if not page or len(members) >= total:
            break
        if len(members) >= MAX_RESULTS:
            raise SubjectsError(f"lobid returned {total} records for {forms}; query broken?")
    return [parse_lobid_record(member) for member in members]


# DNB -----------------------------------------------------------------------


def _subfields(datafield: ET.Element) -> list[tuple[str, str]]:
    return [(sub.get("code") or "", sub.text or "")
            for sub in datafield.findall(f"{{{MARC_NS}}}subfield")]


def _values(subfields: list[tuple[str, str]], code: str) -> list[str]:
    return [value.strip() for key, value in subfields if key == code and value.strip()]


def marc_label(subfields: list[tuple[str, str]], kind: str) -> str:
    """A GND-style name from a MARC heading's parts.

    Used only where lobid does not have the heading. Persons: "Friedrich II.,
    Preußen, König" ($a $b, $c); corporate bodies: "Deutschland. Auswärtiges
    Amt" ($a. $b); qualifiers and geographic subdivisions in parentheses, as
    lobid writes them: "Tripolis (Libyen)", "Indien (Südost)" ($g, $z); a
    work's title after its author ($t).
    """
    names = _values(subfields, "a")
    if not names:
        return ""
    label = names[0]
    if kind == "Person":
        label += "".join(f" {value}" for value in _values(subfields, "b"))
        label += "".join(f", {value}" for value in _values(subfields, "c"))
    else:
        label += "".join(f". {value}" for value in _values(subfields, "b"))
    qualifiers = _values(subfields, "g") + _values(subfields, "z")
    if qualifiers:
        label += f" ({', '.join(qualifiers)})"
    label += "".join(f": {value}" for value in _values(subfields, "t"))
    label += "".join(f". {value}" for value in _values(subfields, "p"))
    return clean_label(label)


def marc_gnd_id(subfields: list[tuple[str, str]]) -> str | None:
    for value in _values(subfields, "0"):
        if value.startswith("(DE-588)") or value.startswith(GND_PREFIXES):
            identifier = gnd_id(value)
            if identifier:
                return identifier
    return None


def parse_dnb_record(record: ET.Element) -> CatalogueRecord:
    """Accepted ISBNs, GND headings and DDC numbers of one MARC21-xml record."""
    control = record.find(f"{{{MARC_NS}}}controlfield[@tag='001']")
    record_id = (control.text or "").strip() if control is not None else ""
    fields = [(datafield.get("tag") or "", datafield.get("ind1") or " ", _subfields(datafield))
              for datafield in record.findall(f"{{{MARC_NS}}}datafield")]

    machine = {
        link.split("\\", 1)[0]
        for tag, ind1, subfields in fields if tag == "883" and ind1 in MACHINE_INDICATORS
        for link in _values(subfields, "8")
    }

    def is_machine(subfields: list[tuple[str, str]]) -> bool:
        return any(link.split("\\", 1)[0] in machine for link in _values(subfields, "8"))

    isbns = isbn13_set(
        value for tag, _, subfields in fields if tag == "020"
        for code in ("a", "9") for value in _values(subfields, code)
    )
    title = " : ".join(
        value.strip(" /:;")
        for tag, _, subfields in fields if tag == "245"
        for code in ("a", "b") for value in _values(subfields, code)
    )
    # A volume of a multi-part work is titled after the volume; the work's
    # title is in 490/773/8XX.
    title_texts = [
        value
        for tag, _, subfields in fields
        for code in TITLE_FIELDS.get(tag, ())
        for value in _values(subfields, code)
    ]

    headings: list[Heading] = []
    dropped = 0
    # Chains first: their order is the indexer's; the 6XX fields repeat the
    # same headings grouped by kind.
    for tag, ind1, subfields in [f for f in fields if f[0] == "689"] + \
            [f for f in fields if f[0] in MARC_TAGS]:
        if tag != "689" and "gnd" not in _values(subfields, "2"):
            continue
        if is_machine(subfields):
            dropped += 1
            continue
        if tag == "689":
            codes = _values(subfields, "D") or _values(subfields, "A")
            kind = MARC_CODES.get(codes[0].lower(), "SubjectHeading") if codes else "SubjectHeading"
        else:
            kind = "Family" if tag == "600" and ind1 == "3" else MARC_TAGS[tag]
        identifier = marc_gnd_id(subfields)
        label = marc_label(subfields, kind)
        if identifier and label:
            headings.append(Heading(identifier, label, kind))

    ddc: list[str] = []
    for tag, _, subfields in fields:
        if tag == "082":
            if is_machine(subfields):
                dropped += 1
            else:
                ddc.extend(n for n in map(clean_ddc, _values(subfields, "a")) if n)
    return CatalogueRecord(
        catalogue="dnb",
        id=f"https://d-nb.info/{record_id}" if record_id else "",
        isbns=isbns,
        title=clean_label(title),
        words=title_words(*title_texts),
        subjects=tuple(headings),
        ddc=tuple(unique(ddc)),
        machine=dropped,
    )


def parse_dnb_response(text: str) -> tuple[list[ET.Element], int]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise SubjectsError(f"the DNB did not return XML: {error}") from None
    diagnostic = root.find(f".//{{{SRW_NS}}}diagnostics")
    if diagnostic is not None and len(diagnostic):
        message = " ".join(text.strip() for text in diagnostic.itertext() if text.strip())
        raise SubjectsError(f"DNB SRU diagnostic: {message[:300]}")
    count = root.findtext(f"{{{SRW_NS}}}numberOfRecords")
    if count is None or not count.strip().isdigit():
        raise SubjectsError("unexpected DNB response shape (no numberOfRecords)")
    records = list(root.iter(f"{{{MARC_NS}}}record"))
    return records, int(count)


def dnb_query(forms: list[str]) -> str:
    return " or ".join(f"num={form}" for form in forms)


def fetch_dnb(client: CatalogueClient, forms: list[str]) -> list[CatalogueRecord]:
    records: list[ET.Element] = []
    while True:
        params = {"version": "1.1", "operation": "searchRetrieve", "query": dnb_query(forms),
                  "recordSchema": "MARC21-xml", "maximumRecords": PAGE_SIZE,
                  "startRecord": len(records) + 1}
        page, total = parse_dnb_response(client.get("dnb", DNB_SRU, params))
        records.extend(page)
        if not page or len(records) >= total:
            break
        if len(records) >= MAX_RESULTS:
            raise SubjectsError(f"the DNB returned {total} records for {forms}; query broken?")
    return [parse_dnb_record(record) for record in records]


# ---------------------------------------------------------------------------
# Books


@dataclass(frozen=True)
class Book:
    """A monograph or edited volume with an ISBN field, reduced to what lookup needs."""

    slug: str
    title: str = ""
    isbns: tuple[str, ...] = ()
    invalid: tuple[str, ...] = ()
    fp: str = ""
    # Words of the title and subtitle, for the guard.
    words: frozenset[str] = frozenset()


def fingerprint(isbns: list[str] | tuple[str, ...]) -> str:
    """A short hash of the ISBNs a lookup uses; a change sends the book back."""
    return identity({"isbn": list(isbns)})[:FINGERPRINT_LENGTH]


def in_scope(raw: dict) -> bool:
    return raw.get("document_type") in IN_SCOPE_TYPES and bool((raw.get("isbn") or "").strip())


def prepare_book(raw: dict) -> Book:
    valid, invalid = parse_isbns(raw.get("isbn"))
    return Book(
        slug=raw["slug"],
        title=" ".join(str(raw.get("title") or "").split()),
        isbns=tuple(valid),
        invalid=tuple(invalid),
        fp=fingerprint(valid),
        words=title_words(str(raw.get("title") or ""), str(raw.get("subtitle") or "")),
    )


def titles_agree(book: Book, record: CatalogueRecord) -> bool:
    """False only when the titles share no distinctive word at all.

    A guard against a wrong ISBN in the register, which the catalogues answer
    faithfully with another book: "Zukunftsperspektiven der
    Entwicklungszusammenarbeit" carries the ISBN of a volume of "Talḫīs
    al-adilla". It is lenient on purpose: a title in another script or a
    translated title passes as long as one word is shared or one side has
    no comparable words.
    """
    return not book.words or not record.words or bool(book.words & record.words)


@dataclass
class Verdict:
    accepted: list[CatalogueRecord]
    # Records a search returned that do not carry the book's ISBN (search
    # indexes also match related editions and, at the DNB, record numbers).
    other_isbn: int = 0
    # Records that carry the ISBN but describe a different book.
    other_title: list[CatalogueRecord] = field(default_factory=list)


def accept(book: Book, records: list[CatalogueRecord]) -> Verdict:
    """Records whose own ISBNs include one of the book's, for ISBNs the titles confirm.

    The guard judges the ISBN rather than each record: an ISBN is confirmed
    when any record carrying it agrees with the register's title, and then
    every record carrying it is accepted. The DNB catalogues a volume of
    "Handbuch des Antisemitismus" under the volume's own title alone, while
    lobid's record of the same ISBN names the Handbuch.
    """
    wanted = set(book.isbns)
    carrying = [record for record in records if record.id and record.isbns & wanted]
    confirmed = {isbn for record in carrying if titles_agree(book, record)
                 for isbn in record.isbns & wanted}
    verdict = Verdict([], other_isbn=len(records) - len(carrying))
    for record in carrying:
        (verdict.accepted if record.isbns & confirmed else verdict.other_title).append(record)
    return verdict


def record_order(record: CatalogueRecord) -> tuple[int, str]:
    return CATALOGUES.index(record.catalogue), record.id


def merge(book: Book, records: list[CatalogueRecord]) -> dict:
    """One subjects.json entry from a book's accepted records."""
    records = sorted({(r.catalogue, r.id): r for r in records}.values(), key=record_order)
    chosen: dict[str, tuple[Heading, str]] = {}
    for record in records:
        for heading in record.subjects:
            previous = chosen.get(heading.id)
            # The first appearance fixes the position; lobid's preferred name
            # and class replace a MARC-built label.
            if previous is None:
                chosen[heading.id] = (heading, record.catalogue)
            elif record.catalogue == "lobid" and previous[1] != "lobid":
                chosen[heading.id] = (heading, "lobid")
    return compact({
        "isbn": list(book.isbns),
        "fp": book.fp,
        "records": [{"catalogue": r.catalogue, "id": r.id} for r in records],
        "subjects": [
            {"id": heading.id, "label": heading.label, "type": heading.type}
            for heading, _ in chosen.values()
        ],
        "ddc": unique(notation for record in records for notation in record.ddc),
    })


def compact(mapping: dict) -> dict:
    """Drop empty values: a missing key means "the catalogues have nothing here"."""
    return {key: value for key, value in mapping.items() if value not in (None, "", [], {})}


def harmonise(entries: dict[str, dict]) -> int:
    """Give every GND id one label and class across books; returns how many changed.

    A heading lobid has for one book may come only from MARC for another, and
    a renamed heading keeps its old label in old records. The most frequent
    (label, class) wins, ties going to the first in sort order.
    """
    votes: dict[str, Counter[tuple[str, str]]] = {}
    for entry in entries.values():
        for subject in entry.get("subjects", []):
            votes.setdefault(subject["id"], Counter())[(subject["label"], subject["type"])] += 1
    best = {
        identifier: min(counter.items(), key=lambda item: (-item[1], item[0]))[0]
        for identifier, counter in votes.items()
    }
    changed = 0
    for entry in entries.values():
        for subject in entry.get("subjects", []):
            label, kind = best[subject["id"]]
            if (subject["label"], subject["type"]) != (label, kind):
                subject["label"], subject["type"] = label, kind
                changed += 1
    return changed


# ---------------------------------------------------------------------------
# The run


@dataclass
class Cache:
    """What the previous subjects.json says about each book."""

    # slug → entry, for books with at least one accepted record
    books: dict[str, dict] = field(default_factory=dict)
    # slug → fingerprint, for books looked up without an accepted record
    searched: dict[str, str] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.books) + len(self.searched)


def _valid_entry(entry) -> bool:
    if not isinstance(entry, dict) or not isinstance(entry.get("fp"), str):
        return False
    if not all(isinstance(entry.get(key, []), list) for key in ("isbn", "subjects", "ddc")):
        return False
    records = entry.get("records")
    if not isinstance(records, list) or not records or not all(
            isinstance(r, dict) and r.get("catalogue") in CATALOGUES and isinstance(r.get("id"), str)
            for r in records):
        return False
    if not all(isinstance(s, dict) and all(isinstance(s.get(k), str) for k in ("id", "label", "type"))
               for s in entry.get("subjects", [])):
        return False
    return all(isinstance(value, str) for value in entry.get("ddc", []) + entry.get("isbn", []))


def load_cache(path: Path, refresh_all: bool = False) -> Cache:
    """Read the previous output as a cache; an absent or unreadable one is empty.

    Entries without the expected shape are skipped rather than trusted: the
    book they describe is simply looked up again.
    """
    if refresh_all or not path.is_file():
        return Cache()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"note: {path.name} is unreadable ({error}); looking every book up afresh")
        return Cache()
    books = {
        slug: json.loads(json.dumps(entry))
        for slug, entry in (payload.get("books") or {}).items() if _valid_entry(entry)
    }
    searched = {slug: fp for slug, fp in (payload.get("searched") or {}).items()
                if isinstance(fp, str)}
    return Cache(books, searched)


@dataclass
class RunStats:
    looked_up: int = 0
    reused: int = 0
    skipped: int = 0
    refused: int = 0
    # (slug, record id, catalogue title) of records refused by the title guard
    mismatched: list = field(default_factory=list)
    accepted: Counter = field(default_factory=Counter)
    machine: int = 0


def enrich(books: list[Book], client: CatalogueClient, cache: Cache | None = None,
           log=print) -> tuple[dict, RunStats]:
    """Look up ``books`` (all in scope) and build subjects.json."""
    cache = cache or Cache()
    stats = RunStats()
    entries: dict[str, dict] = {}
    searched: dict[str, str] = {}
    invalid = sorted(book.slug for book in books if not book.isbns)
    valid = [book for book in books if book.isbns]

    for position, book in enumerate(valid, 1):
        previous = cache.books.get(book.slug)
        if previous and previous.get("fp") == book.fp:
            entries[book.slug] = previous
            stats.reused += 1
            continue
        if cache.searched.get(book.slug) == book.fp:
            searched[book.slug] = book.fp
            stats.skipped += 1
            continue

        forms = query_forms(book.isbns)
        found = fetch_dnb(client, forms) + fetch_lobid(client, forms)
        verdict = accept(book, found)
        accepted = verdict.accepted
        refused = verdict.other_isbn + len(verdict.other_title)
        stats.looked_up += 1
        stats.refused += verdict.other_isbn
        stats.mismatched.extend((book.slug, record.id, record.title) for record in verdict.other_title)
        stats.machine += sum(record.machine for record in accepted)
        for catalogue in {record.catalogue for record in accepted}:
            stats.accepted[catalogue] += 1
        if accepted:
            entries[book.slug] = merge(book, accepted)
        else:
            searched[book.slug] = book.fp
        counts = Counter(record.catalogue for record in accepted)
        log(f"[{position}/{len(valid)}] {book.title[:60]}: "
            f"dnb {counts['dnb']}, lobid {counts['lobid']}"
            + (f" (+{refused} refused)" if refused else "")
            + f"; {len(entries.get(book.slug, {}).get('subjects', []))} heading(s)")

    if stats.looked_up >= SANITY_MIN_LOOKUPS:
        for catalogue in CATALOGUES:
            if not stats.accepted[catalogue]:
                raise SubjectsError(
                    f"{stats.looked_up} books looked up and no {catalogue} record accepted; "
                    "the query or the parsing has probably broken"
                )

    harmonise(entries)
    return build_payload(books, entries, searched, invalid), stats


def build_payload(books: list[Book], entries: dict[str, dict], searched: dict[str, str],
                  invalid: list[str]) -> dict:
    """Assemble subjects.json; every collection is sorted here."""
    with_valid = [book for book in books if book.isbns]
    matched_by = {
        catalogue: sum(1 for entry in entries.values()
                       if any(r["catalogue"] == catalogue for r in entry["records"]))
        for catalogue in sorted(CATALOGUES, key=lambda name: list(SOURCES).index(name))
    }
    return {
        "sources": dict(SOURCES),
        "coverage": {
            "books": len(books),
            "with_valid_isbn": len(with_valid),
            "matched": len(entries),
            "matched_by": matched_by,
            "with_subjects": sum(1 for entry in entries.values() if entry.get("subjects")),
        },
        "books": dict(sorted(entries.items())),
        "unmatched": sorted(book.slug for book in with_valid
                            if not entries.get(book.slug, {}).get("subjects")),
        "invalid_isbn": sorted(invalid),
        # Books looked up without an accepted record, so the next run does not
        # look them up again while their ISBNs are unchanged.
        "searched": dict(sorted(searched.items())),
    }


def load_books(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    records = payload.get("publications") or []
    if not records:
        raise ValueError(f"no publications in {path}")
    return records


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
        "--output", type=Path, default=DEFAULT_OUTPUT,
        help="where to write the headings (default: data_prep/raw_data/subjects.json)",
    )
    parser.add_argument(
        "--limit", type=int, default=None, metavar="N",
        help="look up only the first N books in scope; for trying it out",
    )
    parser.add_argument(
        "--refresh-all", action="store_true",
        help="ignore the previous output and look every book up afresh",
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=None,
        help="cache raw catalogue responses here (development only: catalogues change)",
    )
    parser.add_argument(
        "--delay", type=float, default=0.3,
        help="minimum seconds between requests (default: 0.3)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="look up and report without writing the file",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_console()
    args = parse_args(argv)
    started = time.monotonic()

    if not args.input.is_file():
        print(f"error: {args.input} not found; run scrape_publications.py first", file=sys.stderr)
        return 1
    raw = [record for record in load_books(args.input) if in_scope(record)]
    if args.limit is not None:
        raw = raw[:args.limit]
    books = [prepare_book(record) for record in raw]
    if len({book.slug for book in books}) != len(books):
        print("error: duplicate slugs in the register", file=sys.stderr)
        return 1

    invalid_values = sum(len(book.invalid) for book in books)
    print(f"{len(books)} book(s) in scope ({', '.join(IN_SCOPE_TYPES)} with an ISBN field); "
          f"{sum(1 for book in books if book.isbns)} with a valid ISBN; "
          f"{invalid_values} invalid ISBN value(s) not queried")
    cache = load_cache(args.output, refresh_all=args.refresh_all)
    if args.refresh_all:
        print(f"--refresh-all: ignoring {args.output.name}")
    elif not cache:
        print(f"no usable {args.output.name}; looking every book up")
    print()

    client = CatalogueClient(delay=args.delay, cache_dir=args.cache_dir)
    try:
        payload, stats = enrich(books, client, cache)
    except SubjectsError as error:
        print(f"error: {error}", file=sys.stderr)
        print(f"  after {sum(client.requests.values())} request(s); nothing written",
              file=sys.stderr)
        return 1

    coverage = payload["coverage"]
    types = Counter(subject["type"] for entry in payload["books"].values()
                    for subject in entry.get("subjects", []))
    if stats.mismatched:
        print(f"\n{len(stats.mismatched)} record(s) carry a book's ISBN but not its title "
              "(a wrong ISBN in the register?); refused:")
        for slug, record_id, title in stats.mismatched:
            print(f"  {slug}: {record_id} {title[:70]}")
    print(f"\n{stats.looked_up} looked up, {stats.reused} reused, "
          f"{stats.skipped} skipped as searched before; "
          f"{stats.refused} catalogue record(s) refused for not carrying the ISBN; "
          f"{stats.machine} machine-generated DNB heading(s) or DDC number(s) dropped")
    print(f"{coverage['matched']} of {coverage['with_valid_isbn']} book(s) with a valid ISBN matched "
          f"(DNB {coverage['matched_by']['dnb']}, lobid {coverage['matched_by']['lobid']}); "
          f"{coverage['with_subjects']} with GND headings; "
          f"{len(payload['invalid_isbn'])} without a valid ISBN")
    print("heading types: " + ", ".join(f"{name} {count}" for name, count in types.most_common()))
    print(f"{sum(client.requests.values())} request(s) "
          f"({', '.join(f'{k} {v}' for k, v in sorted(client.requests.items()))}), "
          f"{client.cache_hits} from cache, {time.monotonic() - started:.0f}s")

    if args.dry_run:
        print(f"dry run: would write {args.output}")
        return 0
    atomic_json(args.output, payload, indent=1)
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
