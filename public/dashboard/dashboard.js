const $ = (id) => document.getElementById(id);
const canvas = $('map'), floorLayer = document.createElement('canvas');
let ctx = canvas.getContext('2d'), floorCacheKey = '';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let map, chamberLabelBoxes = [], mapLabelBoxes = [], nodes = [], aliases = {}, snapshot, selectedId = null, inspected = null;
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

// One affine camera for floors, objects, paths and measured robot positions.
// Equal ground vectors always project to equal screen vectors: opposite edges
// stay parallel at every zoom and rotation, with no perspective convergence.
const isoPitch = Math.atan(1 / Math.sqrt(2));
function floorTilt() { return view.top ? 1 : Math.sin(isoPitch); }
function project(x, y, z = 0) {
  const dx = x - center[0], dy = y - center[1], c = Math.cos(view.yaw), s = Math.sin(view.yaw);
  // A little oblique relief keeps the default floor rectangular while exposing
  // the objects' side faces. Every ground position still uses the real map XY.
  return [width / 2 + (dx * c - dy * s) * scale + view.panX + (view.top ? z * scale * .32 : 0),
    height / 2 + 20 - (dx * s + dy * c) * scale * floorTilt() - z * scale * (view.top ? .72 : Math.cos(isoPitch)) + view.panY];
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
function floorZones() { return [...(map.plan?.chambers || []), ...(map.plan?.areas || [])]; }
function planYaw() { return map?.plan?.yaw || 0; }
function containsPoint(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [px, py] = ring[j];
    if ((y > point.y) !== (py > point.y) && point.x < (px - x) * (point.y - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}
function screenPolygon(points, fill, stroke, weight = .6, holes = []) {
  ctx.beginPath();
  for (const ring of [points, ...holes]) {
    ring.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p));
    ctx.closePath();
  }
  if (fill) { ctx.fillStyle = fill; ctx.fill('evenodd'); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = weight; ctx.stroke(); }
}
function shade(color, factor) {
  const rgb = color.slice(1).match(/../g).map(v => Math.min(255, Math.round(parseInt(v, 16) * factor)));
  return `rgb(${rgb.join(',')})`;
}
function topFinish(points, color) {
  const ys = points.map(p => p[1]), xs = points.map(p => p[0]);
  const gradient = ctx.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys) + .1);
  gradient.addColorStop(0, shade(color, 1.09)); gradient.addColorStop(1, shade(color, .96));
  return gradient;
}
function surfaceDetail(ring, z, surface) {
  if (ring.length !== 4 || !surface || ['wood','wall','door'].includes(surface)) return;
  const at = (u, v) => project(...[0, 1].map(i =>
    (1 - v) * ((1 - u) * ring[0][i] + u * ring[1][i]) + v * ((1 - u) * ring[3][i] + u * ring[2][i])), z);
  const edge = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (Math.min(edge(at(0, 0), at(1, 0)), edge(at(0, 0), at(0, 1))) < 4) return;
  const inset = [[.07,.07],[.93,.07],[.93,.93],[.07,.93]].map(([u,v]) => at(u,v));
  if (surface === 'screen' || surface === 'solar') {
    screenPolygon(inset, topFinish(inset, surface === 'solar' ? '#344958' : '#3a4e55'), '#e3cfaa66', .5);
    if (surface === 'solar') {
      for (const u of [.28,.5,.72]) line(at(u,.07),at(u,.93),'#b2cfce66',.45);
      for (const v of [.36,.64]) line(at(.07,v),at(.93,v),'#b2cfce66',.45);
    } else line(at(.14,.16),at(.6,.16),'#b9d9d366',.55);
  } else {
    screenPolygon(inset, null, '#f3dfb82e', .5);
  }
}
function prism(ring, base, height, color, holes = [], surface = null) {
  const tops = [ring, ...holes].map(r => r.map(p => project(...p, base + height)));
  const faces = [ring, ...holes].flatMap((r, index) => {
    const bottom = r.map(p => project(...p, base)), top = tops[index];
    const area = bottom.reduce((sum, p, i) => {
      const next = bottom[(i + 1) % bottom.length]; return sum + p[0] * next[1] - next[0] * p[1];
    }, 0);
    const winding = Math.sign(area) * (index ? -1 : 1);
    return r.map((_, i) => {
      const j = (i + 1) % r.length;
      const dx = bottom[j][0] - bottom[i][0], dy = bottom[j][1] - bottom[i][1];
      const facing = winding * (dy * (top[i][0] - bottom[i][0]) - dx * (top[i][1] - bottom[i][1]));
      const light = .57 + .19 * Math.abs(dx) / (Math.hypot(dx, dy) || 1);
      return {points: [bottom[i], bottom[j], top[j], top[i]],
        edge: [r[i],r[j]], depth: (bottom[i][1] + bottom[j][1]) / 2, facing, color: shade(color, light)};
    }).filter(face => face.facing < 0);
  });
  faces.sort((a, b) => a.depth - b.depth);
  for (const face of faces) {
    screenPolygon(face.points, face.color);
    if (surface === 'wood' || surface === 'door') {
      const [a,b] = face.edge, length = Math.hypot(b[0]-a[0],b[1]-a[1]);
      if (length < .3) continue;
      const at = (u,z) => project(a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,z);
      if (surface === 'wood') {
        const count = Math.ceil(length/.16);
        for (let i=1;i<count;i++) line(at(i/count,base+.035),at(i/count,base+height-.025),'#493a2c70',.65);
      } else {
        line(at(.5,base+.03),at(.5,base+height-.02),'#a9c5bf55',.65);
        line(at(.61,base+height*.43),at(.61,base+height*.58),'#dfd4b1',1.2);
      }
    }
  }
  screenPolygon(tops[0], topFinish(tops[0], color), '#eedab45c', .55, tops.slice(1));
  surfaceDetail(ring, base + height, surface);
}
function drawPool(object) {
  const ring = object.outlines[0], water = object.water;
  prism(ring, object.base, object.height, '#c3b18a');
  if (!water) return;
  const at = (u, v) => project(...[0, 1].map(i =>
    (1-v) * ((1-u) * water[0][i] + u * water[1][i]) + v * ((1-u) * water[3][i] + u * water[2][i])), object.waterHeight);
  const surface = water.map(p => project(...p, object.waterHeight));
  const gradient = ctx.createLinearGradient(...at(0,0), ...at(1,1));
  gradient.addColorStop(0, '#447e85'); gradient.addColorStop(.5, '#306777'); gradient.addColorStop(1, '#285363');
  screenPolygon(surface, gradient, '#193e4e', .8);
  ctx.save(); screenPolygon(surface); ctx.clip();
  // Restrained, crisp surface glints; the entire inset remains opaque water.
  for (let row = 0; row < 9; row++) {
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const u = .09 + i / 28 * .82, v = .1 + row * .1 + Math.sin(u * Math.PI * 3 + row * .8) * .012;
      const p = at(u, v); i ? ctx.lineTo(...p) : ctx.moveTo(...p);
    }
    ctx.strokeStyle = row % 3 ? '#a4d9d51b' : '#b8e2de3d'; ctx.lineWidth = .6; ctx.stroke();
  }
  ctx.restore();
  line(at(0,0),at(1,0),'#b1d2cba3',.7);
  line(at(0,0),at(0,1),'#b1d2cb66',.7);
}
function drawObject(object, ring, color) {
  if (object.parts) {
    const parts = [...object.parts].sort((a,b) =>
      Math.max(...a.ring.map(p=>project(...p,a.base)[1])) - Math.max(...b.ring.map(p=>project(...p,b.base)[1])));
    for (const part of parts) prism(part.ring,part.base,part.height,part.color || color,[],part.surface);
  } else prism(ring,object.base,object.height,color,object.holes,object.surface);
  for (const tube of object.tubes || []) {
    const path = tube.points.map(p=>project(...p));
    const stroke = (color,weight,offset=0) => {
      ctx.beginPath(); path.forEach((p,i)=>i ? ctx.lineTo(p[0],p[1]+offset) : ctx.moveTo(p[0],p[1]+offset));
      ctx.strokeStyle=color; ctx.lineWidth=weight; ctx.stroke();
    };
    const width = Math.max(.9,tube.diameter*scale);
    stroke('#263637',width+1); stroke(tube.color,width); stroke('#f1e4c088',Math.max(.35,width*.24),-.25);
  }
}
function paintFloorPlan(selectedChambers) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const frame = floorBoundary();
  prism(frame, -.25, .25, '#21343a');
  ctx.beginPath(); polygon(frame);
  ctx.fillStyle = '#2b3d3d'; ctx.fill();
  ctx.save(); ctx.beginPath(); polygon(frame); ctx.clip();
  for (const chamber of floorZones()) {
    const selected = selectedChambers.includes(chamber.id);
    ctx.beginPath(); chamber.outlines.forEach(r => polygon(r));
    ctx.fillStyle = chamber.color; ctx.fill();
    if (selected) { ctx.fillStyle = '#cce4d509'; ctx.fill(); }
    if (selected) { ctx.strokeStyle = '#d4e3c5'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  // Dashed lines mark open chamber transitions in the supplied sketch.
  // Only the actual footprint gets a continuous outside edge.
  for (const divider of map.plan?.dividers || []) {
    ctx.setLineDash(divider.open ? [4, 5] : []);
    line(project(...divider.from), project(...divider.to), '#b4c6bcaa', .9);
  }
  ctx.setLineDash([]);
  // Crisp registered silhouettes with shaded side faces replace the minimap.
  // Sort on the ground plane, then by elevation for objects on worktops.
  const shapes = (map.plan?.objects || []).filter(o=>!o.presentationHidden).flatMap(object => object.outlines.map(ring => ({object, ring,
    depth: Math.max(...ring.map(p => project(...p)[1])) + object.base * scale * .12})));
  shapes.sort((a, b) => a.depth - b.depth);
  for (const {object, ring} of shapes) {
    const shadow = r => r.map(p => { const q = project(...p); return [q[0] - 1.5, q[1] + 2]; });
    screenPolygon(shadow(ring), '#08182035', null, .6, (object.holes || []).map(shadow));
  }
  // Draw the basin over sparse scan fragments, then equipment above its water.
  // This also keeps low unlabelled fixtures from obscuring worktop details.
  for (const {object, ring} of shapes.filter(s => s.object.kind === 'structure')) {
    prism(ring, object.base, object.height, '#a28e68', object.holes);
  }
  for (const object of (map.plan?.objects || []).filter(o => o.kind === 'pool')) drawPool(object);
  const gold = ['#c5ae80', '#baa278', '#ccb88c', '#bda983'];
  for (const {object, ring} of shapes.filter(s => ['solid','wall'].includes(s.object.kind))) {
    const color = object.kind === 'wall' ? '#bab49f' : gold[Number(object.id.replace('n', '')) % gold.length];
    drawObject(object, ring, color);
  }
  ctx.restore();
  ctx.beginPath(); polygon(frame); ctx.strokeStyle = '#c3c7ab'; ctx.lineWidth = 1.1; ctx.stroke();
  chamberLabelBoxes = [];
  for (const chamber of floorZones()) {
    const p = project(...chamber.anchor);
    let size = width < 500 ? 9 : 11;
    const auxiliary = !!chamber.nodeNames;
    const name = auxiliary ? chamber.label : chamber.label.toUpperCase();
    const xs = chamber.outlines.flat().map(v => project(...v)[0]);
    const available = Math.max(25, Math.max(...xs) - Math.min(...xs) - (auxiliary ? 2 : 6));
    ctx.font = `${auxiliary ? 500 : 600} ${size}px Arial`;
    const lines = auxiliary && ctx.measureText(name).width + 8 > available ? name.split(' ') : [name];
    const longest = Math.max(...lines.map(t => ctx.measureText(t).width));
    if (auxiliary) size *= Math.min(1, (available - 8) / longest);
    ctx.font = `${auxiliary ? 500 : 600} ${size}px Arial`;
    const w = Math.max(...lines.map(t => ctx.measureText(t).width)) + (auxiliary ? 8 : 18);
    const h = Math.max(22, lines.length * (size + 3) + 8);
    const box = [p[0] - w / 2, p[1] - h / 2, w, h];
    chamberLabelBoxes.push(box);
    ctx.fillStyle = '#102832ed'; ctx.fillRect(...box);
    ctx.strokeStyle = '#b6d7c62b'; ctx.lineWidth = .6; ctx.strokeRect(...box);
    ctx.fillStyle = auxiliary ? '#c4d1c9' : '#e3e6d5'; ctx.textAlign = 'center';
    lines.forEach((text, i) => ctx.fillText(text, p[0], box[1] + (h - lines.length * (size + 3)) / 2 + size + i * (size + 3)));
  }
}
function drawFloorPlan() {
  const turn = selectedTurn();
  const targets = resolve(inspected || (turn?.targets?.length ? turn.targets : (turn?.route || []).slice(-1)));
  const selectedChambers = floorZones().filter(c =>
    targets.some(n => c.outlines.some(r => containsPoint(n, r)))).map(c => c.id);
  const key = JSON.stringify([canvas.width, canvas.height, view, selectedChambers]);
  if (key !== floorCacheKey) {
    floorLayer.width = canvas.width; floorLayer.height = canvas.height;
    const mainContext = ctx;
    try {
      ctx = floorLayer.getContext('2d');
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      paintFloorPlan(selectedChambers);
      floorCacheKey = key;
    } finally { ctx = mainContext; }
  }
  ctx.drawImage(floorLayer, 0, 0, width, height);
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
  const labels = new Set(['kitchen', 'living_room', 'logistics', 'manipulation', 'dexterous', 'production', 'solar_panels']);
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
  const points = floorBoundary().map(([x,y]) => [x * c - y * s, (x * s + y * c) * floorTilt()]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2 / floorTilt();
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
    ? 'Lab floor plan with raised objects, Home, Ghaf, Spark, Space and Hive chambers, an entrance, and separate seminar and avatar rooms. Drag to pan, scroll to zoom. Arrow keys pan; Home resets the view.'
    : 'Lab map in orthographic 3D with parallel opposite boundaries. Drag to rotate, shift-drag to pan, scroll to zoom. Home resets the view.');
}
$('top-view').onclick = () => {
  view.top = !view.top;
  view.yaw = view.top ? planYaw() : planYaw() - Math.PI / 4;
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
  const response = await fetch('./map.json?v=water-polish-20261117'); if (!response.ok) throw new Error();
  map = await response.json(); if (!map.floor?.length) throw new Error();
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
