"""Generate the HTML fallback values and previews alongside their JSON sources."""
import json
import re
from pathlib import Path
from output import atomic_text

ROOT = Path(__file__).resolve().parents[1]


def update(check=False):
    meta = json.loads((ROOT / 'publications_dashboard/data/meta.json').read_text(encoding='utf-8'))
    words = json.loads((ROOT / 'units_wordcloud/data/combined_word_frequencies.json').read_text(encoding='utf-8'))
    from html import escape
    for locale in ('en', 'de'):
        path = ROOT / locale / 'index.html'
        text = path.read_text(encoding='utf-8')
        original = text
        for field in ('publications', 'authors'):
            value = f'{meta["counts"][field]:,}'
            if locale == 'de':
                value = value.replace(',', '.')
            text = re.sub(rf'(data-figure="{field}">)[^<]*', lambda m: m[1] + value, text)
        years = meta['years']
        if years:
            text = re.sub(r'(data-figure="years">).*?(</div>)', lambda m: m[1] + f'{years["min"]}<span class="dash">–</span>{years["max"]}' + m[2], text)
        # Replace only marked preview contents; markup outside these slots is editorial.
        peak = max(row['count'] for row in meta['perYear']) or 1
        bars = ''.join(f'<span class="card__bar" style="height:{max(row["count"] / peak * 100, 1.5):.6f}%"></span>' for row in meta['perYear'])
        text = re.sub(r'(<div[^>]*\bdata-spark(?:="[^"]*")?[^>]*>).*?(</div>)', lambda m: m[1] + bars + m[2], text, flags=re.S)
        for edge, value in [('from', years['min']), ('to', years['max'])]:
            text = re.sub(rf'(data-spark-{edge}(?:="[^"]*")?>)[^<]*', lambda m: m[1] + str(value), text)
        top = words[:11]
        most, least = max(w['size'] for w in top), min(w['size'] for w in top)
        spans = []
        for i in range(len(top)):
            word = top[i * 5 % len(top)]
            size = 13 + int((word['size'] - least) / (most - least) * 21 + 0.5) if most != least else 22
            spans.append(f'<span style="font-size:{size}px;color:var(--cloud-{i % 6 + 1})">{escape(word["text"])}</span>')
        text = re.sub(r'(<div[^>]*\bdata-cloud(?:="[^"]*")?[^>]*>).*?(</div>)', lambda m: m[1] + ''.join(spans) + m[2], text, flags=re.S)
        if check and text != original:
            raise ValueError(f'Stale landing fallback: {path}')
        if not check:
            atomic_text(path, text)


if __name__ == '__main__':
    import sys
    update('--check' in sys.argv)
