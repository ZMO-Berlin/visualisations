"""Link the register's authors to their pages on zmo.de.

The register never links a name to a person, and the people directory never
lists a publication, so the only join is the name. It is made with the rules the
generator already trusts for merging spellings, and refused whenever it would
need a guess:

1. **Same words.** "Freitag, Ulrike" in the register and "Ulrike Freitag" on
   zmo.de share every word once case, accents, punctuation and order are set
   aside. Particles come along: "Mende-Altaylı, Rana von" and "Rana von
   Mende-Altaylı" are the same four words.
2. **A fuller given name.** "Kirmse, Stefan" and "Stefan B. Kirmse" share a
   surname, and one given name extends the other token by token, as in the
   merge rules, or contains all of its words ("Çiçek, M. Talha" and "Talha
   Çiçek"). Accepted only when that pairing is unique in both directions: one
   register name, one person.

Turkish dotless ı is read as i, since zmo.de writes "Altayli" where the
register has "Altaylı"; accent folding alone does not join them.

What is shipped is what the person's page shows publicly — the URL, position,
current research units and an ORCID iD if one is linked — plus whether they are
current or former staff, which decides whether units are shown at all: a former
fellow's research unit is not a current one.
"""

from __future__ import annotations

from collections import defaultdict

from generate_publication_data import canonical_name, extends, merge_key

FORMER = "former-fellows-and-staff"


def key(text: str) -> str:
    return merge_key(text.replace("ı", "i").replace("İ", "I"))


def word_key(name: str) -> str:
    """The words of a name, folded and sorted, so order and punctuation vanish."""
    return " ".join(sorted(key(name).split()))


def compatible(given: str, other: str) -> bool:
    """One given name is the other with more detail."""
    words, others = set(given.split()), set(other.split())
    return extends(given, other) or extends(other, given) or words < others or others < words


def match_people(authors: list[str], people: list[dict]) -> dict[str, dict]:
    """Map register author display names to people-page records."""
    by_words: defaultdict[str, list[dict]] = defaultdict(list)
    for person in people:
        by_words[word_key(person["name"])].append(person)

    matched: dict[str, dict] = {}
    for author in authors:
        candidates = by_words.get(word_key(author), [])
        if len(candidates) == 1:
            matched[author] = candidates[0]

    # Rule 2 only among what rule 1 left: a person already linked is not
    # offered again, so an initial cannot take a page from an exact match.
    taken = {id(person) for person in matched.values()}
    remaining = [person for person in people if id(person) not in taken]
    surnames: defaultdict[str, list[tuple[str, dict]]] = defaultdict(list)
    for person in remaining:
        parsed = canonical_name(person["name"])
        if parsed and parsed[1]:
            surnames[key(parsed[0])].append((key(parsed[1]), person))

    pairs: defaultdict[int, list[str]] = defaultdict(list)
    proposals: dict[str, dict] = {}
    for author in authors:
        if author in matched:
            continue
        parsed = canonical_name(author)
        if not parsed or not parsed[1]:
            continue
        given = key(parsed[1])
        fits = [person for other, person in surnames.get(key(parsed[0]), [])
                if compatible(given, other)]
        if len(fits) == 1:
            proposals[author] = fits[0]
            pairs[id(fits[0])].append(author)

    for author, person in proposals.items():
        if len(pairs[id(person)]) == 1:
            matched[author] = person
    return matched


def profile(person: dict) -> dict:
    """What the dashboard shows about a linked author."""
    current = any(category != FORMER for category in person.get("categories", []))
    entry = {"url": person["url"], "current": current}
    if person.get("position"):
        entry["position"] = person["position"]
    if current and person.get("units"):
        entry["units"] = person["units"]
    if current and person.get("regional_focus"):
        entry["focus"] = person["regional_focus"]
    if person.get("orcid"):
        entry["orcid"] = person["orcid"]
    return entry
