const $ = (id) => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let map, floorImage, chamberLabelBoxes = [], mapLabelBoxes = [], nodes = [], aliases = {}, snapshot, selectedId = null, inspected = null;
let socket, retryTimer, shouldReconnect = false, receivedAt = 0, pairedToken = '', endpoint = '';
let lastRendered = '', poseTarget = null, poseFrom = null, poseChanged = 0;
const view = {yaw: 0, zoom: 1, panX: 0, panY: 0, top: true};
let width = 0, height = 0, scale = 1, center = [0, 0];

const label = (name) => String(name || '').replaceAll('_', ' ');
const fresh = () => socket?.readyState === WebSocket.OPEN && performance.now() - receivedAt < 2500;
const turns = () => snapshot?.turns || [];
const selectedTurn = () => turns().find(t => t.id === selectedId) || turns().at(-1);
const mappedNodes = () => nodes.filter(n => n.map === map?.name);
function resolve(names = []) {
  const expanded = new Set(names.flatMap(name => [name, ...(aliases[name] || [])]));
  return mappedNodes().filter(n => expanded.has(n.name) || expanded.has(n.id));
}
function connectedText(text, live = false) {
  $('connection-status').textContent = text;
  $('connection-dot').classList.toggle('live', live);
}
function errorText(text) { $('connection-error').textContent = text; }
function disconnect() {
  shouldReconnect = false;
  clearTimeout(retryTimer);
  if (socket) { socket.onclose = null; socket.close(); }
  socket = null;
  connectedText('Offline');
  updateStatus();
}
function connect(url, token) {
  disconnect();
  const parsed = new URL(url);
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Use a ws:// or wss:// address ending in /ws, without a query or password.');
  }
  if (location.protocol === 'https:' && parsed.protocol !== 'wss:') {
    throw new Error('This HTTPS page needs a secure wss:// connection. You can also open the dashboard directly on the robot’s network.');
  }
  if (parsed.pathname !== '/ws') throw new Error('The dashboard endpoint must end in /ws.');
  endpoint = parsed.href; pairedToken = token;
  try { localStorage.setItem('masar-dashboard-endpoint', endpoint); } catch { /* private browser */ }
  shouldReconnect = true;
  openSocket();
}
function openSocket() {
  if (!shouldReconnect) return;
  connectedText('Connecting');
  const ws = socket = new WebSocket(endpoint);
  let authenticated = false;
  ws.onopen = () => ws.send(JSON.stringify({token: pairedToken}));
  ws.onmessage = (event) => {
    if (ws !== socket) return;
    try {
      const data = JSON.parse(event.data);
      if (data.type !== 'snapshot' || !Array.isArray(data.turns)) return;
      const previousNewest = turns().at(-1)?.id;
      const followedLatest = !selectedId || selectedId === previousNewest;
      snapshot = data; receivedAt = performance.now();
      if (data.scene) { nodes = data.scene.nodes || []; aliases = data.scene.aliases || {}; }
      if (followedLatest || !turns().some(t => t.id === selectedId)) selectedId = turns().at(-1)?.id || null;
      if (previousNewest !== turns().at(-1)?.id && followedLatest) inspected = null;
      if (!authenticated) {
        authenticated = true; errorText(''); $('connection-dialog').close();
        $('open-connection').firstChild.textContent = 'Connected ';
      }
      if (data.pose && data.pose.at !== poseTarget?.at) {
        poseFrom = poseTarget && Math.hypot(poseTarget.x - data.pose.x, poseTarget.y - data.pose.y) < 1.5 ? displayPose() : data.pose;
        poseTarget = data.pose; poseChanged = performance.now();
      } else if (!data.pose) { poseTarget = poseFrom = null; }
      renderConversation(); updateStatus();
    } catch { connectedText('Invalid robot data'); }
  };
  ws.onclose = (event) => {
    if (ws !== socket) return;
    connectedText('Disconnected'); updateStatus();
    $('open-connection').firstChild.textContent = 'Connect robot ';
    if (event.code === 1008) {
      shouldReconnect = false;
      errorText('Connection refused. Check the access token.');
      $('connection-dialog').showModal();
    } else if (shouldReconnect) {
      errorText('Cannot reach the dashboard. Check its address and your robot network connection.');
      retryTimer = setTimeout(openSocket, 3000);
    }
  };
  ws.onerror = () => errorText('Cannot reach the dashboard. Check the address, network, and HTTPS certificate.');
}
function updateStatus() {
  const online = fresh(), state = snapshot?.status;
  if (online) connectedText(state?.agent === 'ready' ? 'Live' : 'Agent reconnecting', state?.agent === 'ready');
  else if (socket?.readyState === WebSocket.OPEN) connectedText('Updates paused');
  const mic = online ? state?.microphone : 'unknown';
  $('mic-status').textContent = ({unmuted: 'Microphone on', muted_or_off: 'Microphone muted', unavailable: 'Microphone unavailable'})[mic] || 'Robot microphone';
  $('mic-status').parentElement.classList.toggle('listening', mic === 'unmuted');
  const speaking = online && state?.speaker;
  $('speaker-status').classList.toggle('playing', !!speaking);
  $('speaker-status').lastElementChild.textContent = speaking ? 'Speaking' : 'Robot speaker';
  const pose = snapshot?.pose;
  const sameMap = pose?.map === map?.name;
  const age = pose ? pose.age + (performance.now() - receivedAt) / 1000 : Infinity;
  const valid = online && sameMap && age <= 3 && !pose.stale;
  const position = pose && sameMap ? `${pose.x.toFixed(2)}, ${pose.y.toFixed(2)} m` : '';
  $('pose-status').textContent = !pose ? (snapshot?.pose_reason || 'Waiting for localization')
    : !sameMap ? 'Robot is on a different map'
    : `${valid ? 'Live position' : 'Last known position'} · ${position}${pose.map_source === 'configuration' ? ' · configured map' : ''}`;
  canvas.dataset.localized = valid ? 'true' : 'false';
  const working = online && state?.agent === 'ready' && ['thinking', 'answering'].includes(selectedTurn()?.state);
  $('thinking').hidden = !working;
}
function renderConversation() {
  const turn = selectedTurn(), list = turns(), index = list.indexOf(turn);
  $('turn-count').textContent = turn ? `${index + 1} / ${list.length}` : '—';
  $('previous').disabled = index <= 0;
  $('next').disabled = index < 0 || index >= list.length - 1;
  const key = JSON.stringify(turn);
  if (key === lastRendered) return;
  lastRendered = key;
  $('question').textContent = turn?.question || (turn ? 'Receiving your question…' : 'Waiting for a question…');
  $('question').classList.toggle('placeholder', !turn?.question);
  $('question-time').textContent = turn ? new Date(turn.at * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
  $('answer').textContent = turn?.answer || (turn ? 'Masar is working on your question…' : 'Listening starts on Masar’s microphone.');
  $('answer').classList.toggle('placeholder', !turn?.answer);
  const endLabels = {interrupted: 'Interrupted by the visitor', failed: 'Could not complete this request',
    disconnected: 'Connection interrupted', expired: 'Question expired', discarded: 'Question cancelled', 'not understood': 'Please ask again'};
  $('turn-status').textContent = endLabels[turn?.state] || '';
  if (turn && !turn.answer && endLabels[turn.state]) $('answer').textContent = 'No answer received.';
  $('steps').replaceChildren();
  for (const step of turn?.steps || []) {
    const li = document.createElement('li'); li.className = step.kind;
    const title = document.createElement('span'); title.textContent = step.label; li.append(title);
    if (step.nodes?.length) {
      const chips = document.createElement('div'); chips.className = 'nodes';
      for (const name of step.nodes) {
        const button = document.createElement('button'); button.className = 'node-chip'; button.textContent = label(name);
        const targets = resolve([name]); button.disabled = !targets.length;
        button.title = targets.length ? 'Highlight on map' : 'No registered map position';
        button.onclick = () => { inspected = [name]; };
        chips.append(button);
      }
      li.append(chips);
    }
    $('steps').append(li);
  }
  if (!$('steps').children.length) {
    const li = document.createElement('li'); li.className = 'empty-step';
    li.textContent = turn ? 'Waiting for robot activity…' : 'Searches and routes will appear here.';
    $('steps').append(li);
  }
}

// Orthographic projection in the chassis map frame; theta is radians from +X.
function project(x, y, z = 0) {
  const dx = x - center[0], dy = y - center[1], c = Math.cos(view.yaw), s = Math.sin(view.yaw);
  return [width / 2 + (dx * c - dy * s) * scale + view.panX,
    height / 2 + 20 - (dx * s + dy * c) * scale * (view.top ? 1 : .58) - z * scale + view.panY];
}
function polygon(points, z = 0) {
  points.forEach(([x, y], i) => { const p = project(x, y, z); i ? ctx.lineTo(...p) : ctx.moveTo(...p); });
  ctx.closePath();
}
function line(a, b, color, weight = 1) {
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.stroke();
}
function dot(p, radius, fill, stroke) {
  ctx.beginPath(); ctx.arc(...p, radius, 0, Math.PI * 2);
  if (fill) {ctx.fillStyle = fill; ctx.fill();}
  if (stroke) {ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();}
}
function pill(text, p, color = '#e8c481', background = '#142f3c') {
  ctx.font = '11px Arial'; const w = ctx.measureText(text).width + 18, h = 24;
  const options = [0, -30, 32, -60, 62].map(dy => [p[0] - w / 2, p[1] - h + dy, w, h]);
  const box = options.find(a => !mapLabelBoxes.some(b => a[0] < b[0] + b[2] + 3 && a[0] + a[2] + 3 > b[0] &&
                                                       a[1] < b[1] + b[3] + 3 && a[1] + a[3] + 3 > b[1])) || options[0];
  mapLabelBoxes.push(box);
  const [x,y] = box;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fillStyle = background; ctx.fill();
  ctx.strokeStyle = color + '55'; ctx.lineWidth = .8; ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = color; ctx.fillText(text, x + 9, y + 16);
  return box;
}
function displayPose() {
  if (!poseTarget) return null;
  const t = reducedMotion ? 1 : Math.min(1, (performance.now() - poseChanged) / 170);
  const from = poseFrom || poseTarget;
  const angle = Math.atan2(Math.sin(poseTarget.theta - from.theta), Math.cos(poseTarget.theta - from.theta));
  return {...poseTarget, x: from.x + (poseTarget.x - from.x) * t,
    y: from.y + (poseTarget.y - from.y) * t, theta: from.theta + angle * t};
}
function floorBoundary() { return map.plan?.frame || map.floor[0]; }
function planYaw() { return map?.plan?.yaw || 0; }
function containsPoint(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [px, py] = ring[j];
    if ((y > point.y) !== (py > point.y) && point.x < (px - x) * (point.y - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}
function drawFloorPlan() {
  const frame = floorBoundary();
  ctx.beginPath(); polygon(frame);
  ctx.fillStyle = '#081820';
  ctx.shadowColor = '#0006'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
  ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.save(); ctx.beginPath(); polygon(frame); ctx.clip();
  // The selected gold floor image is registered back into the chassis frame.
  // Its original pixels are reused; there is no point-cloud download.
  if (floorImage && map.plan?.scan) {
    const scan = map.plan.scan;
    const [a, b, c] = scan.corners.map(p => project(...p));
    const [left, top, w, h] = scan.crop;
    ctx.save();
    ctx.transform((b[0] - a[0]) / w, (b[1] - a[1]) / w,
                  (c[0] - a[0]) / h, (c[1] - a[1]) / h, a[0], a[1]);
    ctx.globalAlpha = .88;
    ctx.drawImage(floorImage, left, top, w, h, 0, 0, w, h);
    ctx.restore();
  }
  const targets = resolve(inspected || selectedTurn()?.targets);
  for (const chamber of map.plan?.chambers || []) {
    const selected = targets.some(n => chamber.outlines.some(r => containsPoint(n, r)));
    ctx.beginPath(); chamber.outlines.forEach(r => polygon(r));
    ctx.fillStyle = selected ? '#b6d7c614' : '#b6d7c604'; ctx.fill();
    ctx.strokeStyle = '#061722'; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = selected ? '#d6ecd7' : '#b6ccc3bb'; ctx.lineWidth = selected ? 2 : 1.25; ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath(); polygon(frame); ctx.strokeStyle = '#c9b07999'; ctx.lineWidth = 1.25; ctx.stroke();
  chamberLabelBoxes = [];
  for (const chamber of map.plan?.chambers || []) {
    const p = project(...chamber.anchor);
    const size = width < 500 ? 10 : 12;
    ctx.font = `600 ${size}px Arial`;
    const name = chamber.label.toUpperCase(), w = ctx.measureText(name).width + 18;
    const box = [p[0] - w / 2, p[1] - 11, w, 24];
    chamberLabelBoxes.push(box);
    ctx.fillStyle = '#091e29ef'; ctx.fillRect(...box);
    ctx.strokeStyle = '#b6d7c638'; ctx.lineWidth = .6; ctx.strokeRect(...box);
    ctx.fillStyle = '#e3e6d5'; ctx.textAlign = 'center'; ctx.fillText(name, p[0], p[1] + 5);
  }
}
function draw(now) {
  requestAnimationFrame(draw);
  if (document.hidden || !map) return;
  ctx.clearRect(0, 0, width, height);
  drawFloorPlan();
  mapLabelBoxes = [...chamberLabelBoxes];
  const turn = selectedTurn();
  const highlights = turn?.targets?.length ? turn.targets : (turn?.route || []).slice(-1);
  const targetNodes = resolve(inspected || highlights), targetIds = new Set(targetNodes.map(n => n.id));
  const searched = new Set(resolve(turn?.steps?.flatMap(s => s.nodes || [])).map(n => n.id));
  const route = (turn?.route || []).map(name => resolve([name]).find(n => n.place));
  for (let i = 1; i < route.length; i++) {
    if (route[i - 1] && route[i]) line(project(route[i - 1].x, route[i - 1].y, .07), project(route[i].x, route[i].y, .07), '#081820dd', 7);
  }
  ctx.setLineDash([5, 4]);
  for (let i = 1; i < route.length; i++) {
    if (route[i - 1] && route[i]) line(project(route[i - 1].x, route[i - 1].y, .07), project(route[i].x, route[i].y, .07), '#efd094', 2.3);
  }
  ctx.setLineDash([]);
  for (const n of route.filter(Boolean)) dot(project(n.x, n.y, .08), 2.5, '#e8c481');
  for (const n of mappedNodes()) {
    if (targetIds.has(n.id) || (!n.place && !searched.has(n.id))) continue;
    const p = project(n.x, n.y, .07);
    dot(p, searched.has(n.id) ? 3 : 1.7, searched.has(n.id) ? '#b6d7c6' : '#9bb3b366');
  }
  const labels = new Set(['entrance', 'seminar_room', 'kitchen', 'living_room', 'ghaf_chamber', 'logistics', 'manipulation', 'avatar_station', 'dexterous', 'production', 'solar_panels']);
  const occupied = [...chamberLabelBoxes];
  for (const n of mappedNodes().filter(n => labels.has(n.name) && !targetIds.has(n.id))) {
    const p = project(n.x, n.y, .12);
    const fontSize = width < 500 ? 9 : 11;
    ctx.font = `${fontSize}px Arial`;
    const text = label(n.name), w = ctx.measureText(text).width;
    const offsets = width < 500 ? [[0,6], [0,-24]] : [[0,6], [0,-24], [38,6], [-38,6], [0,29]];
    const box = offsets.map(([dx,dy]) => [p[0] + dx - w / 2 - 5, p[1] + dy, w + 10, fontSize + 8])
      .find(a => !occupied.some(b => a[0] < b[0] + b[2] + 4 && a[0] + a[2] + 4 > b[0] &&
                                    a[1] < b[1] + b[3] + 4 && a[1] + a[3] + 4 > b[1]));
    if (!box) continue;
    occupied.push(box); mapLabelBoxes.push(box);
    if (box[1] !== p[1] + 6 || box[0] !== p[0] - w / 2 - 5)
      line(p, [box[0] + box[2] / 2, box[1] + box[3] / 2], '#a3b7b644', .8);
    ctx.fillStyle = '#1b3540ee'; ctx.fillRect(...box);
    ctx.fillStyle = '#d0d8d2'; ctx.textAlign = 'center';
    ctx.fillText(text, box[0] + box[2] / 2, box[1] + fontSize + 3);
  }
  targetNodes.forEach((n, i) => {
    const p = project(n.x, n.y, .12), pulse = reducedMotion ? .5 : (Math.sin(now / 420) + 1) / 2;
    dot(p, 9 + pulse * 7, '#e8c48108', `rgba(232,196,129,${.65 - pulse * .4})`);
    dot(p, 3.5, '#e8c481');
    const top = [p[0], p[1] - 23 - (i % 2) * 25];
    if (i < 4) {
      const box = pill(label(n.name), top);
      line(p, [box[0] + box[2] / 2, box[1] + (p[1] > box[1] ? box[3] : 0)], '#e8c48177');
    }
  });
  const pose = displayPose();
  if (pose && pose.map === map.name) {
    const live = canvas.dataset.localized === 'true';
    const base = project(pose.x, pose.y, .1), top = project(pose.x, pose.y, 1.45);
    const color = live ? '#c1e4d2' : '#7e939c';
    const ahead = project(pose.x + Math.cos(pose.theta) * .75, pose.y + Math.sin(pose.theta) * .75, .12);
    dot(base, 11, '#07172166', color + '55');
    line(base, ahead, color, 2); dot(ahead, 2, color);
    line(base, top, '#102b38', 8); line(base, top, color, 4);
    dot(base, 4, color); dot(top, 6, color, '#eff7ec');
    pill('Masar' + (live ? '' : ' · last seen'), [top[0], top[1] - 13], color, '#0c2532');
  }
}
function resize() {
  const box = canvas.getBoundingClientRect(); width = box.width; height = box.height;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * ratio; canvas.height = height * ratio; ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  fitScale();
}
function fitScale() {
  if (!map) return;
  const c = Math.cos(view.yaw), s = Math.sin(view.yaw);
  const points = floorBoundary().map(([x,y]) => [x * c - y * s, (x * s + y * c) * (view.top ? 1 : .58)]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2 / (view.top ? 1 : .58);
  center = [midX * c + midY * s, -midX * s + midY * c];
  scale = Math.min((width - 95) / (Math.max(...xs) - Math.min(...xs)), (height - 190) / (Math.max(...ys) - Math.min(...ys))) * view.zoom;
}
function reset() { Object.assign(view, {yaw:planYaw(), zoom:1, panX:0, panY:0, top:true}); inspected = null; updateViewMode(); fitScale(); }
$('zoom-in').onclick = () => {view.zoom = Math.min(3, view.zoom * 1.15); fitScale();};
$('zoom-out').onclick = () => {view.zoom = Math.max(.6, view.zoom / 1.15); fitScale();};
$('reset-view').onclick = reset;
function updateViewMode() {
  $('top-view').textContent = view.top ? '3D' : '2D';
  $('top-view').setAttribute('aria-pressed', String(view.top));
  document.querySelector('.map-mode').textContent = view.top ? 'Floor plan' : 'Spatial view';
  canvas.setAttribute('aria-label', view.top
    ? 'Rectangular lab floor plan with Home, Ghaf, Spark, Space and Hive chamber boundaries. Drag to pan, scroll to zoom. Arrow keys pan; Home resets the view.'
    : 'Lab map in perspective. Drag to rotate, shift-drag to pan, scroll to zoom. Home resets the view.');
}
$('top-view').onclick = () => {
  view.top = !view.top;
  view.yaw = view.top ? planYaw() : planYaw() - .55;
  view.panX = view.panY = 0;
  updateViewMode(); fitScale();
};
let drag;
canvas.onpointerdown = (event) => {drag = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId);};
canvas.onpointermove = (event) => {
  if (!drag) return;
  if (event.shiftKey || view.top) {view.panX += event.clientX - drag[0]; view.panY += event.clientY - drag[1];}
  else view.yaw += (event.clientX - drag[0]) * .006;
  drag = [event.clientX, event.clientY]; fitScale();
};
canvas.onpointerup = canvas.onpointercancel = () => {drag = null;};
canvas.addEventListener('wheel', (event) => {event.preventDefault(); view.zoom = Math.max(.6, Math.min(3, view.zoom * Math.exp(-event.deltaY * .001))); fitScale();}, {passive:false});
canvas.onkeydown = event => {
  const deltas = {ArrowLeft:[20,0], ArrowRight:[-20,0], ArrowUp:[0,20], ArrowDown:[0,-20]};
  if (deltas[event.key]) { event.preventDefault(); view.panX += deltas[event.key][0]; view.panY += deltas[event.key][1]; }
  if (event.key === 'Home') {event.preventDefault(); reset();}
};
$('previous').onclick = () => {selectedId = turns()[turns().indexOf(selectedTurn()) - 1]?.id; inspected = null; renderConversation();};
$('next').onclick = () => {selectedId = turns()[turns().indexOf(selectedTurn()) + 1]?.id; inspected = null; renderConversation();};
$('open-connection').onclick = () => $('connection-dialog').showModal();
$('close-dialog').onclick = () => $('connection-dialog').close();
$('disconnect').onclick = () => {disconnect(); pairedToken = ''; $('token').value = ''; $('connection-dialog').close();};
$('connection-form').onsubmit = event => {
  event.preventDefault(); errorText('');
  try {connect($('endpoint').value.trim(), $('token').value);} catch (error) {errorText(error.message);}
};
try { $('endpoint').value = localStorage.getItem('masar-dashboard-endpoint') || ''; } catch { /* private browser */ }
new ResizeObserver(resize).observe(canvas);
setInterval(updateStatus, 500);
requestAnimationFrame(draw);
try {
  const response = await fetch('./map.json'); if (!response.ok) throw new Error();
  map = await response.json(); if (!map.floor?.length) throw new Error();
  if (map.plan?.scan) {
    floorImage = new Image(); floorImage.src = map.plan.scan.image;
    await floorImage.decode();
  }
  if (!snapshot?.scene) nodes = map.nodes;
  const xs = map.floor[0].map(p => p[0]), ys = map.floor[0].map(p => p[1]);
  center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  view.yaw = planYaw(); updateViewMode(); resize();
} catch {
  $('map-error').hidden = false; $('map-error').textContent = 'The lab map could not load. Refresh to try again.';
}
// The robot serves the same page and feed together. Hosted Pages asks for pairing.
if (location.port === '8767') {
  $('endpoint').value = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  connect($('endpoint').value, '');
}
