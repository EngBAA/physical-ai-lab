import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredNovelView } from './object-novel-views.js';

const spec = { sha256: 'segmented-scan-hash', sourceSha256: 'lab-hash' };
const item = { status: 'reviewed', inputKind: 'photographs', id: 131, arcDegrees: 25, bytes: 200000,
  url: '/data/object-novel-views-20261031/131-abcdef.gif', posterUrl: '/data/object-novel-views-20261031/131-abcdef.webp' };
const manifest = () => ({ version: 1, segmentManifestSha256: spec.sha256, labSourceSha256: spec.sourceSha256, objects: { 131: { ...item } } });

test('only the reviewed clip for the selected registered object is available', () => {
  assert.deepEqual(registeredNovelView(manifest(), spec, 131), item);
  assert.equal(registeredNovelView(manifest(), spec, 20), null);
  assert.equal(registeredNovelView(manifest(), { ...spec, sha256: 'other-scan' }, 131), null);
  assert.equal(registeredNovelView(manifest(), { ...spec, sourceSha256: 'other-lab' }, 131), null);
  assert.equal(registeredNovelView(null, spec, 131), null);
});

test('the optimized animation retains the same registration and review checks', () => {
  const data = manifest();
  data.objects[131].url = '/data/object-novel-views-20261031/131-abcdef-animated.webp';
  assert.equal(registeredNovelView(data, spec, 131).url, data.objects[131].url);
  data.objects[131].url = '/data/object-novel-views-20261031/../../unrelated.webp';
  assert.equal(registeredNovelView(data, spec, 131), null);
});

test('reject pending clips, mismatched IDs, invalid arcs, oversized and non-local assets', () => {
  for (const change of [{ status: 'generated_pending_review' }, { inputKind: 'scan' }, { id: 20 }, { arcDegrees: NaN },
    { arcDegrees: 360 }, { bytes: 20 * 1024 * 1024 }, { bytes: -1 },
    { url: 'https://other.example/preview.gif' }, { posterUrl: '/data/../private.webp' }]) {
    const data = manifest(); Object.assign(data.objects[131], change);
    assert.equal(registeredNovelView(data, spec, 131), null);
  }
});

test('a matching item can share a photograph while retaining the selected object ID', () => {
  const data = manifest();
  data.objects[20] = { ...item, id: 20, representative: true, representativeObjectId: 131 };
  assert.equal(registeredNovelView(data, spec, 20).id, 20);
  assert.equal(registeredNovelView(data, spec, 20).url, item.url);
  assert.equal(registeredNovelView(data, spec, 131).id, 131);
  data.objects[20].id = 131;
  assert.equal(registeredNovelView(data, spec, 20), null);
});
