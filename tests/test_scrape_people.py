"""Unit tests for the people-directory scraper (no network)."""

from __future__ import annotations

import json
import sys
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "data_prep"))

from scrape_people import (  # noqa: E402
    GERMAN_UNIT_SLUGS,
    LISTINGS,
    UNIT_SLUGS,
    Fetcher,
    Person,
    ScrapeError,
    coverage_problem,
    crawl_listing,
    parse_listing_page,
    parse_person,
    person_slug,
    project_link,
    strip_honorifics,
    to_record,
    unit_of,
)

EMAIL = "jane.doe(at)zmo.de"
PHONE = "+49-(0)30-80307-999"

# A person page as the site serves it: navigation outside the TYPO3SEARCH
# markers (linking a research unit and a listing, neither of which belongs to
# the person), then the profile with contact details, labelled info lines and a
# CV section.
PERSON_PAGE = f"""<!DOCTYPE html>
<html><body>
<nav>
  <a href="/en/research/state-and-society">State and Society</a>
  <a href="/en/research/lives-and-ecologies/some-nav-teaser">Teaser</a>
  <a href="/en/people/research-fellows">Research Fellows</a>
</nav>
<!--TYPO3SEARCH_begin-->
<div class="bb-page--title__header"><div class="bb-page--title__headline">People</div></div>
<article class="bb-container bb-person--detail bb-entry--detail">
  <header class="bb-person--header">
    <h1 class="bb-person--header__name">
      Prof. Dr. Jane Doe
    </h1>
    <p class="bb-person--header__jobtitle">
      Research Fellow
    </p>
  </header>
  <div class="bb-person--container bb-person--contact">
    <p class="bb-person--contact__info bb-person--contact__phone">Phone: {PHONE}</p>
    <p class="bb-person--contact__info bb-person--contact__email">
      Email: <a href="mailto:jane.doe@zmo.de" data-mailto-token="x">{EMAIL}</a>
    </p>
    <p class="bb-person--contact__info bb-person--contact__url">
      Personal website:
      <a href="https://orcid.org/0000-0002-1825-009X">https://orcid.org/0000-0002-1825-009X</a>
    </p>
  </div>
  <div class="bb-person--container bb-person--info">
    <div class="bb-person--info__line">
      <h2 class="bb-person--info__label">Research project:</h2>
      <p class="bb-person--info__entry">
        Principal Investigator:
        <a href="https://www.zmo.de/en/research/state-and-society/umbrella-project">Umbrella&nbsp;Project</a>;<br>
        Individual Project: <a href="/en/research/state-and-society/umbrella-project/jane-doe#c123">Jane's Project</a>
        with <a href="https://external-project.example.org/en/research/religion-and-intellectual-culture/x">External Partner</a>
      </p>
    </div>
    <div class="bb-person--info__line">
      <h2 class="bb-person--info__label">Current research:</h2>
      <p class="bb-person--info__entry">
        <a href="https://www.zmo.de/forschung/lebenswege-und-oekologien/german-project#c4221">German Project</a>;
        <a href="/en/forschung/staat-und-gesellschaft/crafte/jane-doe">Mis-prefixed Project</a>;
        <a href="http://www.zmo.de/forschung/projekte_2006/translokalitaet.html">Translocality</a>;
        <a href="https://www.zmo.de/de/forschung/hauptforschungsprogramm/older">Older Programme</a>;
        <a href="https://www.zmo.de/en/research/state-and-society/umbrella-project#c9">Umbrella again</a>
      </p>
    </div>
    <div class="bb-person--info__line">
      <h2 class="bb-person--info__label">Regional focus:</h2>
      <p class="bb-person--info__entry">
        South Asia, especially India;&nbsp;Indian Ocean
      </p>
    </div>
  </div>
  <div class="bb-container bb-container--historylisttype">
    <h3 class="bb-container--header__headline">Positions</h3>
    <div class="bb-person--career__description">Since 2020: Research Fellow at ZMO, phone {PHONE}</div>
    <p>Earlier: <a href="https://www.zmo.de/en/research/religion-and-intellectual-culture/cv-project">CV Project</a>,
       <a href="/forschung/religion-und-intellektuelle-kultur/cv-german">CV German Project</a> and
       <a href="http://www.zmo.de/forschung/projekte_2004_2005/cv-legacy.html">CV Legacy Project</a></p>
  </div>
</article>
<!--TYPO3SEARCH_end-->
<footer><a href="/en/research/religion-and-intellectual-culture">Footer link</a></footer>
</body></html>
"""


