import importlib.util
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'data_prep'))
from languages import detect_language, function_word_language, looks_transliterated
from people import match_people, profile
import dashboard_extras

HAS_NUMPY = importlib.util.find_spec('numpy') is not None


class LanguageTests(unittest.TestCase):
    def test_place_names_do_not_outvote_function_words(self):
        title = 'Religion on the Internet and New Information and Communication Technologies in Burkina Faso'
        self.assertEqual(detect_language({'title': title}), 'en')
        self.assertEqual(function_word_language('Muslim Feminist, Media Sensation, and Religious Entrepreneur'), 'en')

    def test_internal_apostrophes_are_not_french_elisions(self):
        self.assertNotEqual(function_word_language("Edward W. Sa'id: A German-Egyptian Memory"), 'fr')
        self.assertEqual(function_word_language("La Bataille d'Alger et la mémoire de l'indépendance"), 'fr')

    def test_arabic_script_wins_over_its_transliteration(self):
        record = {'title': 'الثورة السورية الكبرى', 'subtitle': 'Al-Thawra al-Suriyya al-Kubra'}
        self.assertEqual(detect_language(record), 'ar')

    def test_transliterated_arabic_with_bracketed_translation(self):
        title = 'al-Mudun iṭāran li-l-intimāʾ: baʿḍ al-mulāḥaẓāt (Cities as Frameworks of Affiliation)'
        self.assertEqual(detect_language({'title': title}), 'ar')
        # Decomposed diacritics (a + U+0304) count like composed ones.
        self.assertTrue(looks_transliterated('tārīkh'))
        # A name is a headword, not a title in Arabic.
        self.assertNotEqual(detect_language({'title': 'Yusuf al-Qaradawi'}), 'ar')

    def test_book_reviews_are_undetermined(self):
        record = {'title': 'Rev.: Madawi Al-Rasheed, The Son King', 'document_type': 'Book reviews'}
        self.assertEqual(detect_language(record), 'und')

    def test_german_by_function_words(self):
        self.assertEqual(detect_language({'title': 'Muslime in der Mark: Als Kriegsgefangene und Internierte in Wünsdorf'}), 'de')


class PeopleTests(unittest.TestCase):
    PEOPLE = [
        {'slug': 'a', 'url': 'https://www.zmo.de/en/people/a', 'name': 'Ulrike Freitag',
         'categories': ['directorate'], 'position': 'Director', 'units': ['state-and-society']},
        {'slug': 'b', 'url': 'https://www.zmo.de/en/people/b', 'name': 'Stefan B. Kirmse',
         'categories': ['research-fellows']},
        {'slug': 'c', 'url': 'https://www.zmo.de/en/people/c', 'name': 'Rana von Mende Altayli',
         'categories': ['former-fellows-and-staff'], 'units': ['lives-and-ecologies']},
        {'slug': 'd', 'url': 'https://www.zmo.de/en/people/d', 'name': 'Mohammed Ahmed',
         'categories': ['former-fellows-and-staff']},
        {'slug': 'e', 'url': 'https://www.zmo.de/en/people/e', 'name': 'Mahmoud Ahmed',
         'categories': ['former-fellows-and-staff']},
    ]

    def test_name_order_case_and_particles(self):
        matched = match_people(['Freitag, Ulrike', 'Mende-Altaylı, Rana von'], self.PEOPLE)
        self.assertEqual(matched['Freitag, Ulrike']['slug'], 'a')
        self.assertEqual(matched['Mende-Altaylı, Rana von']['slug'], 'c')

    def test_fuller_given_name_only_when_unique(self):
        matched = match_people(['Kirmse, Stefan', 'Ahmed, M.'], self.PEOPLE)
        self.assertEqual(matched['Kirmse, Stefan']['slug'], 'b')
        self.assertNotIn('Ahmed, M.', matched)

    def test_two_register_names_cannot_share_one_page(self):
        matched = match_people(['Kirmse, S.', 'Kirmse, Stefan'], self.PEOPLE)
        self.assertEqual(matched, {})

    def test_former_staff_do_not_show_units(self):
        self.assertNotIn('units', profile(self.PEOPLE[2]))
        self.assertEqual(profile(self.PEOPLE[0])['units'], ['state-and-society'])
        self.assertFalse(profile(self.PEOPLE[2])['current'])


