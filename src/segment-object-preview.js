import * as THREE from 'three';
import index from './segment-preview-index.json';
import { decodeObjectPreview, previewFrame } from './segment-preview-model.js';
import { getNovelView } from './object-novel-views.js';

/** One reusable, bounded turntable for both details panels. It renders only
 * this object's sampled mask, never another copy of the full lab cloud. */
export class SegmentObjectPreview {
  constructor(viewer) {
    this.viewer = viewer; this.cache = new Map(); this.gifCache = new Map(); this.generation = 0;
    this.root = document.createElement('figure'); this.root.className = 'segment-object-preview';
    this.root.setAttribute('aria-label', 'Rotating segmented object');
    this.stage = document.createElement('div'); this.stage.className = 'object-preview-stage';
    this.message = document.createElement('p'); this.message.className = 'object-preview-message';
    this.message.setAttribute('role', 'status'); this.stage.append(this.message);
    const caption = document.createElement('figcaption');
    this.label = document.createElement('span'); this.label.textContent = '360° scan';
    this.modes = document.createElement('div'); this.modes.className = 'object-preview-modes'; this.modes.hidden = true;
    this.modes.setAttribute('aria-label', 'Object preview type');
    this.scanButton = document.createElement('button'); this.scanButton.type = 'button'; this.scanButton.textContent = '3D scan';
    this.novelButton = document.createElement('button'); this.novelButton.type = 'button'; this.novelButton.textContent = 'Generated view';
    this.scanButton.onclick = () => { this.modeChosen = true; this.setMode('scan'); };
    this.novelButton.onclick = () => { this.modeChosen = true; this.setMode('novel'); };
    this.modes.append(this.novelButton, this.scanButton);
    this.gif = document.createElement('img'); this.gif.className = 'object-novel-view'; this.gif.hidden = true;
    this.gif.decoding = 'async'; this.stage.append(this.gif);
    this.pause = document.createElement('button'); this.pause.type = 'button';
    this.pause.onclick = () => {
      this.paused = !this.paused; this.updatePause();
      if (this.paused) this.stop(); else this.start();
    };
    caption.append(this.label, this.pause); this.root.append(this.modes, this.stage, caption);
    this.resizeObserver = new ResizeObserver(() => { this.resize(); this.draw(); });
    this.resizeObserver.observe(this.stage);
    this.intersection = new IntersectionObserver(entries => {
      // A panel rebuild can queue both hidden and visible entries together.
      // The final entry describes the current preview, not the first one.
      const entry = entries.at(-1);
      this.onscreen = Boolean(this.root.isConnected && entry?.isIntersecting && entry.intersectionRatio > 0);
      if (this.onscreen) this.start(); else this.stop();
    });
    this.visibility = () => { if (document.hidden) this.stop(); else this.start(); };
    document.addEventListener('visibilitychange', this.visibility);
    this.tick = now => {
      this.raf = 0;
      if (!this.canAnimate()) return;
      // Bound the tiny preview to 30 fps, independently of robot telemetry.
      if (!this.lastFrame || now - this.lastFrame >= 1000 / 30) {
        const elapsed = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, .1) : 0;
        this.pivot.rotation.y = (this.pivot.rotation.y + elapsed * Math.PI / 6) % (Math.PI * 2);
        this.draw(); this.lastFrame = now;
      }
      this.raf = requestAnimationFrame(this.tick);
    };
  }

  initRenderer() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x061522, 0);
    this.renderer.domElement.setAttribute('role', 'img');
    this.stage.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene(); this.pivot = new THREE.Group(); this.scene.add(this.pivot);
    this.camera = new THREE.PerspectiveCamera(36, 1, .01, 100);
    this.material = new THREE.ShaderMaterial({ vertexColors: true, toneMapped: false,
      uniforms: { pointSize: { value: 2.15 * this.renderer.getPixelRatio() } },
      vertexShader: `uniform float pointSize; varying vec3 rgb;
        void main(){rgb=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pointSize;}`,
      fragmentShader: `varying vec3 rgb;void main(){if(length(gl_PointCoord-.5)>.5)discard;gl_FragColor=vec4(rgb,1.);}` });
  }

  async show(title, object, layer) {
    this.hide(); if (this.disposed) return;
    const generation = this.generation;
    title.after(this.root); this.root.dataset.objectId = String(object.id);
    // Reusing the same element at the same position may not cross a visibility
    // threshold. A fresh observation guarantees a notification per selection.
    this.intersection.observe(this.root);
    this.root.dataset.state = 'loading'; this.root.setAttribute('aria-busy', 'true');
    this.message.textContent = 'Loading object…'; this.message.hidden = false;
    this.pause.disabled = true; this.paused = Boolean(this.viewer._reducedMotion); this.updatePause();
    this.object = object; this.entry = index.objects[String(object.id)]; this.modeChosen = false;
    this.setMode('scan');
    this.abort = new AbortController();
    try {
      if (index.segmentManifestSha256 !== layer.spec.sha256 || index.labSourceSha256 !== layer.spec.sourceSha256 || !this.entry) {
        throw new Error('This preview is not registered to the displayed scan.');
      }
      if (!this.entry.count) {
        this.root.dataset.state = 'empty'; this.message.textContent = 'No captured points remain for this object.'; return;
      }
      this.initRenderer();
      this.renderer.domElement.setAttribute('aria-label', `${object.label}, segmented 3D scan rotating around its vertical axis`);
      let geometry = this.cache.get(object.id);
      if (!geometry) {
        const response = await fetch(layer.localUrl(this.entry.url), { signal: this.abort.signal });
        if (!response.ok) throw new Error('Object preview could not be loaded.');
        const buffer = await response.arrayBuffer();
        if (generation !== this.generation || this.disposed) return;
        const data = decodeObjectPreview(buffer, this.entry, object.id);
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3, true));
        geometry.computeBoundingSphere();
      }
      this.cache.delete(object.id); this.cache.set(object.id, geometry);
      while (this.cache.size > 8) { const [id, old] = this.cache.entries().next().value; old.dispose(); this.cache.delete(id); }
      this.points = new THREE.Points(geometry, this.material);
      this.points.position.fromArray(this.entry.center).negate();
      this.pivot.add(this.points); this.pivot.rotation.set(0, -.35, 0);
      this.message.hidden = true; this.pause.disabled = false; this.root.dataset.state = 'ready';
      this.resize(); this.draw(); this.start();
      // The scan is immediately usable while the optional saved GIF loads.
      void this.loadNovelView(layer, object, generation);
    } catch (error) {
      if (generation !== this.generation || this.disposed || error.name === 'AbortError') return;
      this.root.dataset.state = 'error'; this.message.textContent = 'Preview unavailable. Select the object again to retry.';
      console.warn('[Object preview]', error);
    } finally {
      if (generation === this.generation) this.root.setAttribute('aria-busy', 'false');
    }
  }

  async loadNovelView(layer, object, generation) {
    try {
      const entry = await getNovelView(layer, object.id);
      if (!entry || generation !== this.generation || this.disposed) return;
      let blobUrl = this.gifCache.get(entry.url);
      if (!blobUrl) {
        const response = await fetch(layer.localUrl(entry.url), { signal: this.abort.signal });
        if (!response.ok) return;
        const blob = await response.blob();
        if (blob.size !== entry.bytes || generation !== this.generation || this.disposed) return;
        blobUrl = URL.createObjectURL(blob); this.gifCache.set(entry.url, blobUrl);
        while (this.gifCache.size > 4) {
          const [url, old] = this.gifCache.entries().next().value;
          URL.revokeObjectURL(old); this.gifCache.delete(url);
        }
      } else { this.gifCache.delete(entry.url); this.gifCache.set(entry.url, blobUrl); }
      this.novel = { ...entry, blobUrl, poster: layer.localUrl(entry.posterUrl) };
      this.gif.alt = `${object.label}: ${entry.arcDegrees}° photographic orbit${entry.representative ? ' of a matching item' : ''} from lab images and camera poses`;
      this.gif.onerror = () => {
        if (generation !== this.generation) return;
        this.novel = null; this.modes.hidden = true; this.setMode('scan');
      };
      this.modes.hidden = false;
      if (!this.modeChosen) this.setMode('novel');
    } catch (error) {
      // Missing, aborted or failed clips retain the working scan preview.
      if (error.name !== 'AbortError') console.warn('[Generated object view]', error);
    }
  }

  setMode(mode) {
    this.mode = mode === 'novel' && this.novel ? 'novel' : 'scan';
    this.root.dataset.mode = this.mode;
    this.scanButton.setAttribute('aria-pressed', String(this.mode === 'scan'));
    this.novelButton.setAttribute('aria-pressed', String(this.mode === 'novel'));
    this.gif.hidden = this.mode !== 'novel';
    if (this.renderer) this.renderer.domElement.hidden = this.mode === 'novel';
    this.label.textContent = this.mode === 'novel' ? `${this.novel.representative ? 'Matching item · ' : ''}${this.novel.arcDegrees}° orbit` : '360° scan';
    this.root.setAttribute('aria-label', this.mode === 'novel' ? 'Generated object preview' : 'Rotating segmented object');
    this.stop(); this.updatePause(); this.start(); this.draw();
  }

  syncGif() {
    if (!this.novel || this.mode !== 'novel') { this.gif.removeAttribute('src'); return; }
    const playing = !this.paused && this.onscreen && !document.hidden && this.root.isConnected;
    const source = playing ? this.novel.blobUrl : this.novel.poster;
    if (this.gif.getAttribute('src') !== source) this.gif.src = source;
  }

  updatePause() {
    this.pause.textContent = this.paused ? 'Play ↻' : 'Pause Ⅱ';
    const action = this.mode === 'novel' ? 'generated view' : 'object rotation';
    this.pause.setAttribute('aria-label', `${this.paused ? 'Play' : 'Pause'} ${action}`);
    this.pause.setAttribute('aria-pressed', String(this.paused));
  }

  resize() {
    if (!this.renderer || !this.entry || !this.root.isConnected) return;
    const width = this.stage.clientWidth, height = this.stage.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const fit = previewFrame(this.entry.bounds, this.camera.aspect, this.camera.fov);
    this.camera.near = fit.near; this.camera.far = fit.far; this.camera.updateProjectionMatrix();
    this.camera.position.set(.3, .18, 1).normalize().multiplyScalar(fit.distance); this.camera.lookAt(0, 0, 0);
  }

  draw() { if (this.mode !== 'novel' && this.renderer && this.points && this.root.isConnected && !document.hidden) this.renderer.render(this.scene, this.camera); }
  canAnimate() { return this.mode !== 'novel' && !this.disposed && !this.paused && this.onscreen && !document.hidden && this.points && this.root.isConnected; }
  start() { this.syncGif(); if (!this.raf && this.canAnimate()) { this.lastFrame = 0; this.raf = requestAnimationFrame(this.tick); } }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.lastFrame = 0; this.syncGif(); }
  hide() {
    this.intersection.disconnect(); this.intersection.takeRecords();
    this.generation++; this.abort?.abort(); this.novel = null; this.gif.onerror = null;
    this.gif.removeAttribute('src'); this.gif.hidden = true; this.modes.hidden = true;
    this.stop(); this.points?.removeFromParent(); this.points = null;
    this.renderer?.clear(); this.root.remove(); this.onscreen = false;
  }
  dispose() {
    this.hide(); this.disposed = true; this.resizeObserver.disconnect(); this.intersection.disconnect();
    document.removeEventListener('visibilitychange', this.visibility);
    for (const geometry of this.cache.values()) geometry.dispose(); this.cache.clear();
    for (const url of this.gifCache.values()) URL.revokeObjectURL(url); this.gifCache.clear();
    this.material?.dispose(); this.renderer?.dispose(); this.renderer?.forceContextLoss();
  }
}
