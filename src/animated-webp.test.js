import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webpFrames } from './animated-webp.js';

test('the reported sidetable preview preserves all frame timings and image payloads', async () => {
  const bytes = fs.readFileSync(new URL('../public/data/object-novel-views-20261031/81-6f1ee0d23c66a5c7-animated.webp', import.meta.url));
  const animation = webpFrames(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(animation.width, 512);assert.equal(animation.height, 320);assert.equal(animation.frames.length, 48);
  let previous = 0;
  for (const frame of animation.frames) {
    assert.ok(frame.end > previous);previous = frame.end;
    const data = new Uint8Array(await frame.blob.arrayBuffer());
    assert.equal(new TextDecoder().decode(data.subarray(0, 4)), 'RIFF');
    assert.equal(new DataView(data.buffer).getUint32(4, true), data.length - 8);
    assert.ok(frame.width <= 512 && frame.height <= 320);
  }
  assert.equal(animation.duration, previous);
  assert.throws(() => webpFrames(new ArrayBuffer(0)), /valid WebP/);
  assert.throws(() => webpFrames(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + 100)), /incomplete/);
});
