import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'data_prep'))
sys.path.insert(0, str(ROOT / 'tests'))
import dashboard_extras
import language_decisions
import place_mentions as pm
from regions import Gazetteer
from test_regions import INDIA, JORDAN, OCEAN, SYRIA, gazetteer

RECORD = {'slug': 'lake', 'document_type': 'Journal articles', 'title': 'Submerged Memories',
          'subtitle': 'Displacement around Lake Asad, Syria', 'abstract': 'Villages along the Euphrates were flooded.'}


def mention(text, name, kind='lake', country='Syria', qid=None):
    return {'text': text, 'name': name, 'type': kind, 'country': country, **({'id': qid} if qid else {})}


class CheckTests(unittest.TestCase):
    def test_mentions_must_occur_in_the_record(self):
        out = {'records': [{'slug': 'lake', 'places': [
            mention('Lake Asad', 'Lake Asad'), mention('euphrates', 'Euphrates', 'river', ''),
            mention('Lake Tana', 'Lake Tana', country='Ethiopia'), mention('Syria', 'Syria', 'country'),
            mention('Syria', 'syria', 'country')]}, {'slug': 'gone', 'places': []}]}
        checked, problems = pm.check(out, {'lake': RECORD})
        # Case is ignored, an invented place is dropped, a repeated name kept once.
        self.assertEqual([p['name'] for p in checked['lake']], ['Lake Asad', 'Euphrates', 'Syria'])
        self.assertEqual(problems, {'words not in the record': 1, 'unknown slug': 1})

    def test_unknown_types_become_other(self):
        out = {'records': [{'slug': 'lake', 'places': [mention('Lake Asad', 'Lake Asad', 'reservoir')]}]}
        self.assertEqual(pm.check(out, {'lake': RECORD})[0]['lake'][0]['type'], 'other')

    def test_a_review_is_read_without_its_imprint(self):
        review = {'slug': 'r', 'document_type': 'Book reviews', 'title': 'Rev.: The Volga. A History, Cambridge: CUP, 2021'}
        self.assertNotIn('Cambridge', pm.record_text(review))


class MentionedTests(unittest.TestCase):
    MENTIONS = {'records': {'lake': {'fp': 'x', 'places': [
        mention('Lake Asad', 'Lake Asad', qid='Q979315'), mention('Euphrates', 'Euphrates', 'river', '', 'Q34589'),
        {**mention('Raqqa', 'Raqqa', 'city'), 'id': None}]}}}

    def test_only_resolved_mentions_still_in_the_text(self):
        corrected = {**RECORD, 'abstract': 'Villages were flooded.'}
        self.assertEqual([p['id'] for p in pm.mentioned(RECORD, self.MENTIONS)], ['Q979315', 'Q34589'])
        self.assertEqual([p['id'] for p in pm.mentioned(corrected, self.MENTIONS)], ['Q979315'])
        self.assertEqual(pm.mentioned({**RECORD, 'slug': 'other'}, self.MENTIONS), [])


class ResolutionTests(unittest.TestCase):
    def test_gazetteer_first_but_never_a_country_for_a_river(self):
        gz = gazetteer([SYRIA, JORDAN])
        index = pm.gazetteer_index(gz)
        self.assertEqual(pm.from_gazetteer(mention('Syria', 'Syria', 'country'), gz, index), 'Q858')
        self.assertEqual(pm.from_gazetteer(mention('Syrie', 'Syrie', 'country'), gz, index), 'Q858')
        self.assertIsNone(pm.from_gazetteer(mention('Jordan', 'Jordan', 'river', ''), gz, index))

    def test_score_prefers_the_kind_and_country_named(self):
        place = mention('Faya', 'Faya', 'town', 'Chad')
        town = {'label': 'Faya', 'description': 'town in Borkou, Chad'}
        name = {'label': 'Faya', 'description': 'first name'}
        self.assertGreaterEqual(pm.score(town, place), pm.ACCEPT)
        self.assertLess(pm.score(name, place), 0)

    def test_region_from_countries(self):
        gz = gazetteer([SYRIA, INDIA, OCEAN])
        self.assertEqual(pm.macro_of('Q979315', {'countries': ['Q858']}, gz), 'me')
        # Across two regions: transregional; no known country: unplaced.
        self.assertEqual(pm.macro_of('Q34589', {'countries': ['Q668', 'Q858']}, gz), 'transregional')
        self.assertIsNone(pm.macro_of('Q31', {'countries': ['Q31']}, gz))
        # The list's own regions: for a country the gazetteer lacks, or a place to override.
        self.assertEqual(pm.macro_of('Q9337', {'countries': ['Q31']}, gz, {'Q31': 'sa'}), 'sa')
        self.assertEqual(pm.macro_of('Q508014', {'countries': ['Q858']}, gz, {'Q508014': 'sa'}), 'sa')


