import * as THREE from 'three';
import { revealAt } from './scene-graph-model.js';

const WIDTH = 1920, HEIGHT = 1080, REPLAY_SECONDS = 5.2, HOLD_SECONDS = 2;

export function recordingFormat(Recorder = globalThis.MediaRecorder) {
  if (!Recorder) return null;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find(type => Recorder.isTypeSupported(type)) || null;
}

export function recordingName(label, type, date = new Date()) {
  const name = (label || 'whole-lab').normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'selection';
  return `scene-graph-${name.toLowerCase()}-${date.toISOString().slice(0, 10)}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}

/** Retain the viewing direction, but include every node, tether and scan bound. */
export function recordingCamera(view) {
  const camera = view.camera.clone();
  camera.aspect = WIDTH / HEIGHT;
  const points = [...view.fitPoints, ...view.model.nodes.map(node => new THREE.Vector3(...node.anchor))];
  const bounds = new THREE.Box3().setFromPoints(points), center = bounds.getCenter(new THREE.Vector3());
  const direction = camera.getWorldDirection(new THREE.Vector3()).negate();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanX = tanY * camera.aspect;
  const distance = Math.max(5, ...points.map(point => {
    const v = point.clone().sub(center);
    return v.dot(direction) + Math.max(Math.abs(v.dot(right)) / (tanX * .80), Math.abs(v.dot(up)) / (tanY * .78));
  }));
  camera.position.copy(center).addScaledVector(direction, distance + 1);
  camera.far = Math.max(camera.far, distance + bounds.getSize(new THREE.Vector3()).length() + 10);
  camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  return camera;
}

function nextFrame(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { cancelAnimationFrame(id); reject(signal.reason); };
    const id = requestAnimationFrame(now => { signal.removeEventListener('abort', abort); resolve(now); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
  });
}

/** Canvas streams omit HTML overlays, so paint the same node labels explicitly. */
function drawLabels(ctx, view, camera) {
  const point = new THREE.Vector3(), callouts = [], labels = [];
  for (const { node } of view.labelEntries) {
    const selected = view.selected?.id === node.id;
    if (revealAt(view.progress, node) <= .75 || (node.kind === 'object' && !view.ui.showLabels && !selected)) continue;
    point.copy(view.current.get(node.id)).project(camera);
    if (point.z < -1 || point.z > 1) continue;
    const size = node.kind === 'lab' ? 20 : node.kind === 'chamber' ? 17 : node.kind === 'area' ? 15 : 13;
    const font = `${node.kind === 'chamber' ? 600 : 400} ${size}px "Manrope Variable", sans-serif`;
    ctx.font = font;
    const width = Math.min(300, ctx.measureText(node.label).width + 22), height = size + 18;
    const x = (point.x + 1) * WIDTH / 2, y = (1 - point.y) * HEIGHT / 2;
    const entry = { node, selected, font, width, height, x, y,
      left: Math.max(12, Math.min(WIDTH - width - 12, x - width / 2)), top: y - height - 10 };
    if (node.kind === 'chamber' || node.kind === 'area') callouts.push(entry);
    else labels.push(entry);
  }
  const placed = [];
  for (const entry of callouts.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const candidates = [];
    for (let step = 0; step <= callouts.length; step++) candidates.push(entry.y - 10 - entry.height - step * (entry.height + 6), entry.y + 12 + step * (entry.height + 6));
    entry.top = candidates.find(y => y >= 12 && y + entry.height < HEIGHT - 12 && placed.every(box =>
      entry.left + entry.width + 6 <= box.left || entry.left >= box.left + box.width + 6 || y + entry.height + 6 <= box.top || y >= box.top + box.height + 6)) ?? entry.top;
    placed.push(entry);labels.push(entry);
  }
  // Draw the selected label last, just as its on-page z-index does.
  for (const label of labels.sort((a, b) => Number(a.selected) - Number(b.selected))) {
    const { node, selected, font, left, width, height, x, y } = label;
    const top = Math.max(12, Math.min(HEIGHT - height - 12, label.top));
    const tint = new THREE.Color(node.kind === 'object' ? view.model.byId.get(node.areaId).color : node.color).getStyle();
    if (node.kind === 'chamber' || node.kind === 'area') {
      ctx.strokeStyle = tint;ctx.globalAlpha = .6;ctx.beginPath();
      ctx.moveTo(x, y);ctx.lineTo(left + width / 2, top >= y ? top : top + height);ctx.stroke();ctx.globalAlpha = 1;
    }
    ctx.beginPath();ctx.roundRect(left, top, width, height, 5);
    ctx.fillStyle = selected ? '#e7cd91' : node.kind === 'chamber' ? '#102a3af5' : '#071725ee';ctx.fill();
    ctx.strokeStyle = selected ? '#e7cd91' : tint;ctx.lineWidth = 1;ctx.stroke();
    ctx.save();ctx.beginPath();ctx.rect(left + 8, top, width - 16, height);ctx.clip();
    ctx.font = font;ctx.textBaseline = 'middle';ctx.textAlign = 'center';
    ctx.fillStyle = selected ? '#102438' : node.kind === 'lab' ? '#f2dcac' : '#deebef';
    ctx.fillText(node.label, left + width / 2, top + height / 2);ctx.restore();
  }
}

/** Record the real WebGL scene without resizing or moving the user's viewport. */
export async function recordSceneGraph(view, { signal, onProgress }) {
  const mimeType = recordingFormat();
  if (!mimeType || !HTMLCanvasElement.prototype.captureStream) throw new Error('Animation download is unavailable in this browser. Please use a current Chrome, Edge, Firefox or Safari browser.');
  const renderer = view.viewer.renderer, camera = recordingCamera(view);
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT);
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const canvas = document.createElement('canvas');canvas.width = WIDTH;canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  const raw = document.createElement('canvas');raw.width = WIDTH;raw.height = HEIGHT;
  const rawCtx = raw.getContext('2d', { alpha: false });
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4), frame = new ImageData(new Uint8ClampedArray(pixels.buffer), WIDTH, HEIGHT);
  let stream, recorder, watchdog;
  const chunks = [], originalProgress = view.progress;
  const capture = progress => {
    view.progress = progress;view.updateGeometry();
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);renderer.render(view.scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
    } finally { renderer.setRenderTarget(previous); }
    rawCtx.putImageData(frame, 0, 0);
    ctx.save();ctx.translate(0, HEIGHT);ctx.scale(1, -1);ctx.drawImage(raw, 0, 0);ctx.restore();
    drawLabels(ctx, view, camera);
  };
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let rejectStopped;
  const abortRecording = () => rejectStopped?.(controller.signal.reason);
  controller.signal.addEventListener('abort', abortRecording, { once: true });
  try {
    controller.signal.throwIfAborted();
    await document.fonts.ready;
    controller.signal.throwIfAborted();
    capture(0);
    stream = canvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const stopped = new Promise((resolve, reject) => {
      rejectStopped = reject;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = resolve;
      recorder.onerror = event => { controller.abort(event.error || new Error('The browser could not encode the animation.')); };
    });
    // Attach immediately so cancellation during capture cannot leak a rejection.
    stopped.catch(() => {});
    watchdog = setTimeout(() => controller.abort(new Error('Animation recording timed out. Please try again.')), 30000);
    recorder.start();
    const start = performance.now(), duration = REPLAY_SECONDS + HOLD_SECONDS;
    let elapsed = 0;
    while (elapsed < duration) {
      const now = await nextFrame(controller.signal);
      controller.signal.throwIfAborted();
      elapsed = (now - start) / 1000;
      capture(Math.min(1, elapsed / REPLAY_SECONDS));
      onProgress(Math.min(1, elapsed / duration));
    }
    recorder.stop();await stopped;
    controller.signal.throwIfAborted();
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
    if (!blob.size) throw new Error('The browser produced an empty recording. Please try again.');
    return { blob, filename: recordingName(view.selected?.label, blob.type) };
  } finally {
    clearTimeout(watchdog);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', abortRecording);
    if (recorder?.state !== 'inactive' && recorder) recorder.stop();
    stream?.getTracks().forEach(track => track.stop());target.dispose();
    view.progress = originalProgress;
    if (!view.disposed) view.updateGeometry();
  }
}

export function saveRecording({ blob, filename }) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;link.download = filename;document.body.append(link);link.click();link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
