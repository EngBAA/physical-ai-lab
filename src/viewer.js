import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SegmentsLayer, segmentsSpec } from './segments-layer.js';
import { assetUrl } from './asset-url.js';

/** The complete segment renderer, with its own camera and no parent app. */
export class SegmentsViewer {
  constructor(canvas, callbacks) {
    this.canvas = canvas; this.callbacks = callbacks; this._temp = new THREE.Vector3();
    this._reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#081b2d');
    this.camera = new THREE.PerspectiveCamera(44, 1, .05, 500);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = .08;
    this.controls.minDistance = .4; this.controls.maxDistance = 180;
    this.controls.maxPolarAngle = Math.PI * .49;
    this.camera.position.set(-36, 25, 35); this.controls.target.set(0, 1, 0); this.controls.update();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas);
    this.last = performance.now();
    this.renderer.setAnimationLoop(now => {
      const dt = Math.min(.1, (now - this.last) / 1000); this.last = now;
      const graph = this._sceneGraph?.active;
      this.controls.enabled = !graph;
      if (graph) this._sceneGraph.render(dt);
      else { this.controls.update(); this.renderer.render(this.scene, this.camera); this.callbacks.frame?.(); }
      this.callbacks.state?.(graph);
    });
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this._emit('onError', new Error('The 3D graphics context was interrupted. Reload the explorer to recover.')); });
  }

  _emit(name, error) { if (name === 'onError') this.callbacks.error(error); }
  _clearInput() { this.controls.enabled = false; }
  setMode() { this.controls.enabled = !this._sceneGraph?.active; }
  get displayState() { return { mode: 'segments', segmentPointCount: this._segments?.manifest?.pointCount, segmentObjectCount: this._segments?.objects.size }; }

  async load() {
    const base = assetUrl('/data/metadata.json', location.href);
    const response = await fetch(base); if (!response.ok) throw new Error('The bundled lab metadata could not be loaded.');
    this.metadata = await response.json();
    const grid = this.metadata.walkability;
    const gridResponse = await fetch(assetUrl(grid.url, base));
    if (!gridResponse.ok) throw new Error('The saved floor connectivity could not be loaded.');
    const cells = new Uint8Array(await gridResponse.arrayBuffer());
    if (cells.length !== grid.width * grid.height) throw new Error('The saved floor grid is incomplete.');
    this._grid = { ...grid, origin: grid.originXZ || grid.origin, cells };
    this._segments = new SegmentsLayer({ viewer: this, spec: segmentsSpec(this.metadata, base),
      onProgress: this.callbacks.progress, onSelect: this.callbacks.select,
      onHover: (object, x, y) => this.callbacks.hover(object, x, y) });
    await this._segments.load(); this._segments.setVisible(true);
    await this.loadSavedMap();
    this.loaded = true; this.fit();
  }

  async loadSavedMap() {
    const spec = this.metadata.savedMap;
    const response = await fetch(assetUrl(spec.alignmentUrl, location.href)); if (!response.ok) throw new Error('The saved map alignment could not be loaded.');
    const alignment = await response.json(), transform = this.metadata.transform;
    if (alignment.scanSha256 !== this.metadata.sourceProvenance.sha256 ||
        transform.sourceCenterXY.some((v, i) => Math.abs(v - alignment.sourceToViewer.sourceCenterXY[i]) > 1e-6) ||
        Math.abs(transform.sourceFloorZ - alignment.sourceToViewer.sourceFloorZ) > 1e-6) throw new Error('The saved map belongs to another scan.');
    const { yawRadians: a, translationMetres: t } = alignment.mapToSource;
    const { width, height, resolution, origin } = alignment.map;
    const corner = (u, v) => {
      const x = u * resolution, y = (height - v) * resolution, r = origin[2];
      const mx = origin[0] + Math.cos(r) * x - Math.sin(r) * y;
      const my = origin[1] + Math.sin(r) * x + Math.cos(r) * y;
      return [Math.cos(a) * mx - Math.sin(a) * my + t[0] - transform.sourceCenterXY[0], .035,
        transform.sourceCenterXY[1] - (Math.sin(a) * mx + Math.cos(a) * my + t[1])];
    };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([corner(0, 0), corner(width, 0), corner(width, height), corner(0, height)].flat(), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geometry.setIndex([0, 3, 2, 0, 2, 1]); geometry.computeVertexNormals();
    const texture = await new THREE.TextureLoader().loadAsync(assetUrl(spec.overlayUrl, location.href).href); texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: .55 });
    const group = new THREE.Group(); group.add(new THREE.Mesh(geometry, material)); group.visible = false; this.scene.add(group);
    // SceneGraphView's existing map adapter accepts a static snapshot. No
    // live state is supplied, so it never presents a fabricated robot pose.
    this.robotMapSync = { alignment, group, state: null };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    this.renderer.setSize(rect.width, rect.height, false); this.camera.aspect = rect.width / rect.height; this.camera.updateProjectionMatrix();
  }

  fit() {
    if (this._sceneGraph?.active) { this._sceneGraph.resize(true); return; }
    if (!this._segments?.loaded) return;
    const bounds = new THREE.Box3();
    for (const { spec } of this._segments.chunks) {
      if (spec.overlap) continue;
      bounds.expandByPoint(new THREE.Vector3(...spec.bounds.min)); bounds.expandByPoint(new THREE.Vector3(...spec.bounds.max));
    }
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const halfAngle = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.min(1, this.camera.aspect));
    const distance = sphere.radius / Math.sin(halfAngle) * 1.03;
    this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = true;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(-.8, .72, .8).normalize(), distance);
    this.controls.update();
  }

  dispose() {
    this.renderer.setAnimationLoop(null); this.resizeObserver.disconnect(); this.controls.dispose(); this._sceneGraph?.dispose(); this._segments?.dispose();
    this.robotMapSync?.group.traverse(node => { node.geometry?.dispose(); node.material?.map?.dispose(); node.material?.dispose(); });
    this.renderer.dispose();
  }
}
