const $ = (id) => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let map, nodes = [], aliases = {}, snapshot, selectedId = null, inspected = null;
let socket, retryTimer, shouldReconnect = false, receivedAt = 0, pairedToken = '', endpoint = '';
let lastRendered = '', poseTarget = null, poseFrom = null, poseChanged = 0;
const view = {yaw: -0.85, zoom: 1, panX: 0, panY: 0, top: false};
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
function pill(text, p, color = '#e8c481', background = '#142f3c', align = 'center') {
  ctx.font = '11px Arial'; const w = ctx.measureText(text).width + 18, h = 24;
  const x = p[0] - (align === 'center' ? w / 2 : 0), y = p[1] - h;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fillStyle = background; ctx.fill();
  ctx.strokeStyle = color + '55'; ctx.lineWidth = .8; ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = color; ctx.fillText(text, x + 9, y + 16);
}
function displayPose() {
  if (!poseTarget) return null;
  const t = reducedMotion ? 1 : Math.min(1, (performance.now() - poseChanged) / 170);
  const from = poseFrom || poseTarget;
  const angle = Math.atan2(Math.sin(poseTarget.theta - from.theta), Math.cos(poseTarget.theta - from.theta));
  return {...poseTarget, x: from.x + (poseTarget.x - from.x) * t,
    y: from.y + (poseTarget.y - from.y) * t, theta: from.theta + angle * t};
}
function draw(now) {
  requestAnimationFrame(draw);
  if (document.hidden || !map) return;
  ctx.clearRect(0, 0, width, height);
  // Quiet coordinate grid below the raised floor.
  for (let x = -12; x <= 22; x += 2) line(project(x, -16, -.55), project(x, 30, -.55), '#7c9caa09');
  for (let y = -16; y <= 30; y += 2) line(project(-12, y, -.55), project(22, y, -.55), '#7c9caa09');
  // Display-only slab and occupied islands from the saved occupancy map.
  ctx.beginPath(); polygon(map.floor[0], -.28); ctx.fillStyle = '#061620'; ctx.shadowColor = '#0008'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 15; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  for (const ring of map.floor) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      ctx.beginPath(); ctx.moveTo(...project(...a)); ctx.lineTo(...project(...b));
      ctx.lineTo(...project(...b, -.28)); ctx.lineTo(...project(...a, -.28)); ctx.closePath();
      ctx.fillStyle = '#1a3d4b'; ctx.fill();
    }
  }
  ctx.beginPath(); map.floor.forEach(r => polygon(r)); ctx.fillStyle = '#21414d'; ctx.fill('evenodd');
  ctx.strokeStyle = '#557984'; ctx.lineWidth = .8; ctx.stroke();
  for (const ring of map.floor.slice(1)) {
    ctx.beginPath(); polygon(ring, .24); ctx.fillStyle = '#193541'; ctx.fill(); ctx.strokeStyle = '#45636e'; ctx.stroke();
  }
  const turn = selectedTurn(), targetNodes = resolve(inspected || turn?.targets), targetIds = new Set(targetNodes.map(n => n.id));
  const searched = new Set(resolve(turn?.steps?.flatMap(s => s.nodes || [])).map(n => n.id));
  const route = (turn?.route || []).map(name => resolve([name]).find(n => n.place));
  ctx.setLineDash([5, 5]);
  for (let i = 1; i < route.length; i++) {
    if (route[i - 1] && route[i]) line(project(route[i - 1].x, route[i - 1].y, .07), project(route[i].x, route[i].y, .07), '#e8c481', 1.8);
  }
  ctx.setLineDash([]);
  for (const n of route.filter(Boolean)) dot(project(n.x, n.y, .08), 2.5, '#e8c481');
  for (const n of mappedNodes()) {
    if (targetIds.has(n.id)) continue;
    const p = project(n.x, n.y, .07);
    dot(p, n.place ? 2 : 1.25, searched.has(n.id) ? '#b6d7c6' : n.place ? '#76939b' : '#75929b55');
  }
  const labels = new Set(['entrance', 'seminar_room', 'kitchen', 'living_room', 'ghaf_chamber', 'logistics', 'production']);
  const occupied = [];
  for (const n of mappedNodes().filter(n => labels.has(n.name) && !targetIds.has(n.id))) {
    const p = project(n.x, n.y, .12); ctx.font = '10px Arial';
    const text = label(n.name), w = ctx.measureText(text).width;
    const box = [p[0] + 5, p[1] - 16, w, 13];
    if (occupied.some(b => box[0] < b[0] + b[2] + 5 && box[0] + box[2] + 5 > b[0] && Math.abs(box[1] - b[1]) < 17)) continue;
    occupied.push(box); ctx.fillStyle = '#adc0c4'; ctx.textAlign = 'left'; ctx.fillText(text, box[0], p[1] - 6);
  }
  targetNodes.forEach((n, i) => {
    const p = project(n.x, n.y, .12), pulse = reducedMotion ? .5 : (Math.sin(now / 420) + 1) / 2;
    dot(p, 9 + pulse * 7, '#e8c48108', `rgba(232,196,129,${.65 - pulse * .4})`);
    dot(p, 3.5, '#e8c481');
    const top = [p[0], p[1] - 23 - (i % 2) * 25]; line(p, top, '#e8c48177');
    if (i < 4) pill(label(n.name), top);
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
  const points = map.floor[0].map(([x,y]) => [x * c - y * s, (x * s + y * c) * (view.top ? 1 : .58)]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2 / (view.top ? 1 : .58);
  center = [midX * c + midY * s, -midX * s + midY * c];
  scale = Math.min((width - 95) / (Math.max(...xs) - Math.min(...xs)), (height - 215) / (Math.max(...ys) - Math.min(...ys))) * view.zoom;
}
function reset() { Object.assign(view, {yaw:-.85, zoom:1, panX:0, panY:0, top:false}); inspected = null; $('top-view').textContent = '2D'; $('top-view').setAttribute('aria-pressed', 'false'); fitScale(); }
$('zoom-in').onclick = () => {view.zoom = Math.min(3, view.zoom * 1.15); fitScale();};
$('zoom-out').onclick = () => {view.zoom = Math.max(.6, view.zoom / 1.15); fitScale();};
$('reset-view').onclick = reset;
$('top-view').onclick = () => {view.top = !view.top; $('top-view').textContent = view.top ? '3D' : '2D'; $('top-view').setAttribute('aria-pressed', String(view.top)); fitScale();};
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
  if (!snapshot?.scene) nodes = map.nodes;
  const xs = map.floor[0].map(p => p[0]), ys = map.floor[0].map(p => p[1]);
  center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; resize();
} catch {
  $('map-error').hidden = false; $('map-error').textContent = 'The lab map could not load. Refresh to try again.';
}
// The robot serves the same page and feed together. Hosted Pages asks for pairing.
if (location.port === '8767') {
  $('endpoint').value = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  connect($('endpoint').value, '');
}
