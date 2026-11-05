import * as THREE from 'three';
import { downloadBytes } from './download.js';
import { assetUrl } from './asset-url.js';

export function segmentsSpec(metadata, baseUrl) {
  const entry = metadata.segments;
  if (!entry) return null;
  const base = new URL(baseUrl), url = assetUrl(entry.url, base);
  if (url.origin !== base.origin || !/^https?:$/.test(url.protocol) ||
      !/^[a-f0-9]{64}$/i.test(entry.sourceSha256 || '') ||
      entry.coordinateFrame !== 'viewer-y-up' || entry.sourceSha256 !== metadata.sourceProvenance?.sha256 ||
      !Number.isSafeInteger(entry.pointCount) || entry.pointCount < 1) {
    throw new Error('The segmented cloud is not registered to this lab.');
  }
  return { ...entry, url: url.href, viewerTransform: metadata.transform };
}

export function decodeSegmentChunk(buffer, count) {
  const h = new DataView(buffer);
  const colorOffset = 32 + count * 12, idOffset = (colorOffset + count * 3 + 3) & ~3;
  if (buffer.byteLength !== idOffset + count * 2 ||
      h.getUint32(0, true) !== 0x4753424d || h.getUint32(4, true) !== 1 ||
      h.getUint32(8, true) !== count || h.getUint32(12, true) !== 32 ||
      h.getUint32(16, true) !== colorOffset || h.getUint32(20, true) !== idOffset) {
    throw new Error('A segmented point-cloud chunk is incomplete.');
  }
  return { positions: new Float32Array(buffer, 32, count * 3),
    colors: new Uint8Array(buffer, colorOffset, count * 3), ids: new Uint16Array(buffer, idOffset, count) };
}

export function pickSegmentId(pixels, objects) {
  let selected = 0, distance = Infinity;
  const side = Math.sqrt(pixels.length / 4), middle = (side - 1) / 2;
  for (let i = 0; i < side * side; i++) {
    const id = pixels[i * 4] + 256 * pixels[i * 4 + 1];
    const d = (i % side - middle) ** 2 + (Math.floor(i / side) - middle) ** 2;
    if (objects.has(id) && d < distance) { selected = id; distance = d; }
  }
  return selected;
}

// Edited geometry retains the original annotations and records every removal
// and inferred point separately; a different count must never pass silently.
export function segmentCountsMatch(m, annotations) {
  const valid = n => Number.isSafeInteger(n) && n >= 0;
  if (!valid(m.pointCount) || !valid(m.overlapCount) ||
      !m.chunks.every(c => valid(c.count)) || m.chunks.reduce((n, c) => n + c.count, 0) !== m.pointCount ||
      m.overlaps.count !== m.overlapCount) return false;
  if (!m.edit) return m.allSourcePointsRetained && annotations.display_point_count === m.pointCount;
  const e = m.edit;
  return e.type === 'captured-realman-removal' &&
    [m.sourcePointCount, m.sourceOverlapCount, e.removedPointCount, e.removedOverlapCount, e.inferredPointCount].every(valid) &&
    annotations.display_point_count === m.sourcePointCount &&
    e.removedPointCount <= m.sourcePointCount && e.removedOverlapCount <= m.sourceOverlapCount &&
    m.pointCount === m.sourcePointCount - e.removedPointCount + e.inferredPointCount &&
    m.overlapCount === m.sourceOverlapCount - e.removedOverlapCount;
}

