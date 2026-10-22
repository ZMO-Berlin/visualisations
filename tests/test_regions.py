import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'data_prep'))
from regions import Gazetteer
import dashboard_extras


def gazetteer(places, ignore=(), decisions=()):
    data = {
        'macro_regions': [{'id': 'me', 'en': 'Middle East', 'de': 'Nahost'}, {'id': 'sa', 'en': 'South Asia', 'de': 'Südasien'},
                          {'id': 'transregional', 'en': 'Transregional', 'de': 'Überregional'}],
        'ignore': list(ignore),
        'places': places,
    }
    return Gazetteer(data, {'decisions': list(decisions), 'reviewed': {'by': 'Reviewer', 'date': '2026-10-22'}})


SYRIA = {'id': 'Q858', 'en': 'Syria', 'de': 'Syrien', 'fr': 'Syrie', 'kind': 'country', 'macro': 'me',
         'names': ['Syria', 'Syrien', 'Syrie', 'Syrian*', 'syrisch*']}
TURKEY = {'id': 'Q43', 'en': 'Turkey', 'de': 'Türkei', 'fr': 'Turquie', 'kind': 'country', 'macro': 'me',
          'names': ['Turkey', 'Türkei', 'Turkish']}
INDIA = {'id': 'Q668', 'en': 'India', 'de': 'Indien', 'fr': 'Inde', 'kind': 'country', 'macro': 'sa', 'names': ['India', 'Indian*']}
OCEAN = {'id': 'Q1239', 'en': 'Indian Ocean', 'de': 'Indischer Ozean', 'fr': 'Océan Indien', 'kind': 'sea',
         'macro': 'transregional', 'names': ['Indian Ocean', 'Indischer Ozean']}
CHAD = {'id': 'Q657', 'en': 'Chad', 'de': 'Tschad', 'fr': 'Tchad', 'kind': 'country', 'macro': 'me', 'names': ['Tschad', '=Chad']}
JORDAN = {'id': 'Q810', 'en': 'Jordan', 'de': 'Jordanien', 'fr': 'Jordanie', 'kind': 'country', 'macro': 'me',
          'names': ['Jordanien', '=Jordan'], 'ambiguous': True}


def places(gz, text):
    return [gz.places[m.place]['en'] for m in gz.find(text, 'title')]


class MatchingTests(unittest.TestCase):
    def test_longest_name_wins(self):
        gz = gazetteer([INDIA, OCEAN])
        self.assertEqual(places(gz, 'Trade across the Indian Ocean and in India'), ['Indian Ocean', 'India'])

    def test_word_endings_and_languages(self):
        gz = gazetteer([SYRIA, TURKEY])
        self.assertEqual(places(gz, 'Die syrischen Geflüchteten in der Türkei'), ['Syria', 'Turkey'])
        self.assertEqual(places(gz, 'Syrians in Istanbul'), ['Syria'])
        # Whole words only: "Syrianisation" would be a stem match, "Asyria" is not.
        self.assertEqual(places(gz, 'Asyria'), [])

    def test_hyphenated_words_count_every_part(self):
        gz = gazetteer([SYRIA, TURKEY])
        self.assertEqual(places(gz, 'The Syrian-Turkish border'), ['Syria', 'Turkey'])

    def test_case_sensitive_names(self):
        gz = gazetteer([CHAD])
        self.assertEqual(places(gz, 'Lake Chad'), ['Chad'])
        self.assertEqual(places(gz, 'a chad of paper'), [])

    def test_ignored_phrases_are_removed_first(self):
        berlin = {'id': 'Q64', 'en': 'Berlin', 'de': 'Berlin', 'fr': 'Berlin', 'kind': 'city', 'macro': 'transregional', 'names': ['Berlin']}
        gz = gazetteer([berlin], ignore=['ZMO Berlin'])
        self.assertEqual(places(gz, 'Fellows at ZMO Berlin'), [])
        self.assertEqual(places(gz, 'Migrants in Berlin'), ['Berlin'])

    def test_review_decisions_reject_or_reassign(self):
        decisions = [{'slug': 'smith', 'place': 'Q810', 'accept': False},
                     {'slug': 'moved', 'place': 'Q810', 'accept': False, 'to': 'Q858'}]
        gz = gazetteer([JORDAN, SYRIA], decisions=decisions)
        self.assertEqual(gz.places_of({'slug': 'smith', 'title': 'Daniel Jordan Smith, To Be a Man'}), [])
        self.assertEqual(gz.places_of({'slug': 'moved', 'title': 'Refugees in Jordan'}), ['Q858'])
        self.assertEqual(gz.places_of({'slug': 'kept', 'title': 'Refugees in Jordan'}), ['Q810'])

    def test_review_imprints_are_not_places(self):
        london = {'id': 'Q84', 'en': 'London', 'de': 'London', 'fr': 'Londres', 'kind': 'city', 'macro': 'transregional', 'names': ['London']}
        gz = gazetteer([london, SYRIA])
        review = {'slug': 'r', 'document_type': 'Book reviews', 'title': 'Rev.: A. Author, Syria Today, London: Hurst, 2020'}
        self.assertEqual(gz.places_of(review), ['Q858'])

    def test_abstracts_are_searched_too(self):
        gz = gazetteer([SYRIA, TURKEY])
        self.assertEqual(gz.places_of({'slug': 'a', 'title': 'Hospitality', 'abstract': 'Syrians in Turkey since 2011.'}), ['Q858', 'Q43'])


