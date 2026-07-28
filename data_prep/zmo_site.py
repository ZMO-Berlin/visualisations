#!/usr/bin/env python3
"""Shared plumbing for talking to zmo.de.

Everything here is about *how* to reach the site and read a page, not about
what any particular scraper is looking for. ``scrape_zmo.py`` (research units)
and ``scrape_publications.py`` (the publication register) both build on it.
"""

from __future__ import annotations

import hashlib
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.zmo.de"

# Identify the crawler so ZMO can see what is hitting the site. Each scraper
# appends its own name; this is the shared tail.
USER_AGENT_SUFFIX = "(+https://github.com/fmadore/ZMO; research data preparation)"

# Longest cache filename kept verbatim before it is truncated and hashed.
MAX_CACHE_NAME = 80


class ScrapeError(RuntimeError):
    """Raised when a page does not look the way the extractor expects.

    The selectors the scrapers use depend on the site's TYPO3 theme. If ZMO
    restyles the site they will stop matching, and the failure has to be loud:
    silently writing a shorter file would quietly shrink the published data
    instead of reporting a problem.
    """


class Fetcher:
    """HTTP client with a shared session, retries and a politeness delay."""

    def __init__(self, delay: float = 0.5, timeout: float = 30.0, retries: int = 3,
                 cache_dir: Path | None = None, user_agent: str | None = None) -> None:
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.cache_dir = cache_dir
        self.session = requests.Session()
        self.session.headers["User-Agent"] = user_agent or f"ZMO-Scraper/1.0 {USER_AGENT_SUFFIX}"
        self._last_request = 0.0

        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def get(self, url: str) -> str:
        cached = self._cache_path(url)
        if cached and cached.exists():
            return cached.read_text(encoding="utf-8")

        html = self._request(url)

        if cached:
            cached.write_text(html, encoding="utf-8")
        return html

    def _request(self, url: str) -> str:
        last_error: Exception | None = None

        for attempt in range(1, self.retries + 1):
            self._throttle()
            try:
                response = self.session.get(url, timeout=self.timeout)
                response.raise_for_status()
                # Let requests honour the declared charset; the site serves UTF-8.
                response.encoding = response.encoding or "utf-8"
                return response.text
            except requests.RequestException as error:
                last_error = error
                if attempt < self.retries:
                    backoff = 2 ** (attempt - 1)
                    print(f"  retry {attempt}/{self.retries - 1} in {backoff}s: {error}", file=sys.stderr)
                    time.sleep(backoff)

        raise ScrapeError(f"could not fetch {url}: {last_error}")

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_request = time.monotonic()

    def _cache_path(self, url: str) -> Path | None:
        if not self.cache_dir:
            return None
        parsed = urlparse(url)
        # The query string carries the publication filters, so two pages that
        # differ only by filter must not share a cache entry.
        name = re.sub(r"[^A-Za-z0-9]+", "_", parsed.path + parsed.query).strip("_") or "index"
        # Publication slugs are whole subtitles and routinely run past Windows'
        # 260-character path limit, so long names keep a readable head and a
        # hash of the full URL to stay unique.
        if len(name) > MAX_CACHE_NAME:
            digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
            name = f"{name[:MAX_CACHE_NAME]}_{digest}"
        return self.cache_dir / f"{name}.html"


def content_root(html: str) -> BeautifulSoup:
    """Return the indexable part of the page.

    TYPO3 wraps editorial content in ``<!--TYPO3SEARCH_begin-->`` /
    ``<!--TYPO3SEARCH_end-->`` for its own indexer. Slicing on those markers
    drops the navigation, breadcrumb and footer, which otherwise contribute
    hundreds of menu words to every page.
    """
    start = html.find("<!--TYPO3SEARCH_begin-->")
    end = html.find("<!--TYPO3SEARCH_end-->")
    fragment = html[start:end] if start >= 0 and end > start else html
    return BeautifulSoup(fragment, "html.parser")


# Zero-width and bidi marks appear in text pasted from Word into the CMS. They
# are invisible but survive tokenisation, producing duplicate "word" entries
# that differ only by an unprintable character.
INVISIBLE_CHARS = dict.fromkeys(map(ord, "​‌‍⁠﻿‎‏"), None)


def clean_text(node) -> str:
    """Flatten a node to a single normalised line.

    A space separator keeps words apart across nested ``<strong>``/``<i>`` tags;
    ``\\xa0`` comes from ``&nbsp;`` in the source.
    """
    text = node.get_text(" ", strip=True).translate(INVISIBLE_CHARS).replace("\xa0", " ")
    return " ".join(text.split())


def configure_console() -> None:
    """Make stdout/stderr tolerate non-ASCII.

    Titles contain characters such as en-dashes and 'ı' that the default
    Windows console codepage cannot encode, which would otherwise abort the run
    with a UnicodeEncodeError partway through — from a progress message, not
    from anything wrong with the data.
    """
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
