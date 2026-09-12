"""Compare identities as well as output size before a refresh is published."""
import argparse
import json
import subprocess
from pathlib import Path


def previous(path):
    result = subprocess.run(['git', 'show', f'HEAD:{path.as_posix()}'], capture_output=True)
    return json.loads(result.stdout) if result.returncode == 0 else None


def check_sets(before, after, label):
    removed, added = before - after, after - before
    print(f'{label}: +{len(added)} / -{len(removed)}')
    if added:
        print('Added:', ', '.join(sorted(added)))
    if removed:
        print('Removed:', ', '.join(sorted(removed)))
    if before and len(after & before) / len(before) < 0.9:
        raise ValueError(f'{label}: more than 10% of previous identities disappeared')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('kind', choices=['publications', 'units'])
    args = parser.parse_args()
    path = Path(f'data_prep/raw_data/{args.kind}.json')
    before = previous(path)
    after = json.loads(path.read_text(encoding='utf-8'))
    if before is None:
        return
    if args.kind == 'publications':
        check_sets({r['slug'] for r in before['publications']}, {r['slug'] for r in after['publications']}, 'Publications')
    else:
        current = {u['stem']: u for u in after['units']}
        for unit in before['units']:
            if unit['stem'] not in current:
                raise ValueError(f'Missing unit: {unit["stem"]}')
            text_path = Path('data_prep/raw_data') / f'{unit["stem"]}.txt'
            old_text = subprocess.run(['git', 'show', f'HEAD:{text_path.as_posix()}'], capture_output=True)
            if old_text.returncode == 0:
                before_words = len(old_text.stdout.decode('utf-8').split())
                after_words = len(text_path.read_text(encoding='utf-8').split())
                if before_words and after_words / before_words < 0.6:
                    raise ValueError(f'{unit["stem"]}: more than 40% of corpus words disappeared')
            key = lambda entry: entry.get('url') or entry['title']
            check_sets({key(p) for p in unit['projects']}, {key(p) for p in current[unit['stem']]['projects']}, unit['stem'])


if __name__ == '__main__':
    main()
