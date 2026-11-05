import { SceneGraphView } from './scene-graph-view.js';
import { SegmentObjectPreview } from './segment-object-preview.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action, className) {
  const b = element('button', text, className); b.type = 'button'; b.addEventListener('click', action); return b;
}
function swatch(object) {
  const s = element('span', '', 'segment-swatch');
  s.style.background = `rgb(${object.color.map(v => Math.round(v * 255)).join(',')})`; return s;
}

/** Text-only imported annotations: ZIP contents never become executable HTML. */
export class SegmentsUI {
  constructor(viewer) {
    this.viewer = viewer;
    this.root = element('aside', undefined, 'segment-panel glass'); this.root.id = 'segment-panel';
    this.root.setAttribute('aria-label', 'Segmented lab objects'); this.root.hidden = true;
    const header = element('div', undefined, 'segment-panel-heading');
    this.toggle = button('Objects', () => {
      if (this.graph?.active) { this.graph.close(); this.body.hidden = false; this.toggle.setAttribute('aria-expanded', 'true'); return; }
      this.body.hidden = !this.body.hidden; this.toggle.setAttribute('aria-expanded', String(!this.body.hidden));
    }); this.toggle.setAttribute('aria-expanded', 'true');
    this.count = button('', () => this.toggleLabels(), 'segment-count'); this.count.id = 'segment-label-toggle';
    this.count.setAttribute('aria-pressed', 'false'); this.count.setAttribute('aria-controls', 'segment-world-labels');
    this.count.title = 'Show all object labels';
    this.graphButton = button('Scene graph', () => {
      if (this.graph.active) this.graph.close(); else if (this.layer) this.graph.open(this.layer);
    }, 'segment-count segment-graph-button');
    this.graphButton.id = 'segment-graph-toggle'; this.graphButton.setAttribute('aria-pressed', 'false');
    this.graphButton.setAttribute('aria-controls', 'scene-graph-ui');
    this.graphButton.title = 'Open the animated 3D lab scene graph';
    header.append(this.toggle, this.count, this.graphButton);
    this.body = element('div', undefined, 'segment-body');
    this.root.append(header, this.body);
    document.getElementById('viewer-ui').append(this.root);
    this.tip = element('div', '', 'segment-tooltip'); this.tip.id = 'segment-tooltip'; this.tip.hidden = true;
    this.tip.setAttribute('role', 'tooltip'); document.body.append(this.tip);
    this.tag = button('', () => { this.body.hidden = false; this.toggle.setAttribute('aria-expanded', 'true'); }, 'segment-world-label');
    this.tag.hidden = true; document.getElementById('viewer-ui').append(this.tag);
    this.labels = element('div', undefined, 'segment-world-labels'); this.labels.id = 'segment-world-labels';
    this.labels.setAttribute('role', 'group'); this.labels.setAttribute('aria-label', 'Object labels');
    this.labels.hidden = true; document.getElementById('viewer-ui').append(this.labels);
    this.showLabels = false; this.labelEntries = []; this.projected = viewer._temp.clone();
    this.visible = false;
    this.preview = new SegmentObjectPreview(viewer);
    this.graph = new SceneGraphView(viewer, this);
  }

  sync(state) {
    this.visible = state.mode === 'segments'; this.root.hidden = !this.visible;
    this.labels.hidden = !this.visible || !this.showLabels;
    if (!this.visible) { this.graph.close(); this.preview.hide(); this.tip.hidden = true; this.tag.hidden = true; return; }
    this.layer = this.viewer._segments;
    if (this.layer && this.layer !== this.installed) {
      this.installed = this.layer; this.count.textContent = `${this.layer.objects.size} labels`;
      this.installLabels();
      this.catalog();
    }
    this.labelFrame = null; this.positionLabel();
    if (this.selected && !this.graph.active && !this.preview.root.isConnected) this.restorePreview();
  }

