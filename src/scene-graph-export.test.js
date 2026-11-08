import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { recordingCamera, recordingFormat, recordingName } from './scene-graph-export.js';

test('video recording negotiates an available encoder and matching file extension', () => {
  assert.equal(recordingFormat(null), null);
  assert.equal(recordingFormat({ isTypeSupported: () => false }), null);
  assert.equal(recordingFormat({ isTypeSupported: type => type === 'video/mp4' }), 'video/mp4');
  assert.equal(recordingFormat({ isTypeSupported: type => type.startsWith('video/webm') }), 'video/webm;codecs=vp9');
  const date = new Date('2026-11-08T00:00:00Z');
  assert.equal(recordingName('Lounge & G1', 'video/webm;codecs=vp9', date), 'scene-graph-lounge-g1-2026-11-08.webm');
  assert.equal(recordingName(null, 'video/mp4', date), 'scene-graph-whole-lab-2026-11-08.mp4');
  assert.ok(!recordingName('../a/b', 'video/webm', date).includes('/'));
});

test('export fits the entire animation from a zoomed/panned camera without moving the viewer', () => {
  const camera = new THREE.PerspectiveCamera(44, .4, .1, 250);
  camera.position.set(-3, 16, 1);camera.lookAt(4, 12, -2);camera.updateMatrixWorld(true);
  const original = camera.clone();
  const nodes = [{ anchor: [-18, 0, -12], position: [-18, 12, -12] }, { anchor: [20, 2, 15], position: [20, 25, 15] }];
  const points = nodes.map(node => new THREE.Vector3(...node.position));
  const fitted = recordingCamera({ camera, fitPoints: points, model: { nodes } });
  for (const node of nodes) for (const key of ['anchor', 'position']) {
    const p = new THREE.Vector3(...node[key]).project(fitted);
    assert.ok(Math.abs(p.x) < .8 && Math.abs(p.y) < .78 && p.z > -1 && p.z < 1);
  }
  assert.deepEqual(camera.position, original.position);
  assert.deepEqual(camera.quaternion.toArray(), original.quaternion.toArray());
  assert.equal(camera.aspect, original.aspect);
  assert.ok(fitted.getWorldDirection(new THREE.Vector3()).distanceTo(camera.getWorldDirection(new THREE.Vector3())) < 1e-10);
});
