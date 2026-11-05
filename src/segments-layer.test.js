import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSegmentChunk, pickSegmentId, segmentsSpec, segmentCountsMatch } from './segments-layer.js';

test('registration rejects a different lab scan or an external asset', () => {
  const hash = 'a'.repeat(64);
  const metadata = { sourceProvenance: { sha256: hash }, segments: {
    url: '/data/segments/manifest.json', sourceSha256: hash, coordinateFrame: 'viewer-y-up', pointCount: 42,
  } };
  assert.equal(segmentsSpec(metadata, 'http://lab:4174/data/metadata.json').url, 'http://lab:4174/data/segments/manifest.json');
  assert.throws(() => segmentsSpec({ ...metadata, segments: { ...metadata.segments, sourceSha256: 'b'.repeat(64) } }, 'http://lab:4174/'));
  assert.throws(() => segmentsSpec({ ...metadata, segments: { ...metadata.segments, url: 'https://external.test/cloud' } }, 'http://lab:4174/'));
});

test('GPU-ready format preserves RGB, signed coordinates and overlapping object IDs without decoding copies', () => {
  const buffer = new ArrayBuffer(70), h = new DataView(buffer);
  [0x4753424d, 1, 2, 32, 56, 64, 0, 0].forEach((n, i) => h.setUint32(i * 4, n, true));
  // For two points: positions 24 B, colours 6 B, padding 2 B, IDs 4 B = 68 B.
  assert.throws(() => decodeSegmentChunk(buffer, 2));
  const valid = buffer.slice(0, 68);
  new Float32Array(valid, 32, 6).set([-4.5, .1, 12, 3, -1, 7]);
  new Uint8Array(valid, 56, 6).set([0, 128, 255, 255, 3, 9]);
  new Uint16Array(valid, 64, 2).set([0, 248]);
  const chunk = decodeSegmentChunk(valid, 2);
  assert.equal(chunk.positions.buffer, valid);
  assert.equal(chunk.positions[0], -4.5);
  assert.deepEqual([...chunk.colors], [0, 128, 255, 255, 3, 9]);
  assert.deepEqual([...chunk.ids], [0, 248]);
  new DataView(valid).setUint32(20, 63, true);
  assert.throws(() => decodeSegmentChunk(valid, 2));
});

test('picking chooses the nearest annotated pixel and ignores background/invalid IDs', () => {
  const pixels = new Uint8Array(100), objects = new Map([[7, {}], [248, {}]]);
  pixels[0] = 7; pixels[12 * 4] = 248;
  assert.equal(pickSegmentId(pixels, objects), 248);
  pixels[12 * 4] = 250;
  assert.equal(pickSegmentId(pixels, objects), 7);
  pixels[0] = 0;
  assert.equal(pickSegmentId(pixels, objects), 0);
});

test('edited clouds must account for removed, inferred and overlapping points', () => {
  const source = { display_point_count: 100 };
  const m = { pointCount: 100, overlapCount: 20, chunks: [{ count: 100 }], overlaps: { count: 20 }, allSourcePointsRetained: true };
  assert.equal(segmentCountsMatch(m, source), true);
  const edited = { ...m, allSourcePointsRetained: false, pointCount: 95, overlapCount: 18,
    sourcePointCount: 100, sourceOverlapCount: 20, chunks: [{ count: 90 }, { count: 5 }], overlaps: { count: 18 },
    edit: { type: 'captured-realman-removal', removedPointCount: 10, inferredPointCount: 5, removedOverlapCount: 2 } };
  assert.equal(segmentCountsMatch(edited, source), true);
  assert.equal(segmentCountsMatch({ ...edited, edit: undefined }, source), false);
  assert.equal(segmentCountsMatch({ ...edited, sourcePointCount: 101 }, source), false);
  assert.equal(segmentCountsMatch({ ...edited, overlaps: { count: 20 } }, source), false);
  for (const bad of [-1, 1.5, NaN, Infinity, 101]) {
    assert.equal(segmentCountsMatch({ ...edited, edit: { ...edited.edit, removedPointCount: bad } }, source), false);
  }
});
