// A dependency-free, shadow-DOM companion for the existing GitHub Pages explorer.
const ASSETS = new URL('.', import.meta.url);
const ICONS = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  sound: '<path d="m3 9 4 0 5-5v16l-5-5H3zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  link: '<path d="m10 13 4-4m-5-2 2-2a5 5 0 0 1 7 7l-2 2m-1 3-2 2a5 5 0 0 1-7-7l2-2"/>',
  graph: '<circle cx="12" cy="4" r="2"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m11 6-5 9m7-9 5 9M8 18h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.graph}</svg>`;
let serial = 0;
function avatar() {
  const id = `masar-${++serial}`;
  return `<div class="avatar" data-pose="wave"><svg viewBox="0 0 220 250" aria-hidden="true" class="character">
    <defs><radialGradient id="${id}" cx="35%" cy="22%" r="85%"><stop stop-color="#fffefa"/><stop offset=".6" stop-color="#edf0ed"/><stop offset="1" stop-color="#bdcfce"/></radialGradient><linearGradient id="${id}-arm" x2="1" y2="1"><stop stop-color="#fffefa"/><stop offset="1" stop-color="#cbd9d7"/></linearGradient></defs>
    <ellipse class="shadow" cx="110" cy="233" rx="56" ry="8" fill="#000" opacity=".13"/>
    <g class="body"><ellipse cx="86" cy="206" rx="22" ry="26" fill="url(#${id})"/><ellipse cx="135" cy="206" rx="22" ry="26" fill="url(#${id})"/>
    <g class="arm arm-left"><path d="M69 97C44 95 34 121 29 155c-3 21 13 28 22 14l30-48" fill="url(#${id}-arm)" stroke="#fff" stroke-opacity=".5"/></g>
    <g class="arm arm-right"><path d="M153 97c25-2 35 24 40 58 3 21-13 28-22 14l-30-48" fill="url(#${id}-arm)" stroke="#fff" stroke-opacity=".5"/></g>
    <path d="M110 83c-41 0-64 38-64 81 0 42 25 56 64 56s64-14 64-56c0-43-23-81-64-81" fill="url(#${id})" stroke="#fff" stroke-opacity=".65"/>
    <path d="M62 160c2 27 18 40 48 42" fill="none" stroke="#fff" stroke-width="3" opacity=".45"/>
    <circle cx="136" cy="122" r="9" fill="#e8eddd" stroke="#adbfac"/><path d="m132 122 3 3 5-6" stroke="#839d77" fill="none" stroke-width="1.5"/>
    <g class="head"><ellipse cx="110" cy="67" rx="49" ry="32" fill="url(#${id})" stroke="#fff" stroke-opacity=".8"/>
    <path d="M89 66h42" stroke="#243b40" stroke-width="2.5"/><g class="eyes"><circle cx="88" cy="66" r="5" fill="#213539"/><circle cx="132" cy="66" r="5" fill="#213539"/></g>
    <g class="happy-eyes" fill="none" stroke="#213539" stroke-width="3" stroke-linecap="round"><path d="M82 68q6-9 12 0M126 68q6-9 12 0"/></g>
    <g class="blush" fill="#e5a5a7" opacity=".6"><ellipse cx="78" cy="77" rx="7" ry="3"/><ellipse cx="142" cy="77" rx="7" ry="3"/></g></g></g>
    <g class="thought-dots" fill="#e7cd91"><circle cx="170" cy="55" r="4"/><circle cx="182" cy="43" r="5"/><circle cx="195" cy="29" r="6"/></g>
  </svg><span class="heart h1">♥</span><span class="heart h2">♥</span><span class="heart h3">♥</span><span class="listen-ring"></span></div>`;
}