class ExtrasTests(unittest.TestCase):
    THEMES = {
        'fit': {'records': 2, 'signature': 'fit'},
        'method': {'embedding': {'model': 'google/embeddinggemma-2', 'model_revision': 'r'}},
        'areas': [{'id': 'a1', 'themes': ['t01']}],
        'themes': [{'id': 't01', 'area': 'a1', 'size': 2, 'signature': 's1', 'terms': ['x']}],
        'records': {'one': {'theme': 't01', 'x': 0.5, 'y': -0.5, 'placed': 'fit'}},
    }
    LABELS = {
        'author': 'Claude Opus 5.5 (Anthropic)', 'model': 'claude-opus-5-5', 'date': '2026-10-22',
        'fit_signature': 'fit',
        'areas': {'a1': {'en': 'Area', 'de': 'Bereich', 'description': {'en': 'd', 'de': 'd'}}},
        'themes': {'t01': {'signature': 's1', 'en': 'Theme', 'de': 'Thema', 'description': {'en': 'd', 'de': 'd'}}},
    }

    def test_labels_for_another_fit_are_refused(self):
        dashboard_extras.check_labels(self.THEMES, self.LABELS)
        stale = {**self.LABELS, 'themes': {'t01': {**self.LABELS['themes']['t01'], 'signature': 'old'}}}
        with self.assertRaises(ValueError):
            dashboard_extras.check_labels(self.THEMES, stale)
        with self.assertRaises(ValueError):
            dashboard_extras.check_labels(self.THEMES, {**self.LABELS, 'fit_signature': 'other'})
        with self.assertRaises(ValueError):
            dashboard_extras.check_labels(self.THEMES, None)

    def test_theme_points_align_with_the_dataset(self):
        dataset = [{'slug': 'one', 'theme': 't01'}, {'slug': 'two'}]
        layer = dashboard_extras.themes_file(dataset, {'themes': self.THEMES, 'labels': self.LABELS}, 'id')
        self.assertEqual(layer['points']['x'], [0.5, None])
        self.assertEqual(layer['themes'][0]['label'], {'en': 'Theme', 'de': 'Thema'})
        self.assertEqual(layer['datasetId'], 'id')

    def test_openalex_layer_indexes_records_and_leaves_out_zmo(self):
        dataset = [{'slug': 'a'}, {'slug': 'b'}, {'slug': 'c'}]
        source = {
            'source': 'https://openalex.org',
            'coverage': {'matched': {'doi': 2}},
            'works': {
                'b': {'id': 'W2', 'institutions': [{'id': 'I2801953415', 'name': 'ZMO'}, {'id': 'I9', 'name': 'Elsewhere', 'country': 'FR'}],
                      'referenced_works': ['W1', 'W7']},
                'c': {'id': 'W3', 'referenced_works': ['W7']},
                'gone': {'id': 'W4'},
            },
            'references': {'W7': {'title': 'Shared', 'count': 2}},
            'citations': [['b', 'c'], ['b', 'gone']],
        }
        layer = dashboard_extras.openalex_file(dataset, {'openalex': source}, 'id')
        self.assertEqual(layer['institutions'], [{'id': 'I9', 'name': 'Elsewhere', 'country': 'FR'}])
        self.assertEqual(layer['works'], [[1, [0]]])
        self.assertEqual(layer['references'][0]['by'], [1, 2])
        self.assertEqual(layer['citations'], [[1, 2]])
        self.assertEqual(layer['referenced'], [1, 2])

    def test_free_copy_is_linked_only_when_it_is_not_the_doi(self):
        dataset = [{'slug': 'a', 'doi': '10.1/X'}, {'slug': 'b'}]
        records = [{'slug': 'a', 'title': 'The history of the Gulf and the Indian Ocean'}, {'slug': 'b', 'title': 'Islam in West Africa and the Sahel today'}]
        works = {'a': {'id': 'W1', 'oa_status': 'gold', 'oa_url': 'https://doi.org/10.1/x'},
                 'b': {'id': 'W2', 'oa_status': 'green', 'oa_url': 'https://repo.example/b.pdf'}}
        dashboard_extras.annotate(dataset, records, {'openalex': {'works': works}})
        self.assertNotIn('oaUrl', dataset[0])
        self.assertEqual(dataset[1]['oaUrl'], 'https://repo.example/b.pdf')
        self.assertEqual(dataset[0]['lang'], 'en')


@unittest.skipUnless(HAS_NUMPY, 'numpy is in requirements-themes.txt, not requirements.txt')
class ThemeTextTests(unittest.TestCase):
    def setUp(self):
        import build_themes
        self.b = build_themes

    def test_formulaic_prefixes_and_imprints_are_removed(self):
        self.assertEqual(self.b.clean_title('Introduction: Sermon in the City'), 'Sermon in the City')
        review = {'document_type': 'Book reviews',
                  'title': 'Rev.: Madawi Al-Rasheed, The Son King. Reform and Repression in Saudi Arabia, London: Hurst, 2020'}
        self.assertEqual(self.b.own_title(review), 'Madawi Al-Rasheed, The Son King. Reform and Repression in Saudi Arabia')
        # A colon inside a title is not an imprint.
        locale = {'document_type': 'Book reviews', 'title': 'Rev.: Locale, Everyday Islam and Modernity: Qasbah Towns'}
        self.assertIn('Qasbah Towns', self.b.own_title(locale))
        self.assertIn('Locale', self.b.own_title(locale))

    def test_only_a_containing_volume_is_added_as_context(self):
        volume = {'slug': 'v', 'title': 'Sermon in the City: Christian and Islamic Preaching in West Africa'}
        chapter = {'slug': 'c', 'title': 'Introduction', 'published_in': {'slug': 'v', 'title': 'Sermon in the City'}}
        article = {'slug': 'a', 'title': 'Iran', 'journal': 'Encyclopaedia of Islam, Three'}
        by_slug = {'v': volume}
        self.assertIn('Preaching in West Africa', self.b.theme_text(chapter, by_slug))
        self.assertEqual(self.b.theme_text(article, by_slug), 'Iran')

    def test_terms_need_several_records(self):
        texts = ['Swahili poetry', 'Swahili poetry today', 'Swahili coast', 'Ottoman city', 'Ottoman empire', 'Ottoman urban']
        terms = self.b.distinctive_terms(texts, ['t1', 't1', 't1', 't2', 't2', 't2'], 5)
        self.assertEqual(terms['t1'], ['swahili'])
        self.assertEqual(terms['t2'], ['ottoman'])

    def test_new_records_are_placed_among_their_neighbours(self):
        np = self.b.np
        fitted = self.b.normalise(np.array([[1.0, 0.0], [0.9, 0.1], [0.0, 1.0]]))
        coords = np.array([[-1.0, -1.0], [-0.8, -0.8], [1.0, 1.0]])
        centroids = self.b.normalise(np.array([[1.0, 0.05], [0.0, 1.0]]))
        themes, positions = self.b.place(self.b.normalise(np.array([[0.95, 0.05]])), fitted, coords, centroids)
        self.assertEqual(themes.tolist(), [0])
        self.assertLess(positions[0][0], 0)


if __name__ == '__main__':
    unittest.main()
