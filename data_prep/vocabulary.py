"""Complete vocabulary and attributable passages, derived from committed text."""
import json
import re
from output import identity


def build_vocabulary(input_dir, counts, processor):
    manifest = json.loads((input_dir / 'units.json').read_text(encoding='utf-8'))
    units = []
    passages = []
    for unit in manifest['units']:
        stem = unit['stem']
        if stem not in counts:
            continue
        units.append({key: unit[key] for key in ('stem', 'label', 'url')}
                     | {'tokens': sum(counts[stem].values()), 'projects': len(unit['projects'])})
        # Headings were preserved by render_document(). Match exact normalized
        # text; do not attribute a paragraph to a project based on fuzzy guesses.
        normalize = lambda value: ' '.join(value.split()).casefold()
        headings = {normalize(entry['title']): entry for entry in unit['projects']}
        seen = set()
        current = {'title': unit['label'], 'url': unit['url']}
        for block in re.split(r'\n\s*\n', (input_dir / f'{stem}.txt').read_text(encoding='utf-8')):
            text = block.strip()
            if not text:
                continue
            if normalize(text) in headings:
                seen.add(normalize(text))
                current = headings[normalize(text)]
            terms = sorted(set(processor.process(text)))
            passages.append({'unit': stem, 'title': current['title'],
                             'url': current.get('url') or unit['url'], 'text': text, 'terms': terms})
        if seen != set(headings):
            raise ValueError(f'Missing project headings in {stem}: {set(headings) - seen}')
    terms = sorted(set().union(*(counter.keys() for counter in counts.values())))
    matrix = [{'term': term, 'counts': [counts[unit['stem']][term] for unit in units]} for term in terms]
    result = {'schemaVersion': 1, 'units': units, 'terms': matrix, 'passages': passages}
    result['datasetId'] = identity(result)
    return result
