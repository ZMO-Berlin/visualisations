"""Tests for the OpenAlex enrichment: matching rules and output shape, no network."""

from __future__ import annotations

import json
import random
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "data_prep"))

import enrich_openalex as oa  # noqa: E402
from enrich_openalex import (  # noqa: E402
    Claim,
    OpenAlexClient,
    OpenAlexError,
    assess,
    build_payload,
    candidate,
    choose,
    citation_edges,
    enrich,
    normalise_doi,
    plan_title_searches,
    prepare_record,
    render_csv,
    gap_rows,
    resolve_claims,
    search_batch,
    shared_references,
    title_parts,
    work_entry,
)

ZMO = "https://openalex.org/I2801953415"


def work(work_id: str, title: str, year: int | None = 2020, authors=(), refs=(),
         doi: str | None = None, kind: str = "article") -> dict:
    """An OpenAlex work as the API returns it. ``authors`` are (name, [institution urls])."""
    return {
        "id": f"https://openalex.org/{work_id}",
        "doi": f"https://doi.org/{doi}" if doi else None,
        "title": title,
        "publication_year": year,
        "type": kind,
        "language": "en",
        "open_access": {"is_oa": False, "oa_status": "closed", "oa_url": None},
        "cited_by_count": 0,
        "primary_topic": None,
        "authorships": [
            {
                "author": {"id": f"https://openalex.org/A{index}", "display_name": name,
                           "orcid": None},
                "raw_author_name": name,
                "institutions": [
                    {"id": url, "display_name": "Leibniz-Zentrum Moderner Orient"
                     if url == ZMO else "Elsewhere", "country_code": "DE", "ror": None}
                    for url in institutions
                ],
            }
            for index, (name, institutions) in enumerate(authors, start=1)
        ],
        "funders": [],
        "referenced_works": [f"https://openalex.org/{ref}" for ref in refs],
    }


def record(slug: str, title: str, year: int | None = 2020, authors=("Freitag, Ulrike",),
           subtitle: str = "", doi: str = "", kind: str = "Journal articles") -> dict:
    """A register record as scrape_publications.py writes it."""
    raw = {"slug": slug, "url": f"https://example.test/{slug}", "title": title,
           "authors": list(authors), "year": year, "document_type": kind}
    if subtitle:
        raw["subtitle"] = subtitle
    if doi:
        raw["doi"] = doi
    return raw