const vertexShader = `
attribute float instanceId;
uniform sampler2D palette;
uniform float paletteSize, selectedId, pointSize, colourMix;
uniform bool isolate, backgroundVisible;
varying vec3 vColor;
varying float vId, vVisible;
void main() {
  vId = instanceId;
  bool selected = selectedId > 0.5 && abs(instanceId-selectedId) < 0.1;
  vVisible = ((!backgroundVisible && instanceId < 0.5) || (isolate && !selected)) ? 0.0 : 1.0;
  vec3 segment = texture2D(palette, vec2((instanceId+0.5)/paletteSize, 0.5)).rgb;
  vColor = mix(color, segment, colourMix * step(0.5, instanceId));
  if (selectedId > 0.5 && !selected) vColor *= 0.42;
  if (selected) vColor = mix(color, vec3(1.0, 0.87, 0.45), 0.45);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = pointSize * (selected ? 1.3 : 1.0) * clamp(5.0 / max(0.1, -mv.z), 0.8, 2.0);
  if (vVisible < 0.5) gl_Position = vec4(2.0,2.0,2.0,1.0);
}`;
const fragmentShader = `
uniform bool picking;
varying vec3 vColor;
varying float vId, vVisible;
void main() {
  if (vVisible < 0.5 || length(gl_PointCoord-0.5) > 0.5) discard;
  gl_FragColor = picking ? vec4(mod(vId,256.0)/255.0, floor(vId/256.0)/255.0, 0.0, 1.0) : vec4(vColor,1.0);
}`;

export class SegmentsLayer {
  constructor({ viewer, spec, onProgress, onSelect, onHover }) {
    Object.assign(this, { viewer, spec, onProgress, onSelect, onHover });
    this.renderer = viewer.renderer;
    this.root = new THREE.Group(); this.root.name = 'Registered complete segmented lab'; this.root.visible = false;
    this.box = new THREE.Box3Helper(new THREE.Box3(), 0xf2d59a); this.box.visible = false;
    this.root.add(this.box);
    viewer.scene.add(this.root);
    this.pickScene = new THREE.Scene(); this.pickScene.background = new THREE.Color(0);
    this.target = new THREE.WebGLRenderTarget(5, 5, { depthBuffer: true, stencilBuffer: false });
    this.pickCamera = viewer.camera.clone();
    this.abort = new AbortController(); this.chunks = []; this.objects = new Map(); this.selectedId = 0;
    this._listeners = []; this._hoverToken = 0; this.stats = { picks: 0, lastPickMs: 0, loadedBytes: 0 };
    const canvas = viewer.canvas;
    const listen = (name, fn) => { canvas.addEventListener(name, fn); this._listeners.push(() => canvas.removeEventListener(name, fn)); };
    listen('pointerdown', e => { if (e.button === 0 && !this.viewer._sceneGraph?.active) { this.down = [e.clientX, e.clientY]; this._hoverToken++; clearTimeout(this.hoverTimer); } });
    listen('pointerup', e => {
      if (this.root.visible && this.down && Math.hypot(e.clientX-this.down[0], e.clientY-this.down[1]) < 5) {
        this.pick(e.clientX, e.clientY).then(id => { if (this.root.visible && id !== null) this.select(id); }).catch(e => this.viewer._emit('onError', e));
      }
      this.down = null;
    });
    listen('pointercancel', () => { this.down = null; });
    listen('pointermove', e => {
      clearTimeout(this.hoverTimer); const token = this._hoverToken = (this._hoverToken || 0) + 1;
      if (!this.root.visible || this.down || e.buttons || this.viewer._sceneGraph?.active) return;
      this.hoverTimer = setTimeout(async () => {
        try {
          const id = await this.pick(e.clientX, e.clientY);
          if (token === this._hoverToken && this.root.visible) this.onHover?.(this.objects.get(id), e.clientX, e.clientY);
        } catch { this.onHover?.(null); }
      }, 100);
    });
    listen('pointerleave', () => { clearTimeout(this.hoverTimer); this._hoverToken++; this.onHover?.(null); });
  }

  localUrl(path) {
    const url = assetUrl(path, this.spec.url);
    if (url.origin !== new URL(this.spec.url).origin || !/^https?:$/.test(url.protocol)) throw new Error('An annotation asset is not local to the viewer.');
    return url.href;
  }

  load() {
    if (!this._promise) this._promise = this._load().catch(error => { this._promise = null; this.clearGeometry(); throw error; });
    return this._promise;
  }

