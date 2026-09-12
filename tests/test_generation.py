import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'data_prep'))
from generate_publication_data import extends, NameIndex
from families import build_families
from output import atomic_json, identity
from check_refresh import check_sets
from vocabulary import build_vocabulary
from collections import Counter


class NameTests(unittest.TestCase):
    def test_initial_expansion(self):
        self.assertTrue(extends('s', 'samuli'))
        self.assertTrue(extends('s b', 'stefan b'))
        self.assertFalse(extends('jo', 'john'))
        self.assertFalse(extends('samuli', 's'))
        self.assertFalse(extends('s', 's'))

    def test_unique_candidate_only(self):
        index = NameIndex()
        for surname, given in [('Ahmed', 'M.'), ('Ahmed', 'Mohammed'), ('Ahmed', 'Mahmoud')]:
            index.add(surname, given)
        index.resolve()
        self.assertEqual(index.merges(), [])
        index = NameIndex()
        index.add('Schielke', 'S.')
        index.add('Schielke', 'Samuli')
        index.resolve()
        self.assertEqual(index.merges(), [('Schielke, S.', 'Schielke, Samuli')])


class OutputTests(unittest.TestCase):
    def test_atomic_output_and_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'data.json'
            atomic_json(path, {'a': 1})
            self.assertEqual(json.loads(path.read_text()), {'a': 1})
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])
        self.assertEqual(identity({'a': 1, 'b': 2}), identity({'b': 2, 'a': 1}))

    def test_family_links_deduplicate_both_directions(self):
        records = [{'slug':'volume','title':'Volume','contributions':[{'slug':'chapter','title':'Chapter'}]},
                   {'slug':'chapter','title':'Chapter','published_in':{'slug':'volume','title':'Volume'}}]
        result = build_families(records)
        self.assertEqual(len(result), 1)
        self.assertEqual(len(result[0]['children']), 1)
        self.assertTrue(result[0]['parent']['registered'])

    def test_identity_guard_detects_replacement_despite_same_count(self):
        with self.assertRaises(ValueError):
            check_sets({'a','b'}, {'c','d'}, 'fixture')


class VocabularyTests(unittest.TestCase):
    def test_source_attribution_and_missing_heading_guard(self):
        class Processor:
            def process(self, text):
                return text.lower().split()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unit = {'stem': 'unit', 'label': 'Unit', 'url': 'https://www.zmo.de/unit',
                    'projects': [{'title': 'Project title', 'url': 'https://www.zmo.de/project'}]}
            (root / 'units.json').write_text(json.dumps({'units': [unit]}))
            (root / 'unit.txt').write_text('Unit description\n\nProject title\n\nHistory matters')
            data = build_vocabulary(root, {'unit': Counter(history=1, matters=1)}, Processor())
            self.assertEqual(data['passages'][-1]['url'], unit['projects'][0]['url'])
            self.assertEqual(data['units'][0]['tokens'], 2)
            (root / 'unit.txt').write_text('Missing project boundary')
            with self.assertRaises(ValueError):
                build_vocabulary(root, {'unit': Counter(history=1)}, Processor())


if __name__ == '__main__':
    unittest.main()
