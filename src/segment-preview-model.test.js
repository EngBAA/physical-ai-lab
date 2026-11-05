import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { decodeObjectPreview, previewFrame } from './segment-preview-model.js';

const root = new URL('../', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('src/segment-preview-index.json', root)));
const metadata = JSON.parse(fs.readFileSync(new URL('public/data/metadata.json', root)));

test('all 248 previews belong to the displayed scan, with valid RGB, extents and object IDs', () => {
  assert.equal(index.segmentManifestSha256, metadata.segments.sha256);
  assert.equal(index.labSourceSha256, metadata.segments.sourceSha256);
  assert.equal(Object.keys(index.objects).length, 248);
  for (const [id, entry] of Object.entries(index.objects)) {
    const data = fs.readFileSync(new URL(`public${entry.url}`, root));
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), entry.sha256);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const cloud = decodeObjectPreview(buffer, entry, Number(id));
    assert.equal(cloud.positions.buffer, buffer);
    assert.equal(cloud.colors.length, entry.count * 3);
    assert.ok(entry.count > 0 && entry.count <= entry.sourceCount);
    for (let i = 0; i < cloud.positions.length; i++) {
      assert.ok(cloud.positions[i] >= entry.bounds.min[i % 3] - 1e-6);
      assert.ok(cloud.positions[i] <= entry.bounds.max[i % 3] + 1e-6);
    }
    assert.throws(() => decodeObjectPreview(buffer, entry, Number(id) + 1));
    assert.throws(() => decodeObjectPreview(buffer.slice(0, -1), entry, Number(id)));
  }
});

test('preview framing keeps tall, flat and tiny masks visible during a full vertical revolution', () => {
  for (const id of ['1', '20', '82', '131', '135', '248']) for (const aspect of [.65, 1, 1.6]) {
    const { bounds } = index.objects[id], fit = previewFrame(bounds, aspect);
    const camera = new THREE.PerspectiveCamera(36, aspect, fit.near, fit.far);
    camera.position.set(.3, .18, 1).normalize().multiplyScalar(fit.distance);
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 18) {
      for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
        const p = new THREE.Vector3(x, y, z).sub(new THREE.Vector3(...fit.center));
        p.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).project(camera);
        assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1, `${id}: clipped at ${angle}`);
      }
    }
  }
});
