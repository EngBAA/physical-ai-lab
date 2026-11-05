import test from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl } from './asset-url.js';

test('saved assets resolve at both the site root and a GitHub project prefix', () => {
  const base = 'https://engbaa.github.io/physical-ai-lab/data/segments/manifest.json';
  for (const value of ['/data/cloud.bin', 'https://engbaa.github.io/data/cloud.bin']) {
    assert.equal(assetUrl(value, base, '/physical-ai-lab/').href,
      'https://engbaa.github.io/physical-ai-lab/data/cloud.bin');
  }
  assert.equal(assetUrl('chunk.bin', base, '/physical-ai-lab/').href,
    'https://engbaa.github.io/physical-ai-lab/data/segments/chunk.bin');
  assert.equal(assetUrl('/physical-ai-lab/data/cloud.bin', base, '/physical-ai-lab/').href,
    'https://engbaa.github.io/physical-ai-lab/data/cloud.bin');
  assert.equal(assetUrl('/data/cloud.bin', 'http://localhost:4175/', '/').href,
    'http://localhost:4175/data/cloud.bin');
  assert.equal(assetUrl('https://external.test/data/cloud.bin', base, '/physical-ai-lab/').href,
    'https://external.test/data/cloud.bin');
});
