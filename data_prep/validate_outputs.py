"""Run deterministic generators in temporary directories and compare outputs."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    for script, destination in [('generate_publication_data.py', 'publications_dashboard/data'), ('generate_word_data.py', 'units_wordcloud/data')]:
        with tempfile.TemporaryDirectory() as temp:
            subprocess.run([sys.executable, str(ROOT / 'data_prep' / script), '--output-dir', temp], check=True, cwd=ROOT)
            generated = {p.name: json.loads(p.read_text(encoding='utf-8')) for p in Path(temp).glob('*.json')}
            existing = {p.name: json.loads(p.read_text(encoding='utf-8')) for p in (ROOT / destination).glob('*.json')}
            if generated != existing:
                raise ValueError(f'Stale outputs: {destination}')
    from update_landing import update
    update(check=True)


if __name__ == '__main__':
    main()