class DoiTests(unittest.TestCase):
    def test_normalisation(self) -> None:
        cases = {
            "10.1017/S0026749X19000271": "10.1017/s0026749x19000271",
            "https://doi.org/10.1111/amet.13375": "10.1111/amet.13375",
            "http://dx.doi.org/10.1080/02634937.2012.720868.": "10.1080/02634937.2012.720868",
            "doi:10.1017/S0020743819000539": "10.1017/s0020743819000539",
            "DOI: 10.14361/9783839411551-014": "10.14361/9783839411551-014",
            "https:// doi.org/10.58144/20241216-0000": "10.58144/20241216-0000",
            "www.doi.org/10.2307/j.ctvx8b76r ": "10.2307/j.ctvx8b76r",
            "10.1111/j.1548-744X.2012.01066.x/pdf": "10.1111/j.1548-744x.2012.01066.x",
            "https://www.tandfonline.com/doi/full/10.1080/00263206.2013.771474":
                "10.1080/00263206.2013.771474",
            "10.5429/2079-3871(2024)v14i2.9en": "10.5429/2079-3871(2024)v14i2.9en",
            "(10.1234/abc);": "10.1234/abc",
            "https://doi.org/10.1234%2Fabc?via=ihub": "10.1234/abc",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(normalise_doi(raw), expected)

    def test_values_that_are_not_dois(self) -> None:
        for raw in ("", None, "urn:nbn:de:101:1-201504233009", "9783110733204-001",
                    "https://hdl.handle.net/10520/ejc-nidan-v5-n2-a6",
                    "https://www.jstor.org/stable/j.ctv9hvrkf", "10.1234/"):
            with self.subTest(raw=raw):
                self.assertIsNone(normalise_doi(raw))


class AcceptanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.record = prepare_record(record(
            "trip", "A Long, Strange Trip", 2013, authors=("Zachariah, Benjamin",),
            subtitle="The Lives in Exile of Har Dayal",
        ))
        self.work = candidate(work(
            "W1", "A long, strange trip: the lives in exile of Har Dayal", 2013,
            authors=[("Benjamin Zachariah", [])],
        ))

    def test_accepts_title_joined_with_subtitle(self) -> None:
        score = assess(self.record, self.work)
        self.assertIsNotNone(score)
        self.assertGreaterEqual(score, 0.9)
        self.assertEqual(choose(self.record, [self.work]).work_id, "W1")

    def test_accepts_a_neighbouring_year_only(self) -> None:
        nearby = candidate(work("W2", "A long, strange trip: the lives in exile of Har Dayal",
                                2014, authors=[("Benjamin Zachariah", [])]))
        distant = candidate(work("W3", "A long, strange trip: the lives in exile of Har Dayal",
                                 2015, authors=[("Benjamin Zachariah", [])]))
        self.assertIsNotNone(assess(self.record, nearby))
        self.assertIsNone(assess(self.record, distant))

    def test_rejects_without_a_shared_surname(self) -> None:
        stranger = candidate(work("W4", "A long, strange trip: the lives in exile of Har Dayal",
                                  2013, authors=[("Jane Doe", [])]))
        self.assertIsNone(assess(self.record, stranger))
        self.assertIsNone(choose(self.record, [stranger]))

    def test_surname_comparison_folds_accents_and_ignores_name_order(self) -> None:
        register = prepare_record(record("x", "Les pouvoirs urbains à Tunis", 2019,
                                         authors=("Lafi, Nora",)))
        reversed_name = candidate(work("W5", "Les pouvoirs urbains a Tunis", 2019,
                                       authors=[("LAFİ Nora", [])]))
        self.assertIsNotNone(assess(register, reversed_name))

    def test_rejects_dissimilar_titles(self) -> None:
        other = candidate(work("W6", "A long journey", 2013,
                               authors=[("Benjamin Zachariah", [])]))
        self.assertIsNone(assess(self.record, other))

    def test_refuses_a_tie(self) -> None:
        twin = candidate(work("W7", "A long, strange trip: the lives in exile of Har Dayal",
                              2013, authors=[("Benjamin Zachariah", [])]))
        choice = choose(self.record, [self.work, twin])
        self.assertIsNone(choice.work_id)
        self.assertEqual(choice.tied, ("W1", "W7"))

    def test_authorless_works_only_as_the_book_form(self) -> None:
        volume = prepare_record(record("v", "Cinema in Muslim Societies", 2016,
                                       authors=("Ahmad, Ali Nobil (ED.)",), kind="Edited volumes"))
        monograph = prepare_record(record("m", "Masculinity, Sexuality, and Illegal Migration",
                                          2011, authors=("Ahmad, Ali Nobil",), kind="Monographs"))
        book = candidate(work("W10", "Cinema in Muslim Societies", 2017, kind="book"))
        review = candidate(work("W11", "Masculinity, Sexuality and Illegal Migration", 2012))
        self.assertIsNotNone(assess(volume, book))
        self.assertIsNone(assess(monograph, review))
        # Without authors on the register side there is nothing to check either way.
        anonymous = prepare_record(record("a", "Masculinity, Sexuality, and Illegal Migration",
                                          2011, authors=()))
        self.assertIsNotNone(assess(anonymous, review))

    def test_the_closer_candidate_wins(self) -> None:
        looser = candidate(work("W8", "A long strange trip: lives in exile of Har Dayal", 2013,
                                authors=[("Benjamin Zachariah", [])]))
        self.assertEqual(choose(self.record, [looser, self.work]).work_id, "W1")

    def test_translated_title_halves(self) -> None:
        title = ("al-Mudun iṭāran li-l-intimāʾ: baʿḍ al-mulāḥaẓāt "
                 "(Cities as Frameworks of Affiliation: Some Considerations)")
        self.assertEqual(title_parts(title), [
            title,
            "al-Mudun iṭāran li-l-intimāʾ: baʿḍ al-mulāḥaẓāt",
            "Cities as Frameworks of Affiliation: Some Considerations",
        ])
        # A date or a language note in brackets is not a title of its own.
        self.assertEqual(title_parts("Centres and Peripheries (1500-1800)"),
                         ["Centres and Peripheries (1500-1800)"])
        english = candidate(work("W9", "Cities as frameworks of affiliation: some considerations",
                                 2025, authors=[("Ulrike Freitag", [])]))
        self.assertIsNotNone(assess(prepare_record(record("m", title, 2025)), english))


class ClaimTests(unittest.TestCase):
    def test_one_work_one_record(self) -> None:
        winners, conflicts = resolve_claims([
            Claim("b-title", "W1", "title", 0.99),
            Claim("a-doi", "W1", "doi", 0.5),
            Claim("c-alone", "W2", "affiliation", 0.95),
        ])
        self.assertEqual(sorted(winners), ["a-doi", "c-alone"])
        self.assertEqual(conflicts, [{"slug": "b-title", "id": "W1", "kept": "a-doi"}])

    def test_equal_claims_go_to_the_first_slug_whatever_the_order(self) -> None:
        claims = [Claim("z", "W1", "doi", 1.0), Claim("a", "W1", "doi", 1.0)]
        self.assertEqual(resolve_claims(claims), resolve_claims(claims[::-1]))
        self.assertEqual(list(resolve_claims(claims)[0]), ["a"])


class TitleSearchPlanTests(unittest.TestCase):
    def test_book_reviews_are_doi_only(self) -> None:
        records = [
            prepare_record(record("review", "Islam and the Politics of Secularism in Turkey",
                                  kind="Book reviews")),
            prepare_record(record("article", "Merchant Networks Centred on Jeddah in Wartime")),
            prepare_record(record("short-review", "Introduction", kind="Book reviews")),
        ]
        plan = plan_title_searches(records, settled=set())
        planned = {slug for queries in plan.batched.values() for slugs in queries.values()
                   for slug in slugs} | {slug for slug, _, _ in plan.narrowed}
        self.assertEqual(planned, {"article"})

    def test_settled_records_and_generic_titles(self) -> None:
        records = [
            prepare_record(record("matched", "Merchant Networks Centred on Jeddah in Wartime")),
            prepare_record(record("intro", "Introduction", 2021)),
            prepare_record(record("about", "About the book", 2021)),
        ]
        plan = plan_title_searches(records, settled={"matched"})
        self.assertEqual(plan.batched, {})
        self.assertEqual([slug for slug, _, _ in plan.narrowed], ["about", "intro"])
        self.assertEqual(oa.search_filter(("introduction",), 2021, "freitag"),
                         "title.search:introduction,raw_author_name.search:freitag,"
                         "publication_year:2020-2022")

    def test_search_text_cannot_inject_filter_syntax(self) -> None:
        text = oa.search_text("War, Peace | NOT: Société (1900–1950)")
        self.assertEqual(text, "war peace not société 1900 1950")
        self.assertEqual(oa.search_text("Société", folded=True), "societe")

    def test_expansion_corpus_for_identifiers_only(self) -> None:
        class Client:
            def __init__(self) -> None:
                self.params = []

            def get(self, path, params):
                self.params.append(params)
                return {"meta": {"count": 0}, "results": []}

        client = Client()
        oa.fetch_by_dois(client, ["10.1234/a"])
        search_batch(client, ["alpha beta gamma"], 2020)
        self.assertEqual(client.params[0].get("include_xpac"), "true")
        self.assertNotIn("include_xpac", client.params[1])

    def test_overflowing_batch_is_split(self) -> None:
        class Client:
            def __init__(self) -> None:
                self.filters = []

            def get(self, path, params):
                self.filters.append(params["filter"])
                broad = "introduction" in params["filter"]
                count = 5000 if broad else 2
                return {"meta": {"count": count},
                        "results": [work(f"W{len(self.filters)}", "x")]}

        client = Client()
        works, broad = search_batch(client, ["alpha beta gamma", "introduction"], 2020)
        self.assertEqual(broad, ["introduction"])
        self.assertEqual(len(client.filters), 3)  # the pair, then each half


class OutputTests(unittest.TestCase):
    def fixture(self):
        records = [prepare_record(record(slug, slug)) for slug in ("a", "b", "c")]
        details = {
            "W1": work("W1", "a", refs=["W9", "W2", "W100"],
                       authors=[("Ulrike Freitag", [ZMO, "https://openalex.org/I5"])]),
            "W2": work("W2", "b", refs=["W9", "W100", "W3"]),
            "W3": work("W3", "c", refs=["W9", "W1"], doi="10.1234/c"),
        }
        winners = {
            "a": Claim("a", "W1", "doi", 1.0),
            "b": Claim("b", "W2", "affiliation", 0.95),
            "c": Claim("c", "W3", "title", 0.92),
        }
        affiliated = [details["W1"], work("W50", "Not in the register", 2019, doi="10.1234/x"),
                      work("W40", "Also missing", 2021)]
        referenced = {"W9": work("W9", "Orientalism", 1978,
                                 authors=[("Edward Said", []), ("B", []), ("C", []), ("D", [])])}
        return records, details, winners, affiliated, referenced

    def test_reference_threshold(self) -> None:
        entries = {"a": {"referenced_works": ["W9", "W2"]},
                   "b": {"referenced_works": ["W9", "W3"]},
                   "c": {"referenced_works": ["W9", "W3", "W3"]}}
        self.assertEqual(shared_references(entries), {"W3": 2, "W9": 3})

    def test_citation_edges(self) -> None:
        entries = {"a": {"id": "W1", "referenced_works": ["W2", "W3", "W1"]},
                   "b": {"id": "W2", "referenced_works": ["W3", "W77"]},
                   "c": {"id": "W3", "referenced_works": []}}
        self.assertEqual(citation_edges(entries), [["a", "b"], ["a", "c"], ["b", "c"]])

    def test_payload(self) -> None:
        records, details, winners, affiliated, referenced = self.fixture()
        payload = build_payload(records, details, winners, [], [{"slug": "b", "doi": "10.9/z"}],
                                affiliated, referenced)
        self.assertEqual(payload["coverage"], {
            "register": 3, "matched": {"doi": 1, "affiliation": 1, "title": 1},
            "with_references": 3, "affiliated_total": 3,
        })
        # W100 is cited twice but OpenAlex no longer resolves it: it is dropped
        # from the references and from every reference list.
        self.assertEqual(payload["references"], {
            "W9": {"title": "Orientalism", "year": 1978, "authors": ["Edward Said", "B", "C"],
                   "count": 3},
        })
        self.assertEqual(payload["citations"], [["a", "b"], ["b", "c"], ["c", "a"]])
        self.assertEqual([w["id"] for w in payload["unmatched_affiliated"]], ["W40", "W50"])
        entry = payload["works"]["a"]
        self.assertEqual(entry["referenced_works"], ["W2", "W9"])
        self.assertEqual(payload["works"]["b"]["referenced_works"], ["W3", "W9"])
        self.assertEqual(entry["authors"], [{"name": "Ulrike Freitag", "id": "A1", "zmo": True}])
        self.assertEqual([i["id"] for i in entry["institutions"]], ["I2801953415", "I5"])
        self.assertNotIn("doi", entry)
        self.assertNotIn("abstract_inverted_index", json.dumps(payload))

    def test_output_is_deterministic(self) -> None:
        records, details, winners, affiliated, referenced = self.fixture()
        conflicts = [{"slug": "z", "id": "W3", "kept": "c"}, {"slug": "d", "id": "W1", "kept": "a"}]
        unresolved = [{"slug": "q", "doi": "10.9/q"}, {"slug": "b", "doi": "10.9/z"}]
        first = build_payload(records, details, winners, conflicts, unresolved,
                              affiliated, referenced)

        shuffled = random.Random(7)
        items = list(winners.items())
        shuffled.shuffle(items)
        affiliated = affiliated[::-1]
        second = build_payload(records[::-1], dict(reversed(details.items())), dict(items),
                               conflicts[::-1], unresolved[::-1], affiliated,
                               dict(reversed(referenced.items())))
        self.assertEqual(json.dumps(first, ensure_ascii=False, indent=1),
                         json.dumps(second, ensure_ascii=False, indent=1))
        self.assertEqual(list(first["works"]), ["a", "b", "c"])
        self.assertEqual([c["slug"] for c in first["conflicts"]], ["d", "z"])
        self.assertEqual([u["slug"] for u in first["unresolved_dois"]], ["b", "q"])

    def test_gap_report(self) -> None:
        records, details, winners, affiliated, referenced = self.fixture()
        payload = build_payload(records, details, winners, [], [{"slug": "b", "doi": "10.9/z"}],
                                affiliated, referenced)
        text = render_csv(gap_rows(payload, {r.slug: r for r in records}))
        self.assertEqual(text.splitlines(), [
            "kind,id_or_slug,title,year,doi,type",
            "in_openalex_not_register,W40,Also missing,2021,,article",
            "in_openalex_not_register,W50,Not in the register,2019,10.1234/x,article",
            "doi_unknown_to_openalex,b,b,2020,10.9/z,Journal articles",
        ])

    def test_work_entry_omits_empty_fields(self) -> None:
        raw = work("W1", "Title", authors=[("Ulrike Freitag", [])])
        raw["authorships"][0]["author"]["orcid"] = "https://orcid.org/0000-0001-8094-4084"
        raw["primary_topic"] = {
            "id": "https://openalex.org/T14141", "display_name": "Colonial History",
            "subfield": {"display_name": "Sociology"}, "field": {"display_name": "Social Sciences"},
        }
        raw["funders"] = [{"id": "https://openalex.org/F1", "display_name": "DFG"}] * 2
        entry = work_entry(raw, "title")
        self.assertEqual(entry["authors"], [
            {"name": "Ulrike Freitag", "id": "A1", "orcid": "0000-0001-8094-4084"}])
        self.assertEqual(entry["topic"], {"id": "T14141", "name": "Colonial History",
                                          "subfield": "Sociology", "field": "Social Sciences"})
        self.assertEqual(entry["funders"], [{"id": "F1", "name": "DFG"}])
        self.assertEqual(entry["cited_by_count"], 0)
        for key in ("doi", "oa_url", "institutions", "referenced_works"):
            self.assertNotIn(key, entry)


class FakeClient:
    """Answers the handful of queries enrich() makes from a fixed set of works."""

    def __init__(self, by_doi, affiliated, searchable, everything) -> None:
        self.by_doi = by_doi
        self.affiliated = affiliated
        self.searchable = searchable
        self.everything = everything
        self.requests = 0
        self.searches: list[str] = []

    def get(self, path, params):
        self.requests += 1
        field, _, value = params["filter"].partition(":")
        if field == "doi":
            results = [w for doi in value.split("|") for w in self.by_doi.get(doi, [])]
        elif field == "institutions.id":
            results = self.affiliated
        elif field == "openalex":
            wanted = set(value.split("|"))
            results = [w for w in self.everything if oa.short_id(w["id"]) in wanted]
        elif field == "title.search":
            queries = value.split(",")[0].split("|")
            self.searches.extend(queries)
            results = [w for w in self.searchable
                       if any(set(q.split()) <= set(oa.search_text(w["title"]).split())
                              for q in queries)]
        else:
            raise AssertionError(params)
        return {"meta": {"count": len(results)}, "results": results}


class PipelineTests(unittest.TestCase):
    def test_enrich_end_to_end(self) -> None:
        records = [prepare_record(raw) for raw in (
            record("doi-hit", "Who Is (Not) a Servant, Anyway?", 2020,
                   authors=("Sinha, Nitin",), doi="https://doi.org/10.1017/S0026749X19000271"),
            record("doi-miss", "Unknown to OpenAlex", 2020, doi="10.9999/nothing"),
            record("affiliated", "A Twentieth-Century Merchant Network Centered on Jeddah", 2017),
            record("searched", "Merchant Communities in the Western Indian Ocean", 2011,
                   authors=("Prange, Sebastian R.",)),
            record("review", "Merchant Communities in the Western Indian Ocean", 2011,
                   authors=("Prange, Sebastian R.",), kind="Book reviews"),
        )]
        servant = work("W10", "Who Is (Not) a Servant, Anyway? Domestic servants", 2020,
                       authors=[("Nitin Sinha", [ZMO])], refs=["W30", "W99"],
                       doi="10.1017/s0026749x19000271")
        jeddah = work("W20", "A Twentieth-Century Merchant Network Centered on Jeddah", 2017,
                      authors=[("Ulrike Freitag", [ZMO])], refs=["W99", "W10"])
        prange = work("W30", "Merchant communities in the Western Indian Ocean", 2011,
                      authors=[("Sebastian R. Prange", [])], refs=["W99"])
        stray = work("W40", "Not in the register", 2019, authors=[("Someone", [ZMO])])
        cited = work("W99", "Orientalism", 1978, authors=[("Edward Said", [])])
        client = FakeClient(
            by_doi={"10.1017/s0026749x19000271": [servant]},
            affiliated=[servant, jeddah, stray],
            searchable=[prange],
            everything=[servant, jeddah, prange, stray, cited],
        )
        with mock.patch("builtins.print"):
            payload, diagnostics = enrich(records, client)

        self.assertEqual({slug: w["match"] for slug, w in payload["works"].items()},
                         {"doi-hit": "doi", "affiliated": "affiliation", "searched": "title"})
        self.assertEqual(payload["unresolved_dois"], [{"slug": "doi-miss", "doi": "10.9999/nothing"}])
        self.assertEqual(payload["unmatched_affiliated"],
                         [{"id": "W40", "title": "Not in the register", "year": 2019,
                           "type": "article"}])
        self.assertEqual(payload["references"], {
            "W99": {"title": "Orientalism", "year": 1978, "authors": ["Edward Said"], "count": 3},
        })
        self.assertEqual(payload["citations"], [["affiliated", "doi-hit"], ["doi-hit", "searched"]])
        self.assertEqual(payload["coverage"]["matched"], {"doi": 1, "affiliation": 1, "title": 1})
        self.assertEqual(diagnostics["ambiguous"], {})


class IncrementalTests(unittest.TestCase):
    """The previous openalex.json as a cache."""

    def raw_records(self) -> list[dict]:
        return [
            record("doi-hit", "Who Is (Not) a Servant, Anyway?", 2020,
                   authors=("Sinha, Nitin",), doi="10.1017/S0026749X19000271"),
            record("affiliated", "A Twentieth-Century Merchant Network Centered on Jeddah", 2017),
            record("searched", "Merchant Communities in the Western Indian Ocean", 2011,
                   authors=("Prange, Sebastian R.",)),
            # The same publication twice in the register: it loses the work to
            # "searched" and is listed as a conflict.
            record("searched-twice", "Merchant Communities in the Western Indian Ocean", 2011,
                   authors=("Prange, Sebastian R.",)),
            record("nowhere", "A Title OpenAlex Has Never Heard Of At All", 2015),
            record("review", "Islam and the Politics of Secularism", 2016, kind="Book reviews"),
        ]

    def client(self, prange_id: str = "W30") -> FakeClient:
        servant = work("W10", "Who Is (Not) a Servant, Anyway?", 2020,
                       authors=[("Nitin Sinha", [ZMO])], refs=["W99"],
                       doi="10.1017/s0026749x19000271")
        jeddah = work("W20", "A Twentieth-Century Merchant Network Centered on Jeddah", 2017,
                      authors=[("Ulrike Freitag", [ZMO])], refs=["W99", "W10"])
        prange = work(prange_id, "Merchant communities in the Western Indian Ocean", 2011,
                      authors=[("Sebastian R. Prange", [])], refs=["W99"])
        cited = work("W99", "Orientalism", 1978, authors=[("Edward Said", [])])
        return FakeClient(
            by_doi={"10.1017/s0026749x19000271": [servant]},
            affiliated=[servant, jeddah],
            searchable=[prange],
            everything=[servant, jeddah, prange, cited],
        )

    def run_enrich(self, raw, client, cache=None, **options) -> dict:
        records = [prepare_record(item) for item in raw]
        with mock.patch("builtins.print"):
            payload, _ = enrich(records, client, cache=cache, **options)
        return payload

    def cached(self, payload: dict, refresh_all: bool = False) -> oa.Cache:
        """Round-trip a payload through a file, as the next run would read it."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "openalex.json"
            oa.atomic_json(path, payload, indent=1)
            return oa.load_cache(path, refresh_all=refresh_all)

    def test_first_run_records_fingerprints(self) -> None:
        raw = self.raw_records()
        payload = self.run_enrich(raw, self.client())
        fps = {item["slug"]: oa.fingerprint(item) for item in raw}
        self.assertEqual(payload["works"]["searched"]["fp"], fps["searched"])
        self.assertEqual(payload["searched"], {slug: fps[slug] for slug in
                                               ("nowhere", "review", "searched-twice")})
        self.assertEqual(payload["conflicts"],
                         [{"slug": "searched-twice", "id": "W30", "kept": "searched"}])

    def test_unchanged_records_are_not_searched_again(self) -> None:
        raw = self.raw_records()
        first = self.run_enrich(raw, self.client())
        client = self.client()
        second = self.run_enrich(raw, client, cache=self.cached(first))
        self.assertEqual(client.searches, [])
        self.assertEqual(json.dumps(second, indent=1), json.dumps(first, indent=1))

    def test_changed_fingerprint_is_matched_again(self) -> None:
        raw = self.raw_records()
        first = self.run_enrich(raw, self.client())
        raw[4]["subtitle"] = "Now with a subtitle"   # "nowhere"
        raw[2]["year"] = 2012                         # "searched": within a year, still matches
        client = self.client()
        second = self.run_enrich(raw, client, cache=self.cached(first))
        searched = " ".join(client.searches)
        self.assertIn("never heard", searched)
        self.assertIn("merchant communities", searched)
        self.assertEqual(second["works"]["searched"]["fp"], oa.fingerprint(raw[2]))
        self.assertEqual(second["searched"]["nowhere"], oa.fingerprint(raw[4]))

    def test_refresh_all_ignores_the_cache(self) -> None:
        raw = self.raw_records()
        first = self.run_enrich(raw, self.client())
        cache = self.cached(first, refresh_all=True)
        self.assertEqual(len(cache), 0)
        client = self.client()
        second = self.run_enrich(raw, client, cache=cache)
        self.assertTrue(client.searches)
        self.assertEqual(second, first)
        self.assertTrue(oa.parse_args(["--refresh-all"]).refresh_all)

    def test_a_vanished_match_is_matched_again(self) -> None:
        raw = self.raw_records()
        first = self.run_enrich(raw, self.client())
        # OpenAlex merged W30 into W31: the old id no longer resolves.
        client = self.client(prange_id="W31")
        second = self.run_enrich(raw, client, cache=self.cached(first))
        self.assertIn("merchant communities", " ".join(client.searches))
        self.assertEqual(second["works"]["searched"]["id"], "W31")

    def test_unsearched_records_are_not_marked_searched(self) -> None:
        payload = self.run_enrich(self.raw_records(), self.client(), title_search=False)
        self.assertEqual(payload["searched"], {})

    def test_unreadable_cache_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "openalex.json"
            path.write_text("{not json", encoding="utf-8")
            with mock.patch("builtins.print"):
                self.assertEqual(len(oa.load_cache(path)), 0)
            self.assertEqual(len(oa.load_cache(Path(directory) / "absent.json")), 0)


class ClientTests(unittest.TestCase):
    def response(self, status: int, body: str = "{}", headers=None):
        result = mock.Mock(status_code=status, text=body, headers=headers or {})
        return result

    def test_key_travels_in_a_header_and_retries_recover(self) -> None:
        client = OpenAlexClient(api_key="secret", mailto="lib@example.test", delay=0)
        replies = [self.response(503), self.response(200, '{"ok": 1}',
                                                     {"X-RateLimit-Cost-USD": "0.0001"})]
        with mock.patch.object(client.session, "get", side_effect=replies) as get, \
                mock.patch("time.sleep"), mock.patch("sys.stderr"):
            self.assertEqual(client.get("/works", {"filter": "doi:10.1/x"}), {"ok": 1})
        url = get.call_args.args[0]
        self.assertNotIn("secret", url)
        self.assertIn("mailto=lib%40example.test", url)
        self.assertEqual(client.session.headers["Authorization"], "Bearer secret")
        self.assertEqual(client.requests, 2)
        self.assertAlmostEqual(client.cost, 0.0001)

    def test_unrecoverable_errors_are_loud(self) -> None:
        client = OpenAlexClient(delay=0)
        with mock.patch.object(client.session, "get", return_value=self.response(400, "bad")):
            with self.assertRaises(OpenAlexError):
                client.get("/works", {"filter": "x"})
        spent = self.response(429, "", {"X-RateLimit-Remaining-USD": "0"})
        with mock.patch.object(client.session, "get", return_value=spent) as get:
            with self.assertRaises(OpenAlexError):
                client.get("/works", {"filter": "y"})
        self.assertEqual(get.call_count, 1)  # an empty budget is not retried

    def test_cache_key_ignores_the_contact_address(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = OpenAlexClient(mailto="a@example.test", cache_dir=Path(directory), delay=0)
            with mock.patch.object(first.session, "get",
                                   return_value=self.response(200, '{"n": 1}')):
                first.get("/works", {"filter": "doi:10.1/x"})
            second = OpenAlexClient(cache_dir=Path(directory), delay=0)
            with mock.patch.object(second.session, "get") as get:
                self.assertEqual(second.get("/works", {"filter": "doi:10.1/x"}), {"n": 1})
            get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