class LabCompanion extends HTMLElement {
  constructor() {
    super(); this.attachShadow({mode: 'open'}); this.turns = new Map(); this.sequence = 0;
    this.ready = false; this.busy = false; this.connected = false; this.demo = false;
    this.scene = {nodes: [], edges: [], aliases: {}}; this.timers = new Set(); this.pose = 'wave';
  }
  connectedCallback() {
    this.shadowRoot.innerHTML = `<link rel="stylesheet" href="${new URL('companion.css', ASSETS)}">
      <button class="launcher" aria-label="Open Masar, your lab companion. Double-click to type a question." title="Double-click to ask Masar">
        <span class="hello">A little help?<span>Double-click to ask me</span></span>${avatar()}<span class="name-tag"><i></i> MASAR</span>
      </button>
      <dialog class="dashboard" aria-label="Masar lab companion">

        <div class="workspace"><aside class="scene-panel" aria-label="Lab hierarchy">
          <div class="graph-wrap"><div class="hierarchy-host" aria-label="The website’s original 3D hierarchy scene graph"></div><div class="graph-empty">Loading the website’s hierarchy scene graph…</div></div>
        </aside><section class="conversation-panel" aria-label="Conversation with Masar"><div class="conversation-tools"><div class="top-actions"><span class="connection"><i></i><span class="connection-label">Not connected</span></span><button class="icon-button settings-toggle" aria-label="Connect to robot">${icon('link')}</button><button class="icon-button close-dashboard" aria-label="Minimize dashboard">${icon('minus')}</button></div></div>
          <div class="transcript" role="log" aria-label="Questions, progress, and answers" aria-live="polite" aria-relevant="additions text"><div class="welcome"><div class="welcome-orbit"><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span>${avatar()}<span class="spark s1">✦</span><span class="spark s2">✧</span></div><span class="eyebrow">YOUR FRIEND IN THE PHYSICAL WORLD</span><h3>Hi, I’m Masar.</h3><p>Big questions. Little discoveries.<br>Let’s explore the lab together.</p><button class="preview-button">Preview a conversation ${icon('arrow')}</button><span class="preview-caption">A guided example · no robot actions</span></div></div>
          <div class="activity" role="status"><span class="activity-face">${avatar()}</span><div><strong class="activity-label">Here whenever you need me</strong><small class="activity-detail">Connect to the robot to start a conversation</small></div><span class="thinking-time"></span><span class="audio-wave"><b></b><b></b><b></b><b></b><b></b></span></div>
          <div class="composer-wrap"><div class="suggestions"><button data-prompt="What can I explore in the lab?">Explore the lab ↗</button><button data-prompt="Where is the coffee machine?">Find something ↗</button><button data-prompt="Hello Masar!">Say hello ♡</button></div>
            <form class="composer"><label class="sr-only" for="question">Your question to Masar</label><textarea id="question" rows="1" maxlength="2000" placeholder="Ask me anything about the lab…"></textarea><button type="button" class="mic-button" aria-label="Use this device’s microphone" title="Use this device’s microphone">${icon('mic')}</button><button type="submit" class="send-button" aria-label="Send question">${icon('arrow')}</button></form>
            <p class="notice" role="alert" hidden></p></div>
        </section></div>
        <form class="pairing" hidden><div class="pairing-top"><span class="eyebrow">PAIR WITH YOUR ROBOT</span><button type="button" class="pairing-close icon-button" aria-label="Close connection settings">${icon('close')}</button></div><h3>A familiar voice. A live connection.</h3><p>Connect to the companion bridge running on your robot’s master desktop.</p><label for="endpoint">Robot bridge address</label><input id="endpoint" type="url" placeholder="wss://robot.example.com/ws" required><label for="token">Pairing token</label><input id="token" type="password" autocomplete="off" placeholder="Provided by your lab operator"><small>The token stays in this tab. Questions are sent to the robot and replies play through its speaker.</small><div class="pair-actions"><button type="button" class="disconnect-button">Disconnect</button><button class="pair-button" type="submit">Connect ${icon('arrow')}</button></div></form>
      </dialog>`;
    const $ = sel => this.shadowRoot.querySelector(sel); this.$ = $;
    $('.launcher').onclick = event => { if (event.detail === 1) this.hearts(); };
    $('.launcher').ondblclick = () => { this.open(); $('#question').focus(); };
    $('.launcher').onkeydown = event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); this.open(); $('#question').focus(); } };
    $('.close-dashboard').onclick = () => this.close();
    $('.dashboard').addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    $('.settings-toggle').onclick = () => { $('.pairing').hidden = !$('.pairing').hidden; if (!$('.pairing').hidden) $('#endpoint').focus(); };
    $('.pairing-close').onclick = () => { $('.pairing').hidden = true; $('.settings-toggle').focus(); };
    $('.pairing').onsubmit = event => { event.preventDefault(); this.connect($('#endpoint').value.trim(), $('#token').value); };
    $('.disconnect-button').onclick = () => this.disconnect();
    $('.composer').onsubmit = event => { event.preventDefault(); this.submit(); };
    $('#question').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.submit(); } };
    this.shadowRoot.querySelectorAll('[data-prompt]').forEach(button => button.onclick = () => { $('#question').value = button.dataset.prompt; $('#question').focus(); });
    $('.preview-button').onclick = () => this.preview();
    $('.mic-button').onclick = () => this.microphone();
    // Prevent the underlying 3D explorer’s G/L/R keyboard shortcuts while typing.
    this.shadowRoot.addEventListener('keydown', event => event.stopPropagation());
    this.clock = setInterval(() => this.tick(), 1000);
    this.greeting = setInterval(() => { if (!this.busy && !this.$('.dashboard').open) this.setPose(this.pose === 'wave' ? 'happy' : 'wave'); }, 14000);
    let endpoint = ''; try { endpoint = localStorage.getItem('masar-endpoint') || ''; } catch {}
    if (['localhost','127.0.0.1'].includes(location.hostname) && location.port === '8767') endpoint = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
    $('#endpoint').value = endpoint;
    if (endpoint) this.connect(endpoint, '');
    this.hierarchyReady = () => this.mountHierarchy();
    window.addEventListener('masar-hierarchy-ready', this.hierarchyReady);
    this.loadScene();
    if (location.hash === '#companion') this.open();
  }
  disconnectedCallback() {
    clearInterval(this.clock); clearInterval(this.greeting); window.removeEventListener('masar-hierarchy-ready', this.hierarchyReady); window.removeEventListener('message', this.frameReady); window.MasarHierarchy?.unmount(); this.disconnect(); this.clearTimers(); this.recognition?.abort();
  }
  open() { if (!this.$('.dashboard').open) { this.previousFocus = document.activeElement; this.$('.dashboard').showModal(); this.mountHierarchy(); } }
  close() { window.MasarHierarchy?.unmount(); this.$('.dashboard').close(); this.returnFocus(); }
  returnFocus() { this.$('.launcher').focus(); }
  later(fn, delay) { const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, delay); this.timers.add(timer); return timer; }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers.clear(); }
  setPose(pose) { this.pose = pose; this.shadowRoot.querySelectorAll('.avatar').forEach(node => node.dataset.pose = pose); }
  hearts() { this.setPose('love'); this.shadowRoot.querySelectorAll('.avatar').forEach(node => { node.classList.remove('hearts'); void node.offsetWidth; node.classList.add('hearts'); }); this.later(() => { if (!this.busy) this.setPose('wave'); }, 2400); }
  notice(text) { this.$('.notice').hidden = !text; this.$('.notice').textContent = text; }
  async loadScene() {
    try { const response = await fetch(new URL('scene.json', ASSETS)); if (!response.ok) throw Error(); const scene = await response.json(); if (!this.connected) { this.scene = scene; this.renderGraph(); } } catch { this.$('.graph-empty').textContent = 'Connect to the robot to load its scene graph.'; }
  }
  disconnect() {
    this.manualDisconnect = true; clearTimeout(this.retry); this.socket?.close(); this.socket = null;
    this.connected = this.ready = false; this.updateConnection();
  }
  connect(endpoint, token, retry = false) {
    let url;
    try { url = new URL(endpoint); if (!['ws:','wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error(); }
    catch { this.notice('Enter a WebSocket address such as wss://robot.example.com/ws, without credentials or query parameters.'); return; }
    if (location.protocol === 'https:' && url.protocol !== 'wss:') { this.notice('This HTTPS website needs a secure wss:// bridge. Open the local dashboard for a local ws:// connection.'); return; }
    this.disconnect(); this.clearTimers(); this.demo = false; this.manualDisconnect = false; this.endpoint = endpoint; this.token = token;
    if (!retry) this.retryDelay = 1000;
    this.notice(''); this.$('.connection-label').textContent = 'Connecting…';
    const socket = this.socket = new WebSocket(endpoint);
    socket.onopen = () => { if (this.socket === socket) socket.send(JSON.stringify({type:'auth', token})); };
    socket.onmessage = event => { if (this.socket !== socket) return; try { this.receive(JSON.parse(event.data)); } catch { this.notice('Could not read a robot update. Reconnect to refresh.'); } };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      if (this.pendingQuestion) { this.notice('Connection lost before acknowledgement. Check the conversation after reconnecting before resending.'); this.pendingQuestion = null; }
      this.connected = this.ready = false; this.busy = false; this.updateConnection(); this.setPose('concerned');
      this.$('.activity-label').textContent = 'Waiting for the robot'; this.$('.activity-detail').textContent = 'Your conversation will refresh when the connection returns.';
      if (event.code === 1008) { this.manualDisconnect = true; this.$('.pairing').hidden = false; this.notice('Pairing was refused. Check the token and the bridge’s allowed website origins.'); }
      if (!this.manualDisconnect) { this.retry = setTimeout(() => this.connect(endpoint, token, true), this.retryDelay); this.retryDelay = Math.min(this.retryDelay * 2, 15000); }
    };
    socket.onerror = () => { if (this.socket === socket) this.notice('Cannot reach the robot bridge. Check its address, certificate, and network connection.'); };
  }
  updateConnection() {
    this.$('.connection').classList.toggle('online', this.connected && this.ready);
    this.$('.connection-label').textContent = this.demo ? 'Guided preview' : this.connected ? (this.ready ? 'Robot connected' : 'Robot not ready') : 'Not connected';
    this.$('.send-button').disabled = !this.ready || this.busy || this.demo || !!this.pendingQuestion;
  }
  receive(event, replay = false) {
    if (event.type === 'snapshot') {
      this.demo = false; this.connected = true; this.retryDelay = 1000;
      this.scene = event.scene; this.turns.clear(); this.$('.transcript').replaceChildren(); this.sequence = 0;
      for (const item of event.events || []) this.receive(item, true);
      this.sequence = event.seq; this.ready = event.state.ready; this.busy = event.state.busy;
      this.$('.pairing').hidden = true; this.notice('');
      this.receive({type:'location',name:event.state.location},true);
      this.playback = event.state.playback; this.updateConnection(); this.renderGraph();
      if (!this.turns.size) this.emptyConversation();
      if (this.ready) this.open();
      this.setActivity(this.busy ? 'thinking' : 'wave', this.busy ? 'Working on your question' : 'Ready when you are', 'Speak into the BOYA microphone, or type a question below.');
      try { localStorage.setItem('masar-endpoint', this.endpoint); } catch {}
      return;
    }
    if (event.seq && event.seq <= this.sequence) return;
    if (event.seq) this.sequence = event.seq;
    if (event.type === 'status') { const wasReady = this.ready; if ('ready' in event) this.ready = event.ready; if ('busy' in event) this.busy = event.busy; if (this.ready && !wasReady && !replay) this.open(); this.updateConnection(); return; }
    if (event.type === 'location') { this.robotLocation = event.name; this.renderGraph(); return; }
    if (event.type === 'microphone') {
      if (event.state === 'listening') { if (!replay) this.open(); this.setActivity('listening', 'I’m listening…', 'Go ahead. I’m all ears.'); }
      if (event.state === 'unavailable') this.$('.activity-detail').textContent = 'Robot microphone unavailable. You can still type a question.';
      if (event.state === 'transcribing') this.setActivity('thinking','Turning your voice into words','Your question will appear here in a moment.');
      return;
    }
    if (event.type === 'accepted') { if (this.pendingQuestion?.id === event.request_id) { if (this.$('#question').value.trim() === this.pendingQuestion.text) this.$('#question').value = ''; this.pendingQuestion = null; } this.busy = true; this.updateConnection(); this.notice(''); return; }
    if (event.type === 'error') { this.pendingQuestion = null; this.notice(event.message); this.updateConnection(); return; }
    if (event.type === 'playback') {
      this.playback = event.state; this.$('.audio-wave').classList.toggle('playing',event.state === 'speaking');
      if (event.state === 'speaking') this.setActivity('speaking','Speaking through the robot','The answer is also shown in this conversation.');
      if (event.state === 'failed') this.notice('The robot speaker did not confirm playback. The answer is still visible here.');
      if (event.state === 'idle') this.setActivity(this.busy ? 'thinking' : 'happy', this.busy ? 'Working on your question' : 'Ready for your next question', 'Unmute the microphone or type below.');
      return;
    }
    const id = event.turn_id || 'current';
    if (event.type === 'question') {
      this.$('.welcome')?.remove(); this.emptyMessage?.remove();
      if (!this.turns.has(id)) this.addTurn(id, event);
      const turn = this.turns.get(id); turn.question.textContent = event.text; this.currentTurn = id;
      this.busy = true; this.started = event.at ? event.at * 1000 : Date.now(); this.highlight = null; this.hierarchyAction('clear'); this.renderGraph();
      if (!replay) this.open();
      const loving = /\b(thank|love|lovely|cute)\b/i.test(event.text || '');
      this.setActivity(loving ? 'love' : 'thinking', 'Let me think about that…','Following the connections, one step at a time.');
      if (loving && !replay) this.hearts();
      this.updateConnection();
    }
    const turn = this.turns.get(id);
    if (event.type === 'question_update' && turn) turn.question.textContent = event.text;
    if (event.type === 'progress' && turn) {
      let item = turn.stages.get(event.stage);
      if (!item) { item = document.createElement('li'); turn.progress.append(item); turn.stages.set(event.stage,item); }
      item.textContent = event.label; turn.events.push(event);
      if (id !== this.currentTurn) return;
      if (event.nodes?.length || event.route?.length) this.showBranch(event);
      else this.hierarchyAction('highlight', event);
      if (!replay) this.setActivity(event.expression || 'thinking',event.label,'Live activity from the robot');
      this.$('.graph-wrap').classList.toggle('searching', event.stage === 'search' || event.stage === 'lookup');
    }
    if ((event.type === 'answer' || event.type === 'answer_update') && turn) {
      if (event.type === 'answer') { const p = document.createElement('p'); p.textContent = event.text; turn.answer.append(p); }
      else { if (!turn.stream) { turn.stream = document.createElement('p'); turn.answer.append(turn.stream); } turn.stream.textContent = event.text; }
      turn.answer.hidden = false;
    }
    if (event.type === 'done') {
      if (turn) { turn.card.dataset.outcome = event.outcome; turn.status.textContent = event.outcome === 'completed' ? 'Complete' : event.outcome; }
      if (id !== this.currentTurn) return;
      this.busy = false; this.started = null; this.$('.thinking-time').textContent = ''; this.$('.graph-wrap').classList.remove('searching'); this.hierarchyAction('finish');
      if (!replay) this.setActivity(this.playback === 'speaking' ? 'speaking' : event.outcome === 'completed' ? 'happy' : 'concerned', this.playback === 'speaking' ? 'Speaking through the robot' : event.outcome === 'completed' ? 'A little discovery, together.' : 'Let’s try that again', 'I’m here for your next question.');
      this.updateConnection();
    }
    const transcript = this.$('.transcript'); if (transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 300 || event.type === 'question') transcript.scrollTop = transcript.scrollHeight;
  }
  emptyConversation() {
    const el = document.createElement('div'); el.className = 'empty-session'; el.textContent = 'Connected. Say hello to begin your first conversation.'; this.$('.transcript').append(el); this.emptyMessage = el;
  }
  addTurn(id, event) {
    const card = document.createElement('article'); card.className = 'turn';
    card.innerHTML = `<div class="turn-meta"><span class="visitor-icon">↗</span><span>YOU <small class="source"></small></span><span class="turn-time"></span></div><h3 class="question-text"></h3><div class="journey"><div class="journey-title">${icon('graph')} THE PATH TO AN ANSWER <span class="turn-status">In progress</span></div><ol class="progress-list"></ol></div><div class="answer" hidden><div class="answer-label"><span class="mini-face">●—●</span> MASAR</div></div><button class="revisit" type="button">Show connections ↗</button>`;
    card.querySelector('.source').textContent = event.source === 'microphone' ? '· VOICE' : '· TEXT';
    card.querySelector('.turn-time').textContent = new Date((event.at || Date.now()/1000)*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const turn = {card,question:card.querySelector('.question-text'),progress:card.querySelector('.progress-list'),answer:card.querySelector('.answer'),status:card.querySelector('.turn-status'),stages:new Map(),events:[]};
    card.querySelector('.revisit').onclick = () => { const last = [...turn.events].reverse().find(e=>e.route?.length||e.nodes?.length); if (last) this.showBranch(last); else this.notice('This answer did not select a scene-graph branch.'); };
    this.turns.set(id,turn); this.$('.transcript').append(card);
    if (this.turns.size > 80) { const first = this.turns.keys().next().value; this.turns.get(first).card.remove(); this.turns.delete(first); }
  }
  setActivity(pose, label, detail) { this.setPose(pose); this.$('.activity-label').textContent = label; this.$('.activity-detail').textContent = detail; this.$('.activity').dataset.state = pose; }
  tick() { if (this.busy && this.started) { const seconds = Math.max(0,Math.floor((Date.now()-this.started)/1000)); this.$('.thinking-time').textContent = `${seconds}s`; if (seconds > 12 && this.pose !== 'speaking') this.$('.activity-detail').textContent = 'Still working. I’ll keep you company while we wait.'; } }
  submit() {
    const input = this.$('#question'), text = input.value.trim(); if (!text) { input.focus(); return; }
    if (!this.ready || this.demo) { this.$('.pairing').hidden = false; this.notice('Connect to your robot to ask your own questions. The guided preview is an example only.'); return; }
    if (this.busy || this.pendingQuestion) { this.notice('Please wait for Masar to finish this turn.'); return; }
    if (this.socket?.readyState !== WebSocket.OPEN) { this.notice('The robot is disconnected. Your question has not been sent.'); return; }
    const id = crypto.randomUUID(); this.pendingQuestion = {id,text}; this.updateConnection();
    this.socket.send(JSON.stringify({type:'question',text,request_id:id})); this.notice('');
  }
  microphone() {
    this.open();
    if (!this.ready || this.demo) { this.notice('Connect to the robot first. You can also use its BOYA microphone once paired.'); this.$('.pairing').hidden = false; return; }
    if (this.recognition) { this.recognition.stop(); return; }
    if (this.busy) { this.notice('Please wait for this turn to finish before starting the browser microphone.'); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { this.notice('This browser does not support speech input. Use the robot’s BOYA microphone or the text field.'); return; }
    const recognition = this.recognition = new Recognition(); recognition.lang = 'en-US'; recognition.interimResults = true;
    this.setActivity('listening','I’m listening to this device…','Tap the microphone again to finish.'); this.$('.mic-button').classList.add('recording');
    recognition.onresult = event => { let text = ''; for (let i=0;i<event.results.length;i++) text += event.results[i][0].transcript; this.$('#question').value = text; if (event.results[event.results.length-1].isFinal) { this.submit(); recognition.stop(); } };
    recognition.onerror = event => this.notice(event.error === 'not-allowed' ? 'Microphone permission was denied. Use the BOYA microphone or type your question.' : `Browser microphone: ${event.error}. You can still type your question.`);
    recognition.onend = () => { this.recognition = null; this.$('.mic-button').classList.remove('recording'); if (!this.busy) this.setActivity('wave','Ready when you are','Unmute the microphone or type below.'); };
    try { recognition.start(); } catch { recognition.onend(); this.notice('The browser microphone could not start. Try the BOYA microphone or text input.'); }
  }
  resolve(value) {
    const alias = this.scene.aliases?.[value]; const values = [value,...(Array.isArray(alias)?alias:alias?[alias]:[])];
    return this.scene.nodes.filter(node => values.some(v => v === node.id || v === node.name));
  }
  showBranch(event) { this.highlight = event; this.$('.graph-wrap').classList.remove('searching'); this.renderGraph(); }
  mountHierarchy() {
    if (!this.$('.dashboard').open) return;
    const host = this.$('.hierarchy-host');
    if (window.MasarHierarchy) {
      this.hierarchyFrame?.remove(); this.hierarchyFrame = null;
      window.MasarHierarchy.mount(host).then(() => {
        this.$('.graph-empty').hidden = true;
        if (this.highlight) this.hierarchyAction('highlight', this.highlight);
      }).catch(() => { this.$('.graph-empty').textContent = 'The lab hierarchy could not load. Reopen the dashboard to retry.'; });
      return;
    }
    // On the website, wait for its existing scan/renderer instead of loading a
    // second 13-million-point scan. Standalone uses the same website in embed mode.
    if (document.getElementById('cloud-canvas') || this.hierarchyFrame) return;
    const url = new URL(this.getAttribute('hierarchy-url') || 'https://engbaa.github.io/physical-ai-lab/');
    url.searchParams.set('companion-embed','1'); url.hash = 'graph';
    this.hierarchyOrigin = url.origin;
    const frame = this.hierarchyFrame = document.createElement('iframe');
    frame.src = url.href; frame.title = 'Physical AI Lab original hierarchy scene graph';
    frame.referrerPolicy = 'no-referrer'; host.append(frame);
    this.frameReady = event => {
      if (event.source !== frame.contentWindow || event.origin !== url.origin || event.data?.type !== 'masar-hierarchy-ready') return;
      this.$('.graph-empty').hidden = true;
      if (this.highlight) this.hierarchyAction('highlight',this.highlight);
    };
    window.addEventListener('message',this.frameReady);
  }
  hierarchyAction(action,event) {
    if (window.MasarHierarchy) {
      if (action === 'highlight') window.MasarHierarchy.highlight(event,this.scene);
      else window.MasarHierarchy[action]?.();
    } else this.hierarchyFrame?.contentWindow?.postMessage({type:'masar-hierarchy',action,event,scene:this.scene},this.hierarchyOrigin);
  }
  renderGraph() {
    if (this.highlight) this.hierarchyAction('highlight',this.highlight);
  }

  preview() {
    if (this.connected && this.ready) { this.notice('You are connected to the live robot. Type a question to start.'); return; }
    this.disconnect(); this.clearTimers(); this.demo=true; this.busy=false; this.$('.transcript').replaceChildren(); this.turns.clear(); this.sequence=0;
    this.$('.pairing').hidden=true; this.updateConnection(); this.notice('');
    const target=this.scene.nodes.find(n=>/coffee maker/i.test(n.name)); const parent=this.scene.nodes.find(n=>n.id===target?.parent);
    const id=`preview-${Date.now()}`; const send=event=>this.receive({...event,turn_id:id,at:Date.now()/1000});
    send({type:'question',text:'Where is the coffee machine?',source:'text'});
    this.later(()=>send({type:'progress',stage:'search',label:'Searching the scene graph',expression:'curious'}),650);
    this.later(()=>send({type:'progress',stage:'matches',label:'Found Coffee Maker in the saved scene',nodes:target?[target.name]:[],expression:'happy'}),1900);
    this.later(()=>send({type:'progress',stage:'branch',label:'Following the object’s location branch',nodes:target?[parent?.name,target.name].filter(Boolean):[],expression:'happy'}),3200);
    this.later(()=>send({type:'answer',text:target?`The coffee machine is in the ${parent?.label||'lab'}. I found “${target.label}” in our scene graph. When I’m connected to the robot, you can ask me about it and hear my answer through the speaker.`:'Connect me to the robot and I can look up objects in its active scene graph.'}),4300);
    this.later(()=>{send({type:'done',outcome:'completed'});this.hearts();},4800);
  }
}
if (!customElements.get('lab-companion')) customElements.define('lab-companion',LabCompanion);
if (!document.querySelector('lab-companion')) document.body.append(document.createElement('lab-companion'));
