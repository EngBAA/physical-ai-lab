/** Packed RGB points copied from a single saved instance mask. */
export function decodeObjectPreview(buffer, entry, objectId) {
  if (buffer.byteLength < 16) throw new Error('Object preview is incomplete.');
  const header = new DataView(buffer), count = header.getUint32(8, true);
  if (header.getUint32(0, true) !== 0x504f424d || header.getUint32(4, true) !== 1 ||
      header.getUint32(12, true) !== objectId || count !== entry.count ||
      count > 80000 || buffer.byteLength !== 16 + count * 15 || buffer.byteLength !== entry.bytes) {
    throw new Error('Object preview does not match this selection.');
  }
  const positions = new Float32Array(buffer, 16, count * 3);
  if (positions.some(n => !Number.isFinite(n))) throw new Error('Object preview has invalid coordinates.');
  return { positions, colors: new Uint8Array(buffer, 16 + count * 12, count * 3) };
}

/** A sphere fit stays inside the viewport throughout the complete Y rotation. */
export function previewFrame(bounds, aspect, fov = 36) {
  const center = bounds.min.map((v, i) => (v + bounds.max[i]) / 2);
  const radius = Math.max(.001, Math.hypot(...bounds.max.map((v, i) => v - bounds.min[i])) / 2);
  const vertical = fov * Math.PI / 360;
  const halfAngle = Math.atan(Math.tan(vertical) * Math.min(1, Math.max(.1, aspect)));
  const distance = radius / Math.sin(halfAngle) * 1.12;
  return { center, radius, distance, near: Math.max(.0001, distance - radius * 1.5), far: distance + radius * 2 };
}
