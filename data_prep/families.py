"""Resolve directed volume/chapter links without merging bibliographic records."""
from urllib.parse import quote


def build_families(records):
    known = {record['slug']: record for record in records}
    families = {}

    def reference(ref):
        slug = ref.get('slug', '')
        record = known.get(slug, ref)
        return {'slug': slug, 'title': record.get('title') or slug,
                'url': record.get('url') or ('https://www.zmo.de/en/publications/publication-search/' + quote(slug)),
                'registered': slug in known}

    def add(parent, child):
        if not parent.get('slug') or not child.get('slug') or parent['slug'] == child['slug']:
            return
        family = families.setdefault(parent['slug'], {'parent': reference(parent), 'children': {}})
        family['children'][child['slug']] = reference(child)

    for record in records:
        if record.get('published_in'):
            add(record['published_in'], record)
        for child in record.get('contributions', []):
            add(record, child)
    return [{'parent': family['parent'], 'children': sorted(family['children'].values(), key=lambda x: x['slug'])}
            for _, family in sorted(families.items())]