  installLabels() {
    this.labels.replaceChildren(); this.labelEntries = [];
    const fragment = document.createDocumentFragment();
    for (const object of this.layer.objects.values()) {
      const entry = this.layer.manifest.objects[String(object.id)]; if (!entry) continue;
      const anchor = this.viewer._temp.clone().fromArray(entry.centroid); anchor.y = entry.bounds.max[1] + .08;
      const node = button(object.label, () => this.layer.select(object.id), 'segment-world-label segment-object-label');
      node.dataset.objectId = object.id; node.title = `${object.label} · Click for details`;
      node.setAttribute('aria-label', `Inspect ${object.label}, ${object.node_id}`);
      node.style.setProperty('--label-color', `rgb(${object.color.map(v => Math.round(v*255)).join(',')})`);
      node.hidden = true; fragment.append(node); this.labelEntries.push({ node, anchor, id: object.id });
    }
    this.labels.append(fragment); this.labelFrame = null;
  }

  toggleLabels() {
    this.showLabels = !this.showLabels;
    this.count.setAttribute('aria-pressed', String(this.showLabels));
    this.count.title = this.showLabels ? 'Hide all object labels' : 'Show all object labels';
    this.labels.hidden = !this.visible || !this.showLabels || this.graph.active;
    this.labelFrame = null; this.positionLabel();
  }

  catalog() {
    const layer = this.layer; if (!layer) return;
    this.body.replaceChildren();
    const edited = Boolean(layer.manifest.edit);
    this.body.append(element('p', `${layer.manifest.pointCount.toLocaleString()} points · ${edited ? 'Captured robot removed · Floor repaired' : 'Complete supplied cloud'}`, 'segment-summary'),
      element('p', 'Show all labels with the button above. Click a label or coloured object for details, or search below.', 'segment-help'));
    const controls = element('div', undefined, 'segment-options');
    const check = (text, value, action) => {
      const label = element('label'); const input = element('input'); input.type = 'checkbox'; input.checked = value;
      input.onchange = () => action(input.checked); label.append(input, document.createTextNode(text)); controls.append(label);
    };
    check('Segment colours', Boolean(layer.material.uniforms.colourMix.value), value => { layer.material.uniforms.colourMix.value = value ? 1 : 0; });
    check('Unlabelled background', layer.material.uniforms.backgroundVisible.value, value => { layer.material.uniforms.backgroundVisible.value = value; });
    const search = element('input'); search.type = 'search'; search.placeholder = 'Find an object or capability…'; search.id = 'segment-search';
    search.setAttribute('aria-label', 'Search segmented objects');
    const results = element('div', undefined, 'segment-object-list'); results.id = 'segment-object-list';
    const render = () => {
      const query = search.value.trim().toLowerCase(); const fragment = document.createDocumentFragment();
      for (const object of layer.objects.values()) {
        if (query && ![object.label, object.node_id, object.description, ...(object.affordances || [])].join(' ').toLowerCase().includes(query)) continue;
        const row = button('', () => layer.select(object.id), 'segment-object-row'); row.dataset.objectId = object.id;
        row.setAttribute('aria-label', `Inspect ${object.label}, ${object.node_id}`);
        const name = element('span'); name.append(element('strong', object.label), element('small', `${object.type} · ${object.node_id}`));
        row.append(swatch(object), name); fragment.append(row);
      }
      results.replaceChildren(fragment);
      if (!results.childElementCount) results.append(element('p', 'No matching objects.', 'segment-help'));
    };
    search.addEventListener('input', render); render();
    const quality = element('details'); quality.append(element('summary', 'Annotation coverage'));
    const q = layer.annotations.quality;
    quality.append(element('p', `Original annotations: ${q.labeled_point_count.toLocaleString()} labelled points; ${q.unlabeled_point_count.toLocaleString()} background points. ${q.descriptions_missing} entries have no saved description.`, 'segment-help'));
    if (edited) quality.append(element('p', 'The captured RealMan has been removed from the displayed points and overlapping masks. The exposed floor is inferred from neighbouring wood. Original annotations are preserved.', 'segment-help'));
    const original = element('a', 'Download original annotations'); original.href = layer.localUrl(layer.manifest.annotationsUrl);
    original.download = 'lab-original-annotations.json'; quality.append(original);
    this.body.append(controls, search, results, quality);
  }