class CommittedGazetteerTests(unittest.TestCase):
    def setUp(self):
        self.gz = Gazetteer.load()
        self.coords = json.loads((ROOT / 'data_prep/raw_data/places.json').read_text(encoding='utf-8'))['places']

    def test_every_place_is_complete_and_unique(self):
        ids = [p['id'] for p in self.gz.data['places']]
        self.assertEqual(len(ids), len(set(ids)))
        for place in self.gz.data['places']:
            self.assertRegex(place['id'], r'^Q\d+$')
            self.assertIn(place['macro'], self.gz.macros)
            self.assertTrue(place['names'])
            for lang in ('en', 'de', 'fr'):
                self.assertTrue(place[lang])

    def test_mapped_places_have_coordinates(self):
        for place in self.gz.data['places']:
            if place.get('mapped', True):
                self.assertIn('coord', self.coords.get(place['id'], {}), place['en'])

    def test_review_decisions_name_known_places(self):
        # Not "nothing is unreviewed": a monthly refresh may bring a new
        # "Jordan", which keeps the default and is listed in the review report
        # rather than failing the run.
        for (slug, place), decision in self.gz.decisions.items():
            self.assertIn(place, self.gz.places, slug)
            if decision.get('to'):
                self.assertIn(decision['to'], self.gz.places, slug)


class RegionsLayerTests(unittest.TestCase):
    def test_layer_lists_used_places_and_current_focus(self):
        gz = gazetteer([SYRIA, INDIA, OCEAN])
        dataset = [{'slug': 'a', 'places': ['Q858']}]
        extras = {'gazetteer': gz, 'places': {'places': {'Q858': {'coord': [38.0, 35.0]}, 'Q668': {'coord': [78.0, 22.0]}}},
                  'people': {'people': [
                      {'url': 'https://www.zmo.de/en/people/x', 'name': 'X Y', 'categories': ['research-fellows'], 'regional_focus': 'South Asia, especially India'},
                      {'url': 'https://www.zmo.de/en/people/z', 'name': 'Z W', 'categories': ['former-fellows-and-staff'], 'regional_focus': 'Syria'},
                  ]}}
        layer = dashboard_extras.regions_file(dataset, extras, 'id', {'Y, X': {'url': 'https://www.zmo.de/en/people/x'}})
        self.assertEqual([p['id'] for p in layer['places']], ['Q668', 'Q858'])
        self.assertEqual(layer['focus'], [{'name': 'Y, X', 'url': 'https://www.zmo.de/en/people/x',
                                           'text': 'South Asia, especially India', 'places': ['Q668']}])
        self.assertEqual([m.get('slot') for m in layer['macros']], [1, 2, None])
        self.assertEqual(layer['attribution']['reviewed']['by'], 'Reviewer')

    def test_subject_layer_labels_only_headings_in_use(self):
        extras = {'subjects': {'sources': {'dnb': 'https://services.dnb.de/sru/dnb'}, 'books': {
            'a': {'subjects': [{'id': '4027743-2', 'label': 'Islam', 'type': 'SubjectHeading'}]},
            'gone': {'subjects': [{'id': '4074187-4', 'label': 'Ägypten', 'type': 'PlaceOrGeographicName'}]}}}}
        dataset = [{'slug': 'a', 'type': 'Monographs', 'gnd': ['4027743-2']}, {'slug': 'b', 'type': 'Edited volumes'}]
        layer = dashboard_extras.subjects_file(dataset, extras, 'id')
        self.assertEqual(layer['headings'], {'4027743-2': {'label': 'Islam', 'type': 'SubjectHeading'}})
        self.assertEqual(layer['coverage'], {'books': 2, 'withHeadings': 1})


if __name__ == '__main__':
    unittest.main()
