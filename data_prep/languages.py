"""The language a publication is written in, detected from its title.

The register does not record a language, so this is an inference, and the
dashboard says so. Detection runs on title and subtitle with Lingua, restricted
to the languages the register actually uses, and returns ``und`` (ISO 639-2
"undetermined") whenever the evidence is thin rather than guessing.

Four properties of the register shape the rules, each found by reading the
detector's output against the titles:

1. **Translations ride along in brackets.** "al-Mudun iṭāran li-l-intimāʾ
   (Cities as Frameworks of Affiliation)" is an Arabic article whose English
   gloss would otherwise outvote it. Bracketed segments are dropped when what
   remains still has words in it.
2. **Arabic-script titles carry a transliteration.** The Latin half pushed
   several of them to German, Malay or Swahili, so script is decided first:
   a title with a quarter of its letters in Arabic script is in Arabic (or
   Persian or Urdu), likewise for Cyrillic and CJK.
3. **Transliterated Arabic in Latin script** is not a language Lingua knows; it
   was read as Indonesian, Swahili or Dutch. A title whose words are mostly
   transliterations (ʿ ʾ ā ḥ ṣ…, or an ``al-``/``wa-``/``li-`` prefix) is
   classed as Arabic. English titles quoting a term or two stay English
   because the rule needs a majority.
4. **Place names outvote grammar.** Lingua read "Religion on the Internet … in
   Burkina Faso" as French and "Universalising Islam in Malaysia" as Malay. In a
   title the function words carry the language and the proper nouns do not, so
   function words are scored first and Lingua is consulted only when they are
   inconclusive — and then only at high confidence.
5. **A book review's title is the reviewed book's.** "Rev.: Madawi
   Al-Rasheed, The Son King" says nothing about the language of the review — the
   register prefixes reviews in German journals with "Rev.:" too — so reviews
   are ``und``.
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

UNDETERMINED = "und"

# A Lingua detection is accepted only with this much confidence and this many
# words; below it, one- and two-word encyclopaedia headwords ("Barghash",
# "Armenia") and lists of names were assigned to whichever language happened to
# score highest.
MIN_CONFIDENCE = 0.75
MIN_WORDS = 3
SHORT_CONFIDENCE = 0.95
# Share of a title's letters in a non-Latin script that decides the script.
SCRIPT_SHARE = 0.25
# Share of words that must look transliterated for a Latin title to be Arabic.
TRANSLITERATED_SHARE = 0.5

LATIN_LANGUAGES = (
    "ENGLISH", "GERMAN", "FRENCH", "ITALIAN", "SPANISH", "PORTUGUESE", "DUTCH",
    "TURKISH", "INDONESIAN", "MALAY", "SWAHILI", "POLISH",
)
ARABIC_SCRIPT = ("ARABIC", "PERSIAN", "URDU")
CYRILLIC_SCRIPT = ("RUSSIAN", "UKRAINIAN", "KAZAKH")
CJK_SCRIPT = ("CHINESE", "JAPANESE", "KOREAN")

# Function words per language. A word in several lists counts for each of them
# in proportion ("des" is half German, half French); "in" is in four lists and
# so decides nothing on its own.
FUNCTION_WORDS = {
    "en": "the and of in on for to from between with as at by its their is are after beyond "
          "through into under over among towards toward within without against during about "
          "how what why who when where a an",
    "de": "der die das und des den dem im zur zum für über von vom mit auf eine einer eines "
          "einem ein zwischen nach aus bei als ist sind oder nicht wie zu am unter gegen ohne "
          "durch um seit in an",
    "fr": "le la les des du de et une un dans pour sur entre au aux par en d l avec ou est "
          "sont chez vers sous sans son sa ses leur leurs quelques à a",
    "es": "el los las y del en de la una un para por con entre sobre su sus como al",
    "it": "il lo gli le della delle dei degli del nel nella e di da per con tra fra una uno "
          "un sul sulla al alla in",
    "pt": "o os as e do da dos das em na para com um uma",
    "nl": "het een en van de in op voor met tussen naar",
    "tr": "ve bir ile için bu olarak üzerine döneminde",
    "ms": "dan di yang dalam untuk dengan ke dari pada sebagai",
    "sw": "na wa za ya kwa katika",
}
FUNCTION_WORD_LANGUAGES: dict[str, list[str]] = {}
for _code, _words in FUNCTION_WORDS.items():
    for _word in _words.split():
        FUNCTION_WORD_LANGUAGES.setdefault(_word, []).append(_code)
# Malay and Indonesian share their function words; Lingua tells them apart.
LINGUA_SPLIT = {"ms": ("MALAY", "INDONESIAN")}
# Words keep their internal apostrophes and hyphens: "Sa'id" is not French "sa",
# "Almanya'ya" is not Swahili "ya", and "vis-à-vis" is not French "à". Only a
# French elision ("l'islam", "d'Alger") is split, and its article counted.
TOKEN = re.compile(r"[^\W\d_]+(?:[-'’][^\W\d_]+)*", re.UNICODE)
ELISION = re.compile(r"^(l|d|qu|j|n|s|c)['’](.+)$")

BRACKETED = re.compile(r"\s*[\(\[][^\)\]]*(?:[\)\]]|$)")
WORD = re.compile(r"[^\W\d_][^\s]*", re.UNICODE)
# Ayn and hamza as modifier letters, and the diacritics of Arabic transliteration
# — macron, dot below, line below, breve below — checked after decomposition, so
# "ā" counts whether the register stored it composed or as "a" + U+0304 (both
# occur). Circumflex, caron and breve above are left out: Turkish and French
# use them ("Değerlendirme", "Inkâr").
TRANSLITERATION_LETTERS = set("ʿʾʼʻ")
TRANSLITERATION_COMBINING = set("̣̱̮̄")
ARTICLE_PREFIX = re.compile(r"^(al|el|wa|li|bi|fi|wal|bil|lil)-", re.IGNORECASE)
# Not a possessive: "Eid's" and "Grandpa's" are English.
INNER_APOSTROPHE = re.compile(r"[^\W\d_]['‘’](?!s)[^\W\d_]", re.UNICODE)


@lru_cache(maxsize=None)
def _detector(names: tuple[str, ...]):
    from lingua import Language, LanguageDetectorBuilder

    return LanguageDetectorBuilder.from_languages(
        *(getattr(Language, name) for name in names)
    ).build()


def _script_of(char: str) -> str | None:
    name = unicodedata.name(char, "")
    for script in ("ARABIC", "CYRILLIC", "CJK", "HIRAGANA", "KATAKANA", "HANGUL"):
        if name.startswith(script):
            return {"HIRAGANA": "CJK", "KATAKANA": "CJK", "HANGUL": "CJK"}.get(script, script)
    return "LATIN" if name.startswith("LATIN") else None


def _detect(text: str, names: tuple[str, ...], min_words: int) -> str:
    """Lingua's verdict, if confident enough for the length of the text.

    Below ``min_words`` a title is accepted only at near-certainty: "Einleitung"
    is German beyond doubt, "Introduction" is English or French.
    """
    words = WORD.findall(text)
    if not words:
        return UNDETERMINED
    best = _detector(names).compute_language_confidence_values(text)[0]
    if best.value < (MIN_CONFIDENCE if len(words) >= min_words else SHORT_CONFIDENCE):
        return UNDETERMINED
    return best.language.iso_code_639_1.name.lower()


def function_word_language(text: str) -> str | None:
    """The language whose function words clearly dominate, or None.

    Clearly means at least one whole word's worth of evidence and twice the
    runner-up's, so a title with one "the" and one "des" is left to Lingua.
    """
    scores: dict[str, float] = {}
    for word in TOKEN.findall(text.lower()):
        elided = ELISION.match(word)
        for token in (elided.group(1), elided.group(2)) if elided else (word,):
            languages = FUNCTION_WORD_LANGUAGES.get(token)
            for code in languages or ():
                scores[code] = scores.get(code, 0.0) + 1 / len(languages)
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    if not ranked or ranked[0][1] < 1:
        return None
    if len(ranked) > 1 and ranked[0][1] < 2 * ranked[1][1]:
        return None
    code = ranked[0][0]
    if code in LINGUA_SPLIT:
        best = _detector(LINGUA_SPLIT[code]).compute_language_confidence_values(text)[0]
        return best.language.iso_code_639_1.name.lower()
    return code


def looks_transliterated(word: str) -> bool:
    """An ``al-``/``wa-`` prefix, a transliteration diacritic, or an apostrophe
    standing for ayn or hamza inside a word ("As'ila", "Qira'a")."""
    if ARTICLE_PREFIX.match(word) or INNER_APOSTROPHE.search(word):
        return True
    return any(char in TRANSLITERATION_LETTERS or char in TRANSLITERATION_COMBINING
               for char in unicodedata.normalize("NFD", word))


def detect_language(record: dict) -> str:
    """ISO 639-1 code for a raw register record, or ``und``."""
    if record.get("document_type") == "Book reviews":
        return UNDETERMINED

    text = " ".join(part for part in (record.get("title"), record.get("subtitle")) if part).strip()
    text = unicodedata.normalize("NFC", text)
    if not text:
        return UNDETERMINED

    # Drop bracketed translations, but only when something is left to read.
    main = BRACKETED.sub(" ", text)
    if len(WORD.findall(main)) >= 2:
        text = " ".join(main.split())

    scripts: dict[str, int] = {}
    for char in text:
        if char.isalpha():
            script = _script_of(char)
            if script:
                scripts[script] = scripts.get(script, 0) + 1
    letters = sum(scripts.values()) or 1

    for script, names in (("ARABIC", ARABIC_SCRIPT), ("CYRILLIC", CYRILLIC_SCRIPT), ("CJK", CJK_SCRIPT)):
        if scripts.get(script, 0) / letters >= SCRIPT_SHARE:
            # Only the run in that script is informative; the Latin half is a
            # transliteration or a translation.
            native = "".join(c if _script_of(c) == script or not c.isalpha() else " " for c in text)
            # Word counts mean little in Chinese, so one is enough there. An
            # Arabic-script title Lingua cannot place is still most likely
            # Arabic: the register has no Persian or Urdu title it could not.
            found = _detect(native, names, 1)
            return "ar" if found == UNDETERMINED and script == "ARABIC" else found

    # Three words at least: a bare name ("Yusuf al-Qaradawi") is a headword in
    # an encyclopaedia, not a title in Arabic.
    words = WORD.findall(text)
    if len(words) >= MIN_WORDS and sum(looks_transliterated(w) for w in words) / len(words) >= TRANSLITERATED_SHARE:
        return "ar"

    return function_word_language(text) or _detect(text, LATIN_LANGUAGES, MIN_WORDS)