  async _load() {
    const started = performance.now(); this._progress = 0;
    const fetchJSON = async url => {
      const r = await fetch(url, { signal: this.abort.signal });
      if (!r.ok) throw new Error('The segmented lab could not be downloaded.');
      return r.json();
    };
    this.manifest = await fetchJSON(this.spec.url);
    const m = this.manifest;
    if (m.version !== 1 || m.coordinateFrame !== 'viewer-y-up' || m.registration.labScanSha256 !== this.spec.sourceSha256 ||
        m.pointCount !== this.spec.pointCount ||
        m.chunks.reduce((n, c) => n + c.count, 0) !== m.pointCount) throw new Error('Segment registration or point totals do not match this lab.');
    const { sourceCenterXY: [cx, cy], sourceFloorZ: floor, scale } = this.spec.viewerTransform;
    const composed = new THREE.Matrix4().set(1,0,0,-cx, 0,0,1,-floor, 0,-1,0,cy, 0,0,0,1)
      .multiply(new THREE.Matrix4().set(...m.registration.sourceToScan.flat()));
    const saved = new THREE.Matrix4().set(...m.registration.sourceToViewer.flat());
    if (scale !== 1 || composed.elements.some((v, i) => Math.abs(v - saved.elements[i]) > 1e-6)) {
      throw new Error('The segmented cloud uses a different viewer coordinate transform.');
    }
    this.annotations = await fetchJSON(this.localUrl(m.annotationsUrl));
    if (!segmentCountsMatch(m, this.annotations)) throw new Error('Segment annotations do not match the geometry.');
    this.objects = new Map(this.annotations.objects.map(o => [o.id, o]));
    const paletteSize = Math.max(...this.objects.keys()) + 1;
    const palette = new Uint8Array(paletteSize * 4); palette.set([120, 137, 151, 255]);
    for (const o of this.objects.values()) palette.set([...o.color.map(v => Math.round(v * 255)), 255], o.id * 4);
    this.palette = new THREE.DataTexture(palette, paletteSize, 1, THREE.RGBAFormat); this.palette.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, vertexColors: true, toneMapped: false,
      uniforms: { palette: { value: this.palette }, paletteSize: { value: paletteSize },
        selectedId: { value: 0 }, pointSize: { value: 2.2 * this.renderer.getPixelRatio() }, colourMix: { value: 1 },
        isolate: { value: false }, backgroundVisible: { value: true }, picking: { value: false } } });
    this.pickMaterial = new THREE.ShaderMaterial({ vertexShader, fragmentShader, vertexColors: true,
      uniforms: { ...this.material.uniforms, picking: { value: true } },
      blending: THREE.NoBlending, toneMapped: false, dithering: false });
    // Shared GPU geometry; picking never scans millions of points on the CPU.
    const specs = [...m.chunks, { ...m.overlaps, overlap: true }];
    let next = 0, completed = 0;
    const progress = new Map();
    const worker = async () => {
      while (next < specs.length) {
        const spec = specs[next++];
        const buffer = await downloadBytes(this.localUrl(spec.url), { expectedBytes: spec.bytes, signal: this.abort.signal,
          onProgress: bytes => {
            progress.set(spec.url, bytes);
            this.stats.loadedBytes = [...progress.values()].reduce((a, b) => a + b, 0);
            this._progress = .98 * this.stats.loadedBytes / m.totalBytes; this.onProgress?.(this._progress);
          } });
        if (this.disposed) return;
        this.addChunk(buffer, spec); completed++;
        // Give rendering and live telemetry a frame between bounded GPU uploads.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    };
    const results = await Promise.allSettled([worker(), worker(), worker()]);
    const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
    if (this.disposed) return;
    if (completed !== specs.length) throw new Error('The complete segmented cloud has not loaded.');
    this.loaded = true; this._progress = 1; this.stats.loadMs = performance.now() - started;
    this.onProgress?.(1);
    return this;
  }

  addChunk(buffer, spec) {
    const data = decodeSegmentChunk(buffer, spec.count), geometry = new THREE.BufferGeometry();
    for (const [name, array, size, normalized] of [['position', data.positions, 3, false], ['color', data.colors, 3, true], ['instanceId', data.ids, 1, false]]) {
      const attribute = new THREE.BufferAttribute(array, size, normalized);
      attribute.onUpload(function () { this.array = null; });
      geometry.setAttribute(name, attribute);
    }
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...spec.bounds.min), new THREE.Vector3(...spec.bounds.max));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const points = new THREE.Points(geometry, this.material);
    const pickPoints = new THREE.Points(geometry, this.pickMaterial);
    const upload = new THREE.Scene(); upload.add(points); points.frustumCulled = false; geometry.setDrawRange(0, 0);
    const previous = this.renderer.getRenderTarget();
    try { this.renderer.setRenderTarget(this.target); this.renderer.render(upload, this.viewer.camera); }
    finally { this.renderer.setRenderTarget(previous); upload.remove(points); }
    points.frustumCulled = true;
    geometry.setDrawRange(0, spec.overlap ? 0 : spec.count);
    this.root.add(points); this.pickScene.add(pickPoints);
    this.chunks.push({ points, pickPoints, spec });
    if (spec.overlap) this.overlap = points;
  }

  setVisible(visible) {
    this.root.visible = Boolean(visible && this.loaded);
    if (!visible) { clearTimeout(this.hoverTimer); this._hoverToken++; this.onHover?.(null); }
  }

  select(id) {
    this._hoverToken++; clearTimeout(this.hoverTimer);
    this.selectedId = this.objects.has(id) ? id : 0;
    this.material.uniforms.selectedId.value = this.selectedId;
    if (!this.selectedId) this.material.uniforms.isolate.value = false;
    const range = this.manifest.overlaps.ranges[String(this.selectedId)];
    this.overlap.geometry.setDrawRange(range?.start || 0, range?.count || 0);
    const entry = this.manifest.objects[String(this.selectedId)];
    this.box.visible = Boolean(entry);
    if (entry) this.box.box.set(new THREE.Vector3(...entry.bounds.min), new THREE.Vector3(...entry.bounds.max));
    this.onSelect?.(this.objects.get(this.selectedId) || null);
  }

  async pick(clientX, clientY) {
    if (!this.loaded || !this.root.visible || this.disposed || this.viewer._sceneGraph?.active) return null;
    if (this._pickPromise) await this._pickPromise;
    if (!this.root.visible || this.disposed) return null;
    const operation = this._pick(clientX, clientY);
    this._pickPromise = operation;
    try { return await operation; } finally { if (this._pickPromise === operation) this._pickPromise = null; }
  }

  async _pick(clientX, clientY) {
    const start = performance.now(), r = this.renderer, rect = this.viewer.canvas.getBoundingClientRect();
    const ratio = r.getPixelRatio(), width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
    const camera = this.pickCamera; camera.copy(this.viewer.camera); camera.updateMatrixWorld(true);
    camera.setViewOffset(width, height, (clientX - rect.left) * ratio - 2, (clientY - rect.top) * ratio - 2, 5, 5);
    const previous = r.getRenderTarget(); const pixels = new Uint8Array(100);
    let read;
    try {
      r.setRenderTarget(this.target); r.clear(); r.render(this.pickScene, camera);
      read = r.readRenderTargetPixelsAsync(this.target, 0, 0, 5, 5, pixels);
    } finally { r.setRenderTarget(previous); }
    await read;
    this.stats.lastPickMs = performance.now() - start; this.stats.picks++;
    return pickSegmentId(pixels, this.objects);
  }

  clearGeometry() {
    for (const c of this.chunks) c.points.geometry.dispose();
    this.chunks = []; this.root.clear(); this.root.add(this.box); this.box.visible = false; this.pickScene.clear();
    this.material?.dispose(); this.pickMaterial?.dispose(); this.palette?.dispose(); this.loaded = false;
  }

  dispose() {
    this.disposed = true; this.abort.abort(); clearTimeout(this.hoverTimer);
    this._listeners.forEach(fn => fn()); this.clearGeometry(); this.root.removeFromParent(); this.target.dispose();
    this.box.geometry.dispose(); this.box.material.dispose();
  }
}
