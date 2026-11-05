// Only reviewed, saved clips are served. No model runs in the browser.
const PATH = '/data/object-novel-views-20261031/index.json';
let request, loadedAt = 0;

export function registeredNovelView(manifest, spec, id) {
  if (manifest?.version !== 1 || manifest.segmentManifestSha256 !== spec.sha256 ||
      manifest.labSourceSha256 !== spec.sourceSha256) return null;
  const item = manifest.objects?.[String(id)];
  if (item?.status !== 'reviewed' || item.inputKind !== 'photographs' || item.id !== Number(id) ||
      !Number.isFinite(item.arcDegrees) || item.arcDegrees <= 0 || item.arcDegrees > 90 ||
      !Number.isInteger(item.bytes) || item.bytes <= 0 || item.bytes > 12 * 1024 * 1024 ||
      !/^\/data\/object-novel-views-20261031\/[\w-]+\.(?:gif|webp)$/.test(item.url) ||
      !/^\/data\/object-novel-views-20261031\/[\w-]+\.webp$/.test(item.posterUrl)) return null;
  return item;
}

export async function getNovelView(layer, id) {
  if (!request || Date.now() - loadedAt > 60000) {
    loadedAt = Date.now();
    request = fetch(layer.localUrl(PATH), { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).catch(() => null);
  }
  return registeredNovelView(await request, layer.spec, id);
}
