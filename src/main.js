import { installCompanionHierarchy } from './companion-hierarchy.js';
import './styles.css';
import './inspector.css';
import './layout.css';
import { SegmentsViewer } from './viewer.js';
import { SegmentsUI } from './segments-ui.js';

const $ = id => document.getElementById(id);
const icons = {
  segments: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="m17.5 13 4.5 4.5-4.5 4.5-4.5-4.5Z"/>',
  graph: '<circle cx="12" cy="4" r="2"/><rect x="3" y="17" width="5" height="4" rx="1"/><rect x="16" y="17" width="5" height="4" rx="1"/><path d="M12 6v5M5.5 17v-6h13v6M12 11v6"/><circle cx="12" cy="19" r="2"/>',
  labels: '<path d="M3 3h9l9 9-9 9-9-9Z"/><circle cx="8" cy="8" r="1.3"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16"/>',
  sliders: '<path d="M4 21v-7m0-5V3m8 18v-9m0-5V3m8 18v-4m0-5V3M1 11h6m2-2h6m2 6h6"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
document.querySelectorAll('[data-icon]').forEach(node => {
  node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[node.dataset.icon]}</svg>`;
});
let viewer, ui, previousGraph;
function error(error) {
  console.error(error); $('loading').hidden = true; $('error-copy').textContent = error.message; $('error-state').hidden = false;
}
function notice(text) {
  $('toast').textContent = text; $('toast').hidden = false; clearTimeout(notice.timer); notice.timer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}
function syncState(graph) {
  if (!ui) return;
  if (previousGraph !== graph) {
    previousGraph = graph;
    $('graph-button').classList.toggle('active', graph); $('graph-button').setAttribute('aria-pressed', String(graph));
    $('cloud-button').classList.toggle('active', !graph); $('cloud-button').setAttribute('aria-pressed', String(!graph));
    $('labels-button').disabled = graph; $('settings-button').disabled = graph;
    $('view-name').textContent = graph ? 'SCENE GRAPH / LAB HIERARCHY' : 'ANNOTATED POINT CLOUD';
  }
  $('labels-button').setAttribute('aria-pressed', String(ui.showLabels));
  const map = graph ? ui.graph.mapInput.checked : viewer.robotMapSync?.group.visible;
  $('map-button').setAttribute('aria-pressed', String(Boolean(map)));
}
function toggleGraph() { if (!viewer?.loaded) return; if (ui.graph.active) ui.graph.close(); else void ui.graph.open(viewer._segments); }
function toggleSettings(show = $('settings-panel').hidden) { $('settings-panel').hidden = !show; $('settings-button').setAttribute('aria-expanded', String(show)); }

async function start() {
  try {
    viewer = new SegmentsViewer($('cloud-canvas'), {
      error, select: object => ui?.select(object), hover: (object, x, y) => ui?.hover(object, x, y), frame: () => ui?.positionLabel(), state: syncState,
      progress: value => { const percent = Math.round(value * 100); $('load-bar').style.width = `${percent}%`; $('load-percent').textContent = `${percent}%`; },
    });
    ui = new SegmentsUI(viewer);
    ui.graph.exit.textContent = 'Back to cloud ↗';
    ui.graph.mapInput.parentElement.title = 'Saved map snapshot aligned to the scan';
    await viewer.load(); ui.sync(viewer.displayState);
    $('loading').hidden = true;
    $('data-status').textContent = `${viewer._segments.manifest.pointCount.toLocaleString()} points · ${viewer._segments.objects.size} objects`;
    document.querySelectorAll('.tool-rail button').forEach(button => { button.disabled = false; });
    const layer = viewer._segments;
    $('download-annotations').href = layer.localUrl(layer.manifest.annotationsUrl);
    $('download-graph').href = new URL(layer.annotations.original_graph_url, $('download-annotations').href).href;
    $('download-manifest').href = layer.spec.url;
    window.__segments = { viewer, ui };
    installCompanionHierarchy(viewer, ui);
    if (location.hash === '#graph') await ui.graph.open(layer);
  } catch (reason) { error(reason); }
}
$('cloud-button').onclick = () => { ui?.graph.close(); };
$('graph-button').onclick = toggleGraph;
$('labels-button').onclick = () => ui?.toggleLabels();
$('map-button').onclick = () => {
  if (ui.graph.active) { ui.graph.mapInput.checked = !ui.graph.mapInput.checked; if (ui.graph.mapMesh) ui.graph.mapMesh.visible = ui.graph.mapInput.checked; }
  else viewer.robotMapSync.group.visible = !viewer.robotMapSync.group.visible;
};
$('fit-button').onclick = () => viewer?.fit();
$('settings-button').onclick = () => toggleSettings(); $('settings-close').onclick = () => toggleSettings(false);
$('point-size').oninput = event => { const value = Number(event.target.value); viewer._segments.material.uniforms.pointSize.value = 2.2 * value * viewer.renderer.getPixelRatio(); $('point-size-value').textContent = `${value.toFixed(1)}×`; };
$('fullscreen-button').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('app').requestFullscreen(); } catch { notice('Fullscreen is unavailable in this browser.'); } };
document.addEventListener('fullscreenchange', () => $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));
$('export-button').onclick = () => { $('export-menu').hidden = !$('export-menu').hidden; $('export-button').setAttribute('aria-expanded', String(!$('export-menu').hidden)); };
document.addEventListener('pointerdown', event => { if (!event.target.closest('#export-menu, #export-button')) { $('export-menu').hidden = true; $('export-button').setAttribute('aria-expanded', 'false'); } });
$('retry-button').onclick = () => location.reload();
window.addEventListener('keydown', event => {
  if (!viewer?.loaded || event.target.closest('input,textarea,select,button,a,[contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  if (event.key.toLowerCase() === 'g') toggleGraph();
  if (event.key.toLowerCase() === 'l' && !ui.graph.active) ui.toggleLabels();
  if (event.key.toLowerCase() === 'r') viewer.fit();
  if (event.key === 'Escape') { toggleSettings(false); $('export-menu').hidden = true; }
});
window.addEventListener('pagehide', () => viewer?.dispose(), { once: true });
void start();