class GeneratorTests(unittest.TestCase):
    MENTIONS = {
        'model': pm.MODEL,
        'records': {'lake': {'fp': 'x', 'places': [
            mention('Lake Asad', 'Lake Asad', qid='Q979315'), mention('Syria', 'Syria', 'country', qid='Q858'),
            mention('Euphrates', 'Euphrates', 'river', '', 'Q34589')]}},
        'places': {'Q979315': {'label': {'en': 'Euphrates Lake', 'fr': 'Lac el-Assad'}, 'countries': ['Q858'],
                               'coord': [38.4, 35.9], 'kind': 'lake'},
                   'Q34589': {'label': {'en': 'Euphrates', 'de': 'Euphrat'}, 'countries': ['Q858', 'Q668'],
                              'coord': [47.4, 31.0], 'kind': 'river'},
                   'Q7057805': {'label': {'en': 'Northeast Africa'}, 'countries': [], 'coord': [30.0, 15.0], 'kind': 'world'}},
        'regions': {},
        'reviewed': {'by': 'Reviewer', 'date': '2026-10-22', 'scope': 'all'},
    }

    def test_model_places_follow_the_gazetteer_and_respect_its_decisions(self):
        gz = gazetteer([SYRIA, INDIA], decisions=[{'slug': 'lake', 'place': 'Q34589', 'accept': False}])
        places, added = dashboard_extras.places_of(RECORD, gz, self.MENTIONS)
        self.assertEqual(places, ['Q858', 'Q979315'])
        self.assertEqual(added, ['Q979315'])

    def test_regions_layer_describes_model_places(self):
        gz = gazetteer([SYRIA, INDIA])
        dataset = [{'slug': 'lake', 'places': ['Q858', 'Q979315', 'Q34589', 'Q7057805']}]
        extras = {'gazetteer': gz, 'places': {'places': {'Q858': {'coord': [38.0, 35.0]}}}, 'mentions': self.MENTIONS,
                  'stats': {'placesAdded': {'Q979315', 'Q34589', 'Q7057805', 'Q858'}, 'recordsWithAdded': 1}}
        layer = dashboard_extras.regions_file(dataset, extras, 'id', {})
        entries = {p['id']: p for p in layer['places']}
        self.assertEqual(entries['Q979315'], {'id': 'Q979315', 'label': {'en': 'Euphrates Lake', 'de': 'Euphrates Lake'},
                                              'macro': 'me', 'kind': 'lake', 'coord': [38.4, 35.9]})
        self.assertEqual(entries['Q34589']['macro'], 'transregional')
        # A world region is listed, never drawn.
        self.assertNotIn('coord', entries['Q7057805'])
        mentions = layer['attribution']['mentions']
        self.assertEqual((mentions['model'], mentions['places'], mentions['records']), ('Claude Haiku 5.5', 3, 1))

    def test_language_decision_only_when_the_detector_cannot_tell(self):
        review = {'slug': 'r', 'document_type': 'Book reviews', 'title': 'Rev.: A Book', 'journal': 'H-Soz-Kult'}
        decisions = {'records': {'r': {'fp': language_decisions.fingerprint(review), 'lang': 'de', 'confidence': 'high'}}}
        dataset = [{'slug': 'r'}]
        extras = {'decisions': decisions}
        dashboard_extras.annotate(dataset, [review], extras)
        self.assertEqual(dataset[0]['lang'], 'de')
        self.assertEqual(extras['stats']['languageDecided'], 1)


class DecisionTests(unittest.TestCase):
    RECORD = {'slug': 'r', 'title': 'Object 1', 'published_in': {'title': 'Verpasste Begegnungen'}}

    def decide(self, **entry):
        base = {'fp': language_decisions.fingerprint(self.RECORD), 'lang': 'en', 'confidence': 'high'}
        return language_decisions.decided_language(self.RECORD, {'records': {'r': {**base, **entry}}})

    def test_confident_current_decisions_only(self):
        self.assertEqual(self.decide(), 'en')
        self.assertEqual(self.decide(confidence='medium'), 'en')
        self.assertIsNone(self.decide(confidence='low'))
        self.assertIsNone(self.decide(lang='und'))
        # Made on another title or volume: no longer holds.
        self.assertIsNone(self.decide(fp='0000000000'))
        self.assertIsNone(language_decisions.decided_language(self.RECORD, None))


class PromptTests(unittest.TestCase):
    def test_prompts_name_their_files_and_the_shape_merge_reads(self):
        places = pm.PROMPT.format(batch='b_03.json', out='out_03.json', n=3)
        self.assertIn('b_03.json', places)
        self.assertIn('{"batch": 3, "records": [{"slug": "...", "places": [{"text"', places)
        languages = language_decisions.PROMPT.format(batch='b.json', out='out.json')
        self.assertIn('{"records": [{"slug": "...", "lang": "...", "confidence": "...", "basis": "..."}]}', languages)


class CommittedListTests(unittest.TestCase):
    """The committed lists, which change only when the agents are run again."""

    @classmethod
    def setUpClass(cls):
        cls.gz = Gazetteer.load()
        cls.mentions = pm.load()
        cls.decisions = language_decisions.load()

    def test_every_resolved_mention_can_be_shown(self):
        places = self.mentions['places']
        for slug, entry in self.mentions['records'].items():
            for place in entry['places']:
                self.assertEqual(place['id'], self.mentions['names'][pm.name_key(place)]['id'], slug)
                if place['id']:
                    self.assertTrue(place['id'] in self.gz.places or place['id'] in places, (slug, place['name']))

    def test_every_model_place_has_a_region_and_labels(self):
        regions = self.mentions['regions']
        macros = set(self.gz.macros)
        for qid, detail in self.mentions['places'].items():
            self.assertNotIn(qid, self.gz.places)
            self.assertIn(pm.macro_of(qid, detail, self.gz, regions), macros, qid)
            self.assertTrue(detail['label'].get('en') or detail['label'].get('de'), qid)
        self.assertTrue(set(regions.values()) <= macros)

    def test_decisions_are_language_codes(self):
        for slug, entry in self.decisions['records'].items():
            self.assertRegex(entry['lang'], r'^([a-z]{2}|und)$', slug)
            self.assertIn(entry['confidence'], {'high', 'medium', 'low'}, slug)

    def test_attribution(self):
        self.assertEqual(self.mentions['model']['id'], 'claude-haiku-5-5')
        self.assertEqual(self.decisions['model']['id'], 'claude-haiku-5-5')
        self.assertIn('by', self.mentions['reviewed'])


if __name__ == '__main__':
    unittest.main()
