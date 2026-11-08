import { objectAnimation } from './animated-webp.js';

const fontUrl = new URL('../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2', import.meta.url).href;

const dataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();reader.onload = () => resolve(reader.result);reader.onerror = () => reject(reader.error);reader.readAsDataURL(blob);
});

function copyPanel(source) {
  const clone = source.cloneNode(false), style = getComputedStyle(source);
  for (const property of style) clone.style.setProperty(property, style.getPropertyValue(property));
  clone.style.setProperty('transition', 'none');clone.style.setProperty('animation', 'none');
  // Images and WebGL canvases are composited separately on every video frame.
  if (source.matches('img,canvas')) { clone.style.visibility = 'hidden';clone.removeAttribute('src');return clone; }
  for (const child of source.childNodes) {
    if (child.nodeType !== Node.ELEMENT_NODE) { clone.append(child.cloneNode());continue; }
    const copied = copyPanel(child);
    if (source.scrollTop) copied.style.transform = `translateY(${-source.scrollTop}px) ${copied.style.transform === 'none' ? '' : copied.style.transform}`;
    clone.append(copied);
  }
  return clone;
}

/** Rasterize the actual visible details, retaining wrapping, expanded sections
 * and scroll offsets. Keep the live preview separate so it remains animated. */
export async function prepareDetailPanel(view, signal) {
  if (!view.selected || view.detail.hidden) return null;
  const panel = view.detail, rect = panel.getBoundingClientRect();
  const preview = view.ui.preview, hasPreview = panel.contains(preview.root);
  const mode = preview.mode, paused = preview.paused, angle = preview.pivot?.rotation.y;
  const scanReady = mode === 'scan' && preview.points && Number.isFinite(angle);
  const stage = hasPreview ? preview.stage.getBoundingClientRect() : null;
  const clip = stage ? { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom } : null;
  if (clip) for (let node = preview.stage.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node === panel || /(hidden|auto|scroll|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
      const box = node.getBoundingClientRect();
      clip.left = Math.max(clip.left, box.left + node.clientLeft);clip.top = Math.max(clip.top, box.top + node.clientTop);
      clip.right = Math.min(clip.right, box.left + node.clientLeft + node.clientWidth);clip.bottom = Math.min(clip.bottom, box.top + node.clientTop + node.clientHeight);
    }
    if (node === panel) break;
  }
  const cloned = copyPanel(panel);
  Object.assign(cloned.style, { position: 'relative', inset: 'auto', top: '0px', left: '0px', margin: '0px',
    width: `${rect.width}px`, height: `${rect.height}px`, maxHeight: 'none', overflow: 'hidden', transform: 'none',
    background: '#0a2032', boxShadow: 'none', backdropFilter: 'none' });
  cloned.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  let animation, poster;
  try {
    const fontResponse = await fetch(fontUrl, { signal });
    if (!fontResponse.ok) throw new Error('The panel font could not be loaded for the download.');
    const font = await dataUrl(await fontResponse.blob());signal.throwIfAborted();
    const fontStyle = document.createElement('style');
    fontStyle.textContent = `@font-face{font-family:'Manrope Variable';font-style:normal;font-weight:200 800;src:url('${font}') format('woff2')}`;
    cloned.prepend(fontStyle);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(cloned)}</foreignObject></svg>`;
    const image = new Image();image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;await image.decode();signal.throwIfAborted();
    if (stage && mode === 'novel' && preview.novel) {
      if (paused) { poster = new Image();poster.src = preview.novel.poster;await poster.decode(); }
      else animation = await objectAnimation(preview.novel.blobUrl, signal);
    }
    signal.throwIfAborted();
    return {
      width: rect.width, height: rect.height,
      async draw(ctx, x, y, scale, seconds) {
        signal.throwIfAborted();
        let source;
        if (animation) source = await animation.frame(seconds);
        else if (poster) source = poster;
        else if (stage && scanReady && preview.points && !preview.disposed) {
          // Render explicitly: a WebGL canvas may have cleared its drawing buffer
          // after its regular RAF, and the modal may obscure the live preview.
          const current = preview.pivot.rotation.y;
          try {
            preview.pivot.rotation.y = angle + (paused ? 0 : seconds * Math.PI / 6);
            preview.renderer.render(preview.scene, preview.camera);
            source = preview.renderer.domElement;
          } finally { preview.pivot.rotation.y = current; }
        }
        ctx.save();ctx.translate(x, y);ctx.scale(scale, scale);ctx.drawImage(image, 0, 0);
        if (source && clip.right > clip.left && clip.bottom > clip.top) {
          ctx.beginPath();ctx.rect(clip.left - rect.left, clip.top - rect.top, clip.right - clip.left, clip.bottom - clip.top);ctx.clip();
          ctx.drawImage(source, stage.left - rect.left, stage.top - rect.top, stage.width, stage.height);
        }
        ctx.restore();
      },
      dispose() { animation?.dispose(); },
    };
  } catch (error) { animation?.dispose();throw error; }
}