def listing_page(slugs: list[str], listing: str, page: int, last: int) -> str:
    """A listing page with result items, the filter/sort links and pagination."""
    items = "".join(
        f"""<article class="bb-persons--result__item bb-result--list__item">
              <header class="bb-persons--header">
                <a class="bb-persons__link bb-persons__name" href="/en/people/{slug}">
                  <h2 class="bb-persons--header__name">Dr. {slug.title()}</h2>
                </a>
              </header>
              <p class="bb-persons--contact__email">Email: <a href="#">{slug}(at)zmo.de</a></p>
            </article>"""
        for slug in slugs
    )
    numbers = "".join(
        f'<li class="bb-pagination--item"><a href="/en/people/{listing}/page-{n}">{n}</a></li>'
        for n in range(1, last + 1) if n != page
    )
    following = (
        f'<li class="bb-pagination--item__next"><a rel="next" href="/en/people/{listing}/page-{page + 1}">&gt;</a></li>'
        if page < last else ""
    )
    return f"""<html><body>
<nav>{''.join(f'<a href="/en/people/{name}">{name}</a>' for name in LISTINGS)}
<a href="/en/people/student-assistants">Student assistants</a></nav>
<!--TYPO3SEARCH_begin-->
<form action="/en/people/{listing}"><a href="/en/people/{listing}">Clear filters</a></form>
<a href="/en/people/{listing}/page-1?sortBy=lastname">Last name</a>
<div class="bb-result--list">{items}</div>
<ul class="bb-pagination">{numbers}{following}</ul>
<!--TYPO3SEARCH_end-->
</body></html>"""


class FakeFetcher(Fetcher):
    """Serves canned pages by URL; fails the test on any other request."""

    def __init__(self, pages: dict[str, str]) -> None:
        super().__init__(delay=0)
        self.pages = pages
        self.requested: list[str] = []

    def get(self, url: str) -> str:
        self.requested.append(url)
        if url not in self.pages:
            raise AssertionError(f"unexpected request: {url}")
        return self.pages[url]


class HonorificTests(unittest.TestCase):
    def test_titles_and_degrees_are_stripped(self) -> None:
        cases = {
            "Prof. Dr. Ulrike Freitag": "Ulrike Freitag",
            "PD Dr. Nora Lafi": "Nora Lafi",
            "PD. Dr. Katja Füllberg-Stolberg": "Katja Füllberg-Stolberg",
            "Dr. Anandita Bajpai": "Anandita Bajpai",
            "Dr. habil. Tilo Grätz": "Tilo Grätz",
            "Prof. Dr. phil. Fritz Steppat": "Fritz Steppat",
            "Dozent Dr. Samuli Schielke": "Samuli Schielke",
            "Dr. des. Jane Roe": "Jane Roe",
            "Dipl.-Soz., Dipl.-Krim. Robert Pelzer": "Robert Pelzer",
            "Prof. Marc David Baer": "Marc David Baer",
            "Jane Roe, M.A.": "Jane Roe",
            "Jane Roe MA": "Jane Roe",
            "Jane Roe, PhD": "Jane Roe",
        }
        for printed, expected in cases.items():
            with self.subTest(printed=printed):
                self.assertEqual(strip_honorifics(printed), expected)

    def test_names_without_titles_are_untouched(self) -> None:
        for name in (
            "Maija Susarina",
            "M. Ali Raza",
            "PDavid Smith",
            "S. M. Faizan Ahmed",
            "Joseph Désiré Som I",
            "Leyla von Mende",
            "Ma Lin",
        ):
            with self.subTest(name=name):
                self.assertEqual(strip_honorifics(name), name)

    def test_initial_after_title_is_kept(self) -> None:
        self.assertEqual(strip_honorifics("Dr. M. Ali Raza"), "M. Ali Raza")
        self.assertEqual(strip_honorifics("Prof. Dr. Stefan B. Kirmse"), "Stefan B. Kirmse")


class PersonPageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.person = parse_person(PERSON_PAGE, "prof-dr-jane-doe")
        self.record = to_record(self.person)

    def test_name_position_and_url(self) -> None:
        self.assertEqual(self.record["slug"], "prof-dr-jane-doe")
        self.assertEqual(self.record["url"], "https://www.zmo.de/en/people/prof-dr-jane-doe")
        self.assertEqual(self.record["name"], "Jane Doe")
        self.assertEqual(self.record["display_name"], "Prof. Dr. Jane Doe")
        self.assertEqual(self.record["position"], "Research Fellow")

    def test_projects_come_from_the_current_research_block(self) -> None:
        self.assertEqual(self.record["projects"], [
            {"title": "Umbrella Project",
             "url": "https://www.zmo.de/en/research/state-and-society/umbrella-project"},
            {"title": "Jane's Project",
             "url": "https://www.zmo.de/en/research/state-and-society/umbrella-project/jane-doe"},
            {"title": "German Project",
             "url": "https://www.zmo.de/forschung/lebenswege-und-oekologien/german-project"},
            {"title": "Mis-prefixed Project",
             "url": "https://www.zmo.de/en/forschung/staat-und-gesellschaft/crafte/jane-doe"},
            {"title": "Translocality",
             "url": "https://www.zmo.de/forschung/projekte_2006/translokalitaet.html"},
            {"title": "Older Programme",
             "url": "https://www.zmo.de/de/forschung/hauptforschungsprogramm/older"},
        ])

    def test_links_outside_the_block_are_ignored(self) -> None:
        urls = json.dumps(self.record["projects"])
        for needle in ("external-project", "nav-teaser", "Footer", "cv-project", "cv-german", "cv-legacy"):
            with self.subTest(needle=needle):
                self.assertNotIn(needle, urls)

    def test_units_are_known_slugs_from_current_projects(self) -> None:
        # English and German slugs both count. Navigation, the footer and the CV
        # link religion-and-intellectual-culture, the current projects do not;
        # "projekte_2006" and "hauptforschungsprogramm" are not research units.
        self.assertEqual(self.record["units"], ["state-and-society", "lives-and-ecologies"])

    def test_research_topic_label_counts_but_regional_focus_does_not(self) -> None:
        page = PERSON_PAGE.replace("Current research:", "Research topic:")
        self.assertEqual(to_record(parse_person(page, "x"))["units"],
                         ["state-and-society", "lives-and-ecologies"])
        page = PERSON_PAGE.replace("Current research:", "Regional focus:")
        self.assertEqual(to_record(parse_person(page, "x"))["units"], ["state-and-society"])

    def test_german_unit_slugs_cover_every_unit(self) -> None:
        self.assertEqual(sorted(GERMAN_UNIT_SLUGS.values()), sorted(UNIT_SLUGS))

    def test_project_link_prefixes(self) -> None:
        cases = {
            "/en/research/lives-and-ecologies/x/": "https://www.zmo.de/en/research/lives-and-ecologies/x",
            "/forschung/staat-und-gesellschaft/x?y=1#c2": "https://www.zmo.de/forschung/staat-und-gesellschaft/x",
            "https://zmo.de/de/forschung/religion-und-intellektuelle-kultur/x": "https://www.zmo.de/de/forschung/religion-und-intellektuelle-kultur/x",
            "/en/forschung/lebenswege-und-oekologien/x": "https://www.zmo.de/en/forschung/lebenswege-und-oekologien/x",
            "/en/research": None,
            "/forschung/": None,
            "/en/people/someone": None,
            "https://example.org/forschung/staat-und-gesellschaft/x": None,
            "mailto:someone@zmo.de": None,
        }
        for href, expected in cases.items():
            with self.subTest(href=href):
                self.assertEqual(project_link(href), expected)
        self.assertEqual(unit_of("https://www.zmo.de/forschung/staat-und-gesellschaft/x"), "state-and-society")
        self.assertEqual(unit_of("https://www.zmo.de/en/forschung/lebenswege-und-oekologien/x"), "lives-and-ecologies")
        self.assertIsNone(unit_of("https://www.zmo.de/en/research/mainresearchprogram/x"))

    def test_regional_focus(self) -> None:
        self.assertEqual(self.record["regional_focus"], "South Asia, especially India; Indian Ocean")

    def test_orcid(self) -> None:
        self.assertEqual(self.record["orcid"], "0000-0002-1825-009X")

    def test_no_contact_details_are_kept(self) -> None:
        serialised = json.dumps(self.record, ensure_ascii=False)
        for needle in (EMAIL, "jane.doe@zmo.de", "(at)zmo.de", "mailto", PHONE, "80307", "Phone", "Email"):
            with self.subTest(needle=needle):
                self.assertNotIn(needle, serialised)

    def test_empty_fields_are_omitted(self) -> None:
        page = PERSON_PAGE.replace("Prof. Dr. Jane Doe", "Jane Doe")
        start = page.index('<div class="bb-person--container bb-person--info">')
        end = page.index("<!--TYPO3SEARCH_end-->")
        page = page[:start] + "</article>" + page[end:]
        page = page.replace("https://orcid.org/0000-0002-1825-009X", "https://example.org/")
        record = to_record(parse_person(page, "jane-doe"))
        self.assertEqual(record, {
            "slug": "jane-doe",
            "url": "https://www.zmo.de/en/people/jane-doe",
            "name": "Jane Doe",
            "position": "Research Fellow",
        })

    def test_missing_name_fails_loudly(self) -> None:
        page = PERSON_PAGE.replace("Prof. Dr. Jane Doe", "")
        with self.assertRaises(ScrapeError):
            parse_person(page, "nobody")

    def test_contact_orcid_wins_over_a_co_authors(self) -> None:
        page = PERSON_PAGE.replace(
            "</article>",
            '<a href="https://orcid.org/0000-0001-5109-3700">co-author</a></article>',
        )
        record = to_record(parse_person(page, "prof-dr-jane-doe"))
        self.assertEqual(record["orcid"], "0000-0002-1825-009X")

    def test_two_orcids_outside_the_contact_block_are_ambiguous(self) -> None:
        page = PERSON_PAGE.replace("https://orcid.org/0000-0002-1825-009X", "https://example.org/")
        page = page.replace(
            "</article>",
            '<a href="https://orcid.org/0000-0002-1825-009X">me?</a>'
            '<a href="http://orcid.org/0000-0001-5109-3700">co-author</a></article>',
        )
        with redirect_stderr(StringIO()):
            record = to_record(parse_person(page, "prof-dr-jane-doe"))
        self.assertNotIn("orcid", record)

    def test_single_orcid_outside_the_contact_block_is_kept(self) -> None:
        page = PERSON_PAGE.replace("https://orcid.org/0000-0002-1825-009X", "https://example.org/")
        page = page.replace(
            "</article>",
            '<p>ORCID: <a href="https://orcid.org/0000-0001-5109-3700">iD</a></p></article>',
        )
        self.assertEqual(to_record(parse_person(page, "x"))["orcid"], "0000-0001-5109-3700")


