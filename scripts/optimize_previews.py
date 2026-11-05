#!/usr/bin/env python3
"""Encode the saved GIF previews for GitHub Pages without changing scan data."""
import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[1]


def encode(task):
    source, destination = map(Path, task)
    with Image.open(source) as animation:
        frames = [frame.convert('RGB') for frame in ImageSequence.Iterator(animation)]
        durations = []
        for index in range(animation.n_frames):
            animation.seek(index)
            durations.append(animation.info.get('duration', 100))
        size = animation.size
    frames[0].save(destination, format='WEBP', save_all=True,
                   append_images=frames[1:], quality=90, method=4,
                   duration=durations, loop=0, background=(0, 0, 0, 0))
    with Image.open(destination) as result:
        if result.n_frames != len(frames) or result.size != size:
            raise ValueError(f'Animation dimensions or frame count changed: {source.name}')
        actual_durations = []
        for index in range(result.n_frames):
            result.seek(index)
            result.load()
            actual_durations.append(result.info['duration'])
        if actual_durations != durations:
            raise ValueError(f'Animation timing changed: {source.name}')
    return source.name, {'bytes': destination.stat().st_size,
                         'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
                         'frames': len(frames), 'sourceBytes': source.stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True,
                        help='Original public/data/object-novel-views-20261031 folder')
    args = parser.parse_args()
    destination = ROOT / 'public/data/object-novel-views-20261031'
    source = args.source.resolve()
    manifest = json.loads((source / 'index.json').read_text())
    files = sorted({Path(item['url']).name for item in manifest['objects'].values()})
    tasks = [(source / name, destination / (Path(name).stem + '-animated.webp')) for name in files]
    encoded = {}
    with ProcessPoolExecutor(max_workers=4) as pool:
        for index, (name, result) in enumerate(pool.map(encode, tasks), 1):
            encoded[name] = result
            if index % 20 == 0:
                print(f'Encoded and checked {index}/{len(tasks)} animations', flush=True)
    for item in manifest['objects'].values():
        original = Path(item['url'])
        result = encoded[original.name]
        item['sourceGifSha256'] = item['sha256']
        item['url'] = str(original.with_name(original.stem + '-animated.webp'))
        item['bytes'] = result['bytes']
        item['sha256'] = result['sha256']
        item['animationFrames'] = result['frames']
        item.pop('gifFrames', None)
        item['encoding'] = {'format': 'animated-webp', 'quality': 90,
                            'sourceDimensionsAndTimingPreserved': True}
    (destination / 'index.json').write_text(json.dumps(manifest, indent=2) + '\n')
    report = {'animations': len(tasks), 'sourceBytes': sum(v['sourceBytes'] for v in encoded.values()),
              'encodedBytes': sum(v['bytes'] for v in encoded.values()),
              'dimensionsFramesAndTimingVerified': True, 'quality': 90}
    (ROOT / 'artifacts/preview-encoding.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
