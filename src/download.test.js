import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadBytes } from './download.js';
const good = () => new Response(new Uint8Array([1, 2, 3, 4]));
test('stalled response headers time out and retry identical full bytes', async () => {
  let calls = 0; const retries = [];
  const result = await downloadBytes('/scan', { expectedBytes: 4, idleMs: 10,
    fetchImpl: () => ++calls === 1 ? new Promise(() => {}) : good(), onRetry: n => retries.push(n) });
  assert.deepEqual([...new Uint8Array(result)], [1,2,3,4]);
  assert.equal(calls,2); assert.deepEqual(retries,[2]);
});
test('mid-stream stall retries without double-counting downloaded progress', async () => {
  let calls = 0; const progress = [];
  const result = await downloadBytes('/scan', { expectedBytes: 4, idleMs: 10,
    fetchImpl: () => ++calls === 1 ? new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1,2])); } })) : good(),
    onProgress: n => progress.push(n) });
  assert.deepEqual([...new Uint8Array(result)], [1,2,3,4]);
  assert.deepEqual(progress,[2,4]);
});
test('truncated transfers retry and persistent stalls end with a recoverable error', async () => {
  let calls = 0;
  await assert.rejects(downloadBytes('/scan', { expectedBytes:4, idleMs:10,
    fetchImpl: () => { calls++; return new Response(new Uint8Array([1])); } }), /three attempts/);
  assert.equal(calls,3);
});
test('user cancellation stops a stalled request without another attempt', async () => {
  const abort = new AbortController(); let calls = 0;
  const loading = downloadBytes('/scan', { expectedBytes:4, signal:abort.signal,
    fetchImpl: () => { calls++; return new Promise(() => {}); } });
  abort.abort();
  await assert.rejects(loading,{name:'AbortError'}); assert.equal(calls,1);
});