class CoverageTests(unittest.TestCase):
    def test_a_crawl_where_nobody_has_a_field_is_refused(self) -> None:
        sane = parse_person(PERSON_PAGE, "prof-dr-jane-doe")
        bare = Person(slug="former", url="https://www.zmo.de/en/people/former", name="Former")
        self.assertIsNone(coverage_problem([sane, bare]))
        self.assertIsNotNone(coverage_problem([bare, bare]))


class ListingTests(unittest.TestCase):
    def test_slug_filter_excludes_navigation(self) -> None:
        self.assertEqual(person_slug("/en/people/dr-anandita-bajpai"), "dr-anandita-bajpai")
        self.assertEqual(person_slug("https://www.zmo.de/en/people/maija-susarina"), "maija-susarina")
        for href in (
            "/en/people/research-fellows",
            "/en/people/former-fellows-and-staff",
            "/en/people/student-assistants",
            "/en/people/research-fellows/page-2",
            "/en/people",
            "https://example.org/en/people/someone",
            "/de/personen/someone",
        ):
            with self.subTest(href=href):
                self.assertIsNone(person_slug(href))

    def test_listing_page_reads_items_only(self) -> None:
        html = listing_page(["dr-a", "dr-b"], "research-fellows", page=1, last=2)
        slugs, next_url = parse_listing_page(html)
        self.assertEqual(slugs, ["dr-a", "dr-b"])
        self.assertEqual(next_url, "https://www.zmo.de/en/people/research-fellows/page-2")
        self.assertNotIn(EMAIL, json.dumps(slugs))

    def test_pagination_is_followed_to_the_end(self) -> None:
        base = "https://www.zmo.de/en/people/former-fellows-and-staff"
        fetcher = FakeFetcher({
            base: listing_page(["a", "b"], "former-fellows-and-staff", 1, 3),
            f"{base}/page-2": listing_page(["c", "d"], "former-fellows-and-staff", 2, 3),
            f"{base}/page-3": listing_page(["e"], "former-fellows-and-staff", 3, 3),
        })
        self.assertEqual(crawl_listing(fetcher, "former-fellows-and-staff"), ["a", "b", "c", "d", "e"])
        self.assertEqual(len(fetcher.requested), 3)

    def test_broken_pagination_fails_loudly(self) -> None:
        base = "https://www.zmo.de/en/people/research-fellows"
        # Page 1 advertises three pages, but page 2 has lost its "next" link.
        fetcher = FakeFetcher({
            base: listing_page(["a"], "research-fellows", 1, 3),
            f"{base}/page-2": listing_page(["b"], "research-fellows", 2, 2),
        })
        with self.assertRaises(ScrapeError):
            crawl_listing(fetcher, "research-fellows")

    def test_empty_listing_fails_loudly(self) -> None:
        base = "https://www.zmo.de/en/people/guests"
        fetcher = FakeFetcher({base: listing_page([], "guests", 1, 1)})
        with self.assertRaises(ScrapeError):
            crawl_listing(fetcher, "guests")


if __name__ == "__main__":
    unittest.main()
