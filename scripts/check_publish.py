#!/usr/bin/env python3
"""Check the public artifact's size and required viewer assets before upload."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'dist'
files = [path for path in root.rglob('*') if path.is_file()]
assert (root / 'index.html').is_file(), 'Built website missing'
assert not any(path.is_symlink() for path in root.rglob('*')), 'Symlinks cannot be published'
total = sum(path.stat().st_size for path in files)
assert total < 1_000_000_000, f'Site exceeds GitHub Pages limit: {total:,} bytes'
assert max(path.stat().st_size for path in files) < 100_000_000, 'A file exceeds GitHub upload limits'

def bundled(url, relative=None):
    path = root / url.lstrip('/') if url.startswith('/') else relative.parent / url
    assert path.is_file(), f'Missing asset: {url}'
    return path

metadata = json.loads((root / 'data/metadata.json').read_text())
manifest_path = bundled(metadata['segments']['url'])
manifest = json.loads(manifest_path.read_text())
for item in [*manifest['chunks'], manifest['overlaps']]:
    bundled(item['url'], manifest_path)
annotations_path = bundled(manifest['annotationsUrl'], manifest_path)
annotations = json.loads(annotations_path.read_text())
bundled(annotations['original_graph_url'], annotations_path)
for item in metadata['savedMap'].values():
    bundled(item)
previews_path = root / 'data/object-novel-views-20261031/index.json'
previews = json.loads(previews_path.read_text())
for item in previews['objects'].values():
    assert bundled(item['url']).stat().st_size == item['bytes'], f'Preview size mismatch: {item["id"]}'
    bundled(item['posterUrl'])
print(f'Publication checks passed: {len(files)} files, {total:,} bytes, {manifest["pointCount"]:,} points.')
