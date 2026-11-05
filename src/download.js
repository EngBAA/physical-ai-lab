/** Retry stalled transfers without changing the downloaded asset. */
export async function downloadBytes(url, { signal, expectedBytes, onProgress, onRetry,
  idleMs = 20000, attempts = 3, fetchImpl = fetch } = {}) {
  let highWater = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const cancelled = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) cancelled();
    let timer, reader;
    const timed = async (operation) => {
      let rejectAbort;
      const aborted = new Promise((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason || new DOMException('Cancelled', 'AbortError'));
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
        if (controller.signal.aborted) rejectAbort();
      });
      timer = setTimeout(() => controller.abort(new DOMException('The download stopped responding.', 'TimeoutError')), idleMs);
      try { return await Promise.race([operation(), aborted]); }
      finally { clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAbort); }
    };
    try {
      const response = await timed(() => fetchImpl(url, { signal: controller.signal, cache: attempt === 1 ? 'default' : 'reload' }));
      if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
      const bytes = new Uint8Array(expectedBytes);
      let length = 0;
      const append = (value) => {
        if (length + value.byteLength > expectedBytes) throw new Error('The downloaded file exceeds its declared size.');
        bytes.set(value, length); length += value.byteLength;
        highWater = Math.max(highWater, length);
        onProgress?.(highWater);
      };
      if (response.body?.getReader) {
        reader = response.body.getReader();
        while (true) {
          const { done, value } = await timed(() => reader.read());
          if (done) break;
          append(value);
        }
      } else append(new Uint8Array(await timed(() => response.arrayBuffer())));
      if (length !== expectedBytes) throw new Error('The downloaded file is incomplete.');
      return bytes.buffer;
    } catch (error) {
      controller.abort(error);
      reader?.cancel().catch(() => {});
      if (signal?.aborted) throw signal.reason || error;
      if (attempt === attempts) throw new Error('The download stopped responding after three attempts. Please check your connection and retry.');
      onRetry?.(attempt + 1, attempts);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
    }
  }
}
