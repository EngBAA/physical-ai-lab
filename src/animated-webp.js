// Split the bundled animated WebP into browser-decodable still frames. Drawing
// an animated <img> onto a canvas otherwise captures only its first frame.
// Container: https://developers.google.com/speed/webp/docs/riff_container
export function webpFrames(buffer) {
  const bytes = new Uint8Array(buffer), data = new DataView(buffer);
  const tag = at => String.fromCharCode(...bytes.subarray(at, at + 4));
  const u24 = at => bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16;
  if (bytes.length < 30 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') throw new Error('The object animation is not a valid WebP file.');
  let width, height, duration = 0, background = [0, 0, 0, 0];
  const frames = [];
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = data.getUint32(at + 4, true), start = at + 8, end = start + size;
    if (end > bytes.length) throw new Error('The object animation is incomplete.');
    if (tag(at) === 'VP8X' && size >= 10) { width = u24(start + 4) + 1; height = u24(start + 7) + 1; }
    if (tag(at) === 'ANIM' && size >= 6) background = [bytes[start + 2], bytes[start + 1], bytes[start], bytes[start + 3] / 255];
    if (tag(at) === 'ANMF' && size >= 24) {
      const w = u24(start + 6) + 1, h = u24(start + 9) + 1;
      // Include VP8X for frames containing a separate alpha chunk.
      const body = bytes.subarray(start + 16, end), header = new Uint8Array(30);
      header.set(new TextEncoder().encode('RIFF'), 0);
      new DataView(header.buffer).setUint32(4, 22 + body.length, true);
      header.set(new TextEncoder().encode('WEBPVP8X'), 8);header[16] = 10;header[20] = 0x10;
      for (let i = 0; i < 3; i++) { header[24 + i] = (w - 1) >> (i * 8) & 255; header[27 + i] = (h - 1) >> (i * 8) & 255; }
      duration += Math.max(10, u24(start + 12));
      frames.push({ x: u24(start) * 2, y: u24(start + 3) * 2, width: w, height: h,
        end: duration, dispose: Boolean(bytes[start + 15] & 1), blend: !(bytes[start + 15] & 2),
        blob: new Blob([header, body], { type: 'image/webp' }) });
    }
    at = end + (size & 1);
  }
  if (!width || !height || !frames.length || frames.some(f => f.x + f.width > width || f.y + f.height > height)) throw new Error('The object animation has invalid frames.');
  return { width, height, frames, duration, background };
}

export async function objectAnimation(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('The object animation could not be loaded for the download.');
  const animation = webpFrames(await response.arrayBuffer());
  const canvas = document.createElement('canvas');canvas.width = animation.width;canvas.height = animation.height;
  const ctx = canvas.getContext('2d'), cache = new Map();
  let index = -1, loop = -1;
  const clear = (x = 0, y = 0, w = canvas.width, h = canvas.height) => {
    ctx.clearRect(x, y, w, h);ctx.fillStyle = `rgba(${animation.background.join(',')})`;ctx.fillRect(x, y, w, h);
  };
  return {
    async frame(seconds) {
      signal.throwIfAborted();
      const ms = Math.max(0, seconds * 1000), cycle = Math.floor(ms / animation.duration), time = ms % animation.duration;
      if (cycle !== loop) { clear();index = -1;loop = cycle; }
      const next = animation.frames.findIndex(f => f.end > time);
      for (let i = index + 1; i <= next; i++) {
        const previous = animation.frames[i - 1], frame = animation.frames[i];
        if (previous?.dispose) clear(previous.x, previous.y, previous.width, previous.height);
        if (!frame.blend) ctx.clearRect(frame.x, frame.y, frame.width, frame.height);
        let bitmap = cache.get(i);
        if (!bitmap) {
          bitmap = await createImageBitmap(frame.blob);
          if (signal.aborted) { bitmap.close();signal.throwIfAborted(); }
          cache.set(i, bitmap);
          // Bound decoded memory independently of the source animation length.
          if (cache.size > 4) { const [key, old] = cache.entries().next().value;old.close();cache.delete(key); }
        }
        ctx.drawImage(bitmap, frame.x, frame.y);index = i;
      }
      return canvas;
    },
    dispose() { for (const bitmap of cache.values()) bitmap.close();cache.clear();canvas.width = canvas.height = 1; },
  };
}
