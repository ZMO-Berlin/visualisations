"""Regression tests for the publication scraper's cache and source schema."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_PREP = REPO_ROOT / "data_prep"
sys.path.insert(0, str(DATA_PREP))

from scrape_publications import (  # noqa: E402
    DEFAULT_OUTPUT,
    DOCUMENT_TYPES,
    FILTER_PARAM,
    Publication,
    ScrapeError,
    document_type_options,
    from_record,
    load_previous,
    parse_listing,
    to_record,
    validate_document_types,
)


def document_type_form(options: dict[int, str]) -> str:
    rendered = "".join(
        f'<option value="{type_id}">{label}</option>'
        for type_id, label in options.items()
    )
    return (
        f'<select name="{FILTER_PARAM}">'
        f'<option value="">All</option>{rendered}</select>'
    )


class CacheTests(unittest.TestCase):
    def test_empty_title_round_trips(self) -> None:
        publication = Publication(
            slug="untitled-stub",
            url="https://example.test/untitled-stub",
            fingerprint=" | (Ed.) | Example Press | ",
        )

        cached = to_record(publication)
        self.assertNotIn("title", cached)
        self.assertEqual(from_record(cached), publication)

    def test_load_previous_skips_only_invalid_records(self) -> None:
        payload = {
            "publications": [
                to_record(Publication(slug="good", url="https://example.test/good")),
                {"slug": "bad", "fingerprint": "unchanged"},
            ]
        }

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "publications.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            warnings = io.StringIO()
            with redirect_stderr(warnings):
                cached = load_previous(path)

        self.assertEqual(set(cached), {"good"})
        self.assertIn("'bad' is invalid and will be refetched", warnings.getvalue())

    def test_committed_cache_is_reusable(self) -> None:
        payload = json.loads(DEFAULT_OUTPUT.read_text(encoding="utf-8"))
        warnings = io.StringIO()
        with redirect_stderr(warnings):
            cached = load_previous(DEFAULT_OUTPUT)

        self.assertEqual(warnings.getvalue(), "")
        self.assertEqual(len(cached), len(payload["publications"]))
        self.assertEqual(cached["default-4aaa37118e"].title, "")


class SourceSchemaTests(unittest.TestCase):
    def test_listing_allows_a_blank_title(self) -> None:
        html = """
        <article class="bb-publication--item">
          <h2 class="bb-publication--header__subheadline">
            <a href="/en/publications/publication-search/untitled-stub"></a>
          </h2>
          <h3 class="bb-entry--authors">(Ed.)</h3>
        </article>
        <span class="bb-pagination--item__end">
          <a href="/en/publications/publication-search/page-3">End</a>
        </span>
        """

        entries, last_page = parse_listing(html)

        self.assertEqual(last_page, 3)
        self.assertEqual(entries[0]["slug"], "untitled-stub")
        self.assertEqual(entries[0]["title"], "")

    def test_document_type_options_match_expected_filter(self) -> None:
        html = document_type_form(DOCUMENT_TYPES)

        self.assertEqual(document_type_options(html), DOCUMENT_TYPES)
        validate_document_types(html)

    def test_document_type_change_is_rejected(self) -> None:
        changed = dict(DOCUMENT_TYPES)
        changed[21] = "Books"

        with self.assertRaisesRegex(ScrapeError, "21: 'Monographs' -> 'Books'"):
            validate_document_types(document_type_form(changed))


if __name__ == "__main__":
    unittest.main()