  select(object) {
    this.preview.hide();
    this.tip.hidden = true; this.selected = object;
    this.labelFrame = null;
    if (!object) { this.tag.hidden = true; this.catalog(); this.positionLabel(); return; }
    const layer = this.viewer._segments; this.layer = layer;
    this.body.hidden = false; this.toggle.setAttribute('aria-expanded', 'true'); this.body.replaceChildren();
    const actions = element('div', undefined, 'segment-actions');
    actions.append(button('← All objects', () => layer.select(0)), button('Focus', () => this.focus(object.id)));
    const isolate = button('Isolate', () => {
      layer.material.uniforms.isolate.value = !layer.material.uniforms.isolate.value;
      isolate.setAttribute('aria-pressed', String(layer.material.uniforms.isolate.value));
      isolate.textContent = layer.material.uniforms.isolate.value ? 'Show lab' : 'Isolate';
    }); isolate.setAttribute('aria-pressed', String(layer.material.uniforms.isolate.value));
    isolate.textContent = layer.material.uniforms.isolate.value ? 'Show lab' : 'Isolate'; actions.append(isolate);
    const title = element('h2'); title.append(swatch(object), document.createTextNode(object.label));
    const description = element('p', object.description || 'No description saved in the supplied annotations.', 'segment-description');
    description.id = 'segment-description';
    this.body.append(actions, title, element('p', `${object.type} · ${object.node_id} · Instance ${object.id}`, 'segment-summary'),
      element('h3', 'Saved description'), description, element('h3', 'Capabilities / affordances'));
    this.preview.show(title, object, layer);
    const chips = element('div', undefined, 'segment-chips');
    for (const text of object.affordances || []) chips.append(element('span', text));
    if (!chips.childElementCount) chips.append(element('p', 'No affordances saved.', 'segment-help'));
    this.body.append(chips);
    const facts = element('dl', undefined, 'segment-facts');
    const dims = object.bbox_max.map((v, i) => (v - object.bbox_min[i]).toFixed(2));
    for (const [key, value] of [['Segment points', object.point_count.toLocaleString()], ['Dimensions (m)', dims.join(' × ')],
      ['Original centroid (m)', object.centroid.map(v => v.toFixed(3)).join(' / ')],
      ['Overlapping membership points', object.overlap_display_point_count.toLocaleString()]]) {
      facts.append(element('dt', key), element('dd', value));
    }
    this.body.append(element('h3', 'Geometry'), facts);
    const overlaps = layer.annotations.review_pairs.filter(p => p.left_id === object.id || p.right_id === object.id);
    if (object.review_flags.length || overlaps.length || object.attributes?.annotation_status === 'automatic_unreviewed') {
      const review = element('details'); review.append(element('summary', 'Saved annotation review notes'));
      review.append(element('p', [...object.review_flags, object.attributes?.annotation_status].filter(Boolean).join(' · '), 'segment-help'));
      for (const pair of overlaps) {
        const other = pair.left_id === object.id ? pair.right_id : pair.left_id;
        review.append(button(`${layer.objects.get(other)?.label || other} · ${pair.shared_points.toLocaleString()} shared points`, () => layer.select(other), 'segment-relation'));
      }
      this.body.append(review);
    }
    const relations = element('details'); relations.append(element('summary', `Relationships (${object.relations.length})`));
    for (const relation of object.relations) {
      const b = button(`${relation.direction === 'in' ? '←' : '→'} ${relation.label || relation.type} · ${relation.target_label}`,
        () => layer.select(relation.target_id), 'segment-relation'); b.disabled = !layer.objects.has(relation.target_id); relations.append(b);
    }
    this.body.append(relations);
    // The whole source entry is accessible, including custom attributes and provenance.
    const complete = element('details'); complete.id = 'segment-complete'; complete.append(element('summary', 'Complete saved annotation'));
    complete.append(element('pre', JSON.stringify(object, null, 2)));
    complete.append(button('Download annotation JSON', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' }));
      const a = element('a'); a.href = url; a.download = `lab-${object.node_id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    this.body.append(complete); this.body.scrollTop = 0;
    this.tag.textContent = object.label; this.tag.setAttribute('aria-label', `Open details for ${object.label}`);
    this.positionLabel();
  }

  restorePreview() {
    const title = this.body.querySelector('h2');
    if (this.visible && this.selected && title) this.preview.show(title, this.selected, this.layer);
  }

  hover(object, x, y) {
    this.tip.hidden = !this.visible || !object || this.graph.active;
    if (this.tip.hidden) return;
    this.tip.textContent = `${object.label} · Click for details`;
    this.tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - 290))}px`;
    this.tip.style.top = `${Math.min(y + 14, innerHeight - 50)}px`;
  }

  focus(id) {
    const entry = this.layer.manifest.objects[String(id)], v = this.viewer;
    if (!entry) return;
    // Move only the inspection camera. The live robot and map retain their positions.
    const center = v._temp.clone().fromArray(entry.centroid);
    const extent = Math.hypot(...entry.bounds.max.map((n, i) => n - entry.bounds.min[i]));
    const distance = Math.max(2.3, extent * 1.7);
    v.setMode('third'); v._follow = false;
    const direction = v.camera.position.clone().sub(v.controls.target).normalize();
    v.controls.target.copy(center); v.camera.position.copy(center).addScaledVector(direction, distance); v.controls.update();
  }

  positionLabel() {
    if (this.graph.active) { this.labels.hidden = true; this.tag.hidden = true; return; }
    if (!this.visible) { this.tag.hidden = true; return; }
    const v = this.viewer, rect = v.canvas.getBoundingClientRect();
    const overlay = this.root.parentElement.getBoundingClientRect();
    const offsetX = rect.left - overlay.left, offsetY = rect.top - overlay.top;
    if (this.showLabels) {
      this.tag.hidden = true;
      const isolate = this.layer.material.uniforms.isolate.value, selectedId = this.layer.selectedId;
      // Projection/DOM updates happen only when the camera, viewport or selection
      // changes. The button reuses all 248 labels and makes no network requests.
      const frame = [...v.camera.matrixWorldInverse.elements, ...v.camera.projectionMatrix.elements,
        rect.width, rect.height, offsetX, offsetY, isolate, selectedId];
      if (this.labelFrame && frame.every((n, i) => n === this.labelFrame[i])) return;
      this.labelFrame = frame;
      for (const {node, anchor, id} of this.labelEntries) {
        const p = this.projected.copy(anchor).project(v.camera);
        node.hidden = (isolate && id !== selectedId) || p.z < -1 || p.z > 1 || Math.abs(p.x) > .99 || Math.abs(p.y) > .99;
        node.setAttribute('aria-pressed', String(id === selectedId));
        if (!node.hidden) node.style.transform = `translate3d(${offsetX+(p.x+1)*rect.width/2}px,${offsetY+(1-p.y)*rect.height/2}px,0) translate(-50%,-100%)`;
      }
      return;
    }
    if (!this.selected) { this.tag.hidden = true; return; }
    const entry = this.layer.manifest.objects[String(this.selected.id)];
    const p = this.projected.fromArray(entry.centroid); p.y = entry.bounds.max[1] + .08;
    p.project(this.viewer.camera);
    this.tag.hidden = p.z < -1 || p.z > 1 || Math.abs(p.x) > .95 || Math.abs(p.y) > .95;
    if (!this.tag.hidden) {
      this.tag.style.left = `${offsetX+(p.x + 1) * rect.width / 2}px`; this.tag.style.top = `${offsetY+(1 - p.y) * rect.height / 2}px`;
    }
  }
}
