// Meeting rooms: video calls between people (WebRTC), chat, shared live captions, recording and minutes.
const $ = (id) => document.getElementById(id);
const IS_EXT = location.protocol === 'chrome-extension:';
const DEFAULT_SERVER_URL = 'https://videos-bwct.onrender.com';
let BASE = DEFAULT_SERVER_URL;
// Keep both historical keys in sync, but always use the configured server URL.
try {
  localStorage.setItem('serverUrl', DEFAULT_SERVER_URL);
  localStorage.setItem('meetingServerUrl', DEFAULT_SERVER_URL);
} catch (_) {}
const api = (p) => BASE.replace(/\/+$/, '') + p;
const pad = (n) => String(n).padStart(2, '0');
const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const initials = (name) => (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

const ICONS = {
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  fs: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/>',
  cam: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  camOff: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3M4 4l16 16"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  rec: '<circle cx="12" cy="12" r="6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  leave: '<path d="M3 14c5-4 13-4 18 0l-2 3-4-2v-2c-2-1-4-1-6 0v2l-4 2z"/>',
};
const setIcon = (btn, key, label) => { btn.querySelector('svg').innerHTML = ICONS[key]; btn.querySelector('span').textContent = label; btn.setAttribute('aria-label', label); btn.title = label; };

// ---------- state ----------
let localStream = null, micOn = true, camOn = true, sharing = false, screenTrack = null;
let roomId = '', myId = '', myName = '', es = null, cfg = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const peers = new Map();
let joinTime = 0, inCall = false, myTile = null;
let captionLines = [], items = [], seenNames = new Set();
let recording = false, recBlobUrl = null;

const audioTrack = () => (localStream && localStream.getAudioTracks()[0]) || null;
const cameraTrack = () => (localStream && localStream.getVideoTracks()[0]) || null;
const outVideo = () => (sharing && screenTrack ? screenTrack : cameraTrack());
const hasVideoOut = () => !!outVideo() && (sharing || camOn);

function toast(text) {
  const el = $('toast'); el.textContent = text; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- lobby ----------
async function checkServer() {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 25000) : null;
  try {
    const r = await fetch(api('/api/health'), {
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    });
    return r.ok;
  } catch (_) {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
async function initLobby() {
  try { $('userName').value = localStorage.getItem('userName') || ''; } catch (_) {}
  // The server is preconfigured for desktop and mobile; no manual URL entry is needed.
  $('serverBox').hidden = true;
  const r = new URLSearchParams(location.search).get('r');
  if (r) { $('joinRow').hidden = true; $('newMeeting').textContent = t('room.joinas'); }
  await startLobbyMedia();
  refreshLobbyButtons();
}
// Server URL is fixed in DEFAULT_SERVER_URL; manual server editing is disabled.

function mediaErrorMessage(error) {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'Camera access requires a secure HTTPS page. Open the meeting link directly in Chrome or Safari, not inside another app.';
  }
  if (error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
    return 'Camera permission is blocked. In iPhone Settings > Safari > Camera, allow access, then reload this page.';
  }
  if (error && (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError')) {
    return 'No available camera was found on this device.';
  }
  if (error && (error.name === 'NotReadableError' || error.name === 'TrackStartError')) {
    return 'The camera may be in use by another app. Close other camera apps and try again.';
  }
  return 'Could not start the camera. Check Safari camera permission and try again.';
}
async function ensureCamera() {
  if (cameraTrack()) {
    cameraTrack().enabled = camOn;
    return true;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('lobbyNote').textContent = mediaErrorMessage();
    $('lobbyNote').hidden = false;
    return false;
  }
  try {
    // Request video from the button's user gesture; this is important on iOS Safari.
    let videoStream;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    } catch (firstError) {
      // Some mobile browsers reject ideal/facingMode constraints; retry with the
      // simplest camera request before reporting a permission/device error.
      videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    if (!localStream) localStream = new MediaStream();
    videoStream.getVideoTracks().forEach((track) => {
      track.enabled = camOn;
      localStream.addTrack(track);
    });
    $('lobbyVideo').srcObject = localStream;
    $('lobbyVideo').muted = true;
    $('lobbyVideo').playsInline = true;
    $('lobbyVideo').play().catch(() => {});
    if (inCall) {
      const track = cameraTrack();
      await setOutgoingVideo(camOn ? track : null);
      applyMyTile();
      sendState();
      refreshControls();
    }
    $('lobbyNote').hidden = true;
    return true;
  } catch (error) {
    $('lobbyNote').textContent = mediaErrorMessage(error);
    $('lobbyNote').hidden = false;
    return false;
  }
}
async function startLobbyMedia() {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('lobbyNote').textContent = mediaErrorMessage();
    $('lobbyNote').hidden = false;
    refreshLobbyButtons();
    return;
  }
  // Ask for audio and video together first, then request each independently so a
  // denied/missing camera does not prevent the microphone from working (or vice versa).
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: 'user' } }
    });
  } catch (_) {
    try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); } catch (_) {}
    try {
      let videoStream;
      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }
        });
      } catch (_) {
        // Let Android Chrome select any available camera if the preferred
        // front-camera constraints are not supported by the device.
        videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      if (!localStream) localStream = new MediaStream();
      videoStream.getVideoTracks().forEach((track) => localStream.addTrack(track));
    } catch (error) {
      $('lobbyNote').textContent = mediaErrorMessage(error);
      $('lobbyNote').hidden = false;
    }
  }
  if (localStream) {
    $('lobbyVideo').srcObject = localStream;
    $('lobbyVideo').muted = true;
    $('lobbyVideo').playsInline = true;
    $('lobbyVideo').play().catch(() => {});
  }
  $('lobbyAvatar').querySelector('span').textContent = initials($('userName').value);
  refreshLobbyButtons();
}
function refreshLobbyButtons() {
  setIcon($('lobbyMic'), micOn && audioTrack() ? 'mic' : 'micOff', t(micOn ? 'room.mic.on' : 'room.mic.off'));
  setIcon($('lobbyCam'), camOn && cameraTrack() ? 'cam' : 'camOff', t(camOn ? 'room.cam.on' : 'room.cam.off'));
  $('lobbyMic').classList.toggle('off', !micOn || !audioTrack());
  $('lobbyCam').classList.toggle('off', !camOn || !cameraTrack());
  $('lobbyVideo').parentElement.classList.toggle('off', !camOn || !cameraTrack());
}
$('lobbyMic').addEventListener('click', () => { micOn = !micOn; if (audioTrack()) audioTrack().enabled = micOn; refreshLobbyButtons(); });
$('lobbyCam').addEventListener('click', async () => {
  if (!cameraTrack()) {
    camOn = true;
    const ok = await ensureCamera();
    refreshLobbyButtons();
    if (!ok) return;
  } else {
    camOn = !camOn;
    cameraTrack().enabled = camOn;
  }
  refreshLobbyButtons();
});
$('userName').addEventListener('input', () => { $('lobbyAvatar').querySelector('span').textContent = initials($('userName').value); });

function parseCode(v) {
  v = (v || '').trim();
  const m = v.match(/[?&]r=([a-z0-9-]+)/i);
  return (m ? m[1] : v).toLowerCase().replace(/[^a-z0-9-]/g, '');
}
$('newMeeting').addEventListener('click', () => {
  const r = new URLSearchParams(location.search).get('r');
  enterRoom(r ? parseCode(r) : `${rand(3)}-${rand(4)}-${rand(3)}`);
});
$('joinBtn').addEventListener('click', () => { const id = parseCode($('joinCode').value); if (id.length >= 4) enterRoom(id); });
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

// ---------- signaling ----------
async function post(body) {
  try { await fetch(api('/api/send'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: roomId, from: myId, ...body }) }); } catch (_) {}
}
const sendTo = (to, type, payload) => post({ to, type, payload });
const broadcastMsg = (type, payload) => post({ type, payload });

async function enterRoom(id) {
  const createButton = $('newMeeting');
  const joinButton = $('joinBtn');
  createButton.disabled = true;
  joinButton.disabled = true;
  myName = ($('userName').value || '').trim() || 'Guest';
  try { localStorage.setItem('userName', myName); } catch (_) {}
  $('lobbyNote').hidden = true;
  // iOS Safari is more reliable when camera permission is requested directly
  // from the user's Start/Join button gesture, rather than only on page load.
  if (!cameraTrack()) {
    await ensureCamera();
    refreshLobbyButtons();
  }
  if (!(await checkServer())) {
    $('lobbyNote').textContent = 'The meeting server is not responding yet. Please try again in a moment.';
    $('lobbyNote').hidden = false;
    createButton.disabled = false;
    joinButton.disabled = false;
    return;
  }
  try {
    const configResponse = await fetch(api('/api/config'), { cache: 'no-store' });
    if (configResponse.ok) {
      const c = await configResponse.json();
      if (c.iceServers) cfg = c;
    }
  } catch (_) {}
  roomId = id; myId = rand(12); joinTime = Date.now(); captionLines = []; items = []; seenNames = new Set([myName]);
  $('lobbyVideo').srcObject = null;
  try {
    es = new EventSource(api(`/api/events?room=${encodeURIComponent(id)}&peer=${myId}&name=${encodeURIComponent(myName)}`));
  } catch (error) {
    $('lobbyNote').textContent = 'Your browser could not open the meeting connection. Please update Safari and try again.';
    $('lobbyNote').hidden = false;
    createButton.disabled = false;
    joinButton.disabled = false;
    return;
  }
  es.addEventListener('welcome', (e) => {
    const { peers: existing } = JSON.parse(e.data);
    createButton.disabled = false;
    joinButton.disabled = false;
    $('lobbyNote').hidden = true;
    if (!inCall) showCall();
    for (const p of existing) { if (!peers.has(p.id)) { const peer = addPeer(p.id, p.name); initiate(peer); } }
    sendState();
  });
  es.addEventListener('peer-joined', (e) => {
    const p = JSON.parse(e.data); addPeer(p.id, p.name);
    toast(t('room.joined', { name: p.name }));
    sendTo(p.id, 'state', stateObj());
    if (recording) sendTo(p.id, 'rec', { on: true });
  });
  es.addEventListener('peer-left', (e) => { const p = peers.get(JSON.parse(e.data).id); if (p) toast(t('room.left', { name: p.name })); removePeer(JSON.parse(e.data).id); updateRecBanner(); });
  es.addEventListener('msg', (e) => handleMsg(JSON.parse(e.data)));
  es.addEventListener('full', () => { es.close(); toast(t('room.full')); });
  es.onerror = () => {
    if (es && es.readyState === 2) {
      if (inCall) toast(t('room.lost'));
      else {
        $('lobbyNote').textContent = 'Could not connect to the meeting server. Please try again.';
        $('lobbyNote').hidden = false;
        createButton.disabled = false;
        joinButton.disabled = false;
        es.close();
      }
    }
  };
}

// ---------- tiles and peers ----------
function makeTile(id, name, stream, mine) {
  const tile = document.createElement('div');
  tile.className = 'tile' + (mine ? ' mine' : '');
  tile.dataset.id = id;
  const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.muted = !!mine; v.srcObject = stream;
  const av = document.createElement('div'); av.className = 'avatar'; const sp = document.createElement('span'); sp.textContent = initials(name); av.appendChild(sp);
  const nm = document.createElement('div'); nm.className = 'name';
  const n = document.createElement('span'); n.className = 'n'; n.textContent = name;
  const mi = document.createElement('span'); mi.className = 'muted-ico'; mi.textContent = '✕';
  nm.append(n, mi);
  tile.append(v, av, nm);
  $('grid').appendChild(tile);
  return { el: tile, video: v, nameEl: n };
}
function addPeer(id, name) {
  if (peers.has(id)) return peers.get(id);
  const p = { id, name, pc: null, stream: new MediaStream(), state: { mic: true, cam: true, share: false }, queue: [], recording: false };
  p.tile = makeTile(id, name, p.stream, false);
  p.tile.el.classList.add('off');
  peers.set(id, p); seenNames.add(name);
  refreshChatRecipients();
  layoutGrid(); updateCount();
  return p;
}
function removePeer(id) {
  const p = peers.get(id); if (!p) return;
  try { p.pc && p.pc.close(); } catch (_) {}
  p.tile.el.remove(); peers.delete(id);
  refreshChatRecipients();
  layoutGrid(); updateCount(); syncRecAudio();
}
let pinnedId = null;
function layoutGrid() {
  const g = $('grid');
  $('waitHint').hidden = peers.size > 0;
  $('waitHint').textContent = t('room.waiting');
  const tiles = [...g.querySelectorAll('.tile')];
  const n = tiles.length;
  const W = g.clientWidth, H = g.clientHeight, gap = 10;
  if (pinnedId && !tiles.some((x) => x.dataset.id === pinnedId)) pinnedId = null;
  tiles.forEach((x) => { x.style.height = ''; x.style.gridRow = ''; x.style.gridColumn = ''; x.style.aspectRatio = ''; x.classList.remove('pinned'); x.title = n > 1 ? t('room.spotlight') : ''; });
  if (pinnedId && n > 1) {
    const side = Math.round(Math.min(Math.max(W * 0.2, 150), 260));
    g.classList.add('spotlight');
    g.style.gridTemplateColumns = `minmax(0, 1fr) ${side}px`;
    g.style.gridAutoRows = 'auto';
    tiles.forEach((x) => {
      if (x.dataset.id === pinnedId) { x.classList.add('pinned'); x.style.gridColumn = '1'; x.style.gridRow = `1 / span ${n - 1}`; x.style.height = H + 'px'; }
      else x.style.gridColumn = '2';
    });
    return;
  }
  g.classList.remove('spotlight');
  // Pick the number of columns that gives the biggest pictures. Tiles may be a little squarer (4:3) than wide (16:9) to use the space.
  let best = { area: 0, w: 0, cols: 1, ar: 16 / 9 };
  for (let cols = 1; cols <= Math.max(n, 1); cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
    const ar = Math.min(Math.max(cw / ch, 4 / 3), 16 / 9);
    const w = Math.min(cw, ch * ar), area = w * (w / ar);
    if (area > best.area) best = { area, w, cols, ar };
  }
  g.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.max(120, Math.floor(best.w))}px)`;
  g.style.gridAutoRows = 'auto';
  tiles.forEach((x) => { x.style.aspectRatio = String(best.ar); });
}
$('grid').addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile || peers.size === 0) return;
  pinnedId = pinnedId === tile.dataset.id ? null : tile.dataset.id;
  layoutGrid();
});
window.addEventListener('resize', () => { if (inCall) layoutGrid(); });
document.addEventListener('fullscreenchange', () => { refreshControls(); if (inCall) layoutGrid(); });
function updateCount() { $('peopleCount').textContent = t('room.people', { n: peers.size + 1 }); }
function applyTileState(p) {
  const { mic, cam, share } = p.state;
  p.tile.el.classList.toggle('muted', !mic);
  p.tile.el.classList.toggle('sharing', !!share);
  p.tile.el.classList.toggle('off', !cam && !share);
}
function applyMyTile() {
  if (!myTile) return;
  myTile.el.classList.toggle('muted', !micOn || !audioTrack());
  myTile.el.classList.toggle('sharing', sharing);
  myTile.el.classList.toggle('off', !hasVideoOut());
  myTile.video.srcObject = outVideo() ? new MediaStream([outVideo()]) : null;
}

// ---------- WebRTC ----------
function makePC(p) {
  const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
  p.pc = pc;
  pc.onicecandidate = (e) => { if (e.candidate) sendTo(p.id, 'signal', { candidate: e.candidate.toJSON() }); };
  pc.ontrack = (e) => {
    if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
    p.tile.video.play().catch(() => {});
    syncRecAudio();
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') toast(t('room.conn.failed', { name: p.name })); };
  return pc;
}
async function initiate(p) {
  const pc = makePC(p);
  const a = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const v = pc.addTransceiver('video', { direction: 'sendrecv' });
  await a.sender.replaceTrack(audioTrack());
  await v.sender.replaceTrack(outVideo());
  await pc.setLocalDescription(await pc.createOffer());
  sendTo(p.id, 'signal', { sdp: pc.localDescription.toJSON() });
}
async function flushQueue(p) {
  while (p.queue.length) { try { await p.pc.addIceCandidate(p.queue.shift()); } catch (_) {} }
}
async function handleSignal(from, payload) {
  const p = peers.get(from) || addPeer(from, 'Guest');
  if (payload.sdp) {
    if (payload.sdp.type === 'offer') {
      const pc = p.pc || makePC(p);
      await pc.setRemoteDescription(payload.sdp);
      for (const tr of pc.getTransceivers()) {
        const kind = tr.receiver.track.kind;
        tr.direction = 'sendrecv';
        await tr.sender.replaceTrack(kind === 'audio' ? audioTrack() : outVideo());
      }
      await pc.setLocalDescription(await pc.createAnswer());
      sendTo(from, 'signal', { sdp: pc.localDescription.toJSON() });
      flushQueue(p);
    } else if (p.pc) {
      await p.pc.setRemoteDescription(payload.sdp);
      flushQueue(p);
    }
  } else if (payload.candidate) {
    if (p.pc && p.pc.remoteDescription) { try { await p.pc.addIceCandidate(payload.candidate); } catch (_) {} }
    else p.queue.push(payload.candidate);
  }
}
async function setOutgoingVideo(track) {
  for (const p of peers.values()) {
    if (!p.pc) continue;
    const tr = p.pc.getTransceivers().find((x) => x.receiver.track.kind === 'video');
    if (tr) { try { await tr.sender.replaceTrack(track); } catch (_) {} }
  }
}

// ---------- messages ----------
function stateObj() { return { mic: micOn && !!audioTrack(), cam: camOn && !!cameraTrack(), share: sharing }; }
function sendState() { broadcastMsg('state', stateObj()); }
function handleMsg({ from, type, payload }) {
  const p = peers.get(from);
  if (type === 'signal') { handleSignal(from, payload); return; }
  if (!p) return;
  if (type === 'state') { p.state = payload; applyTileState(p); }
  else if (type === 'chat') addChat(p.name, payload.text, payload.ts, false, !!payload.private);
  else if (type === 'caption') addCaption({ name: p.name, ts: payload.ts, text: payload.text });
  else if (type === 'rec') { p.recording = !!payload.on; updateRecBanner(); }
}
function updateRecBanner() {
  const who = recording ? null : [...peers.values()].find((p) => p.recording);
  const b = $('recBanner');
  if (recording) { b.textContent = t('room.rec.you'); b.hidden = false; }
  else if (who) { b.textContent = t('room.recording.by', { name: who.name }); b.hidden = false; }
  else b.hidden = true;
}

// ---------- call screen ----------
function showCall() {
  inCall = true;
  $('lobby').hidden = true; $('ended').hidden = true; $('call').hidden = false;
  $('roomLabel').textContent = roomId;
  document.body.classList.add('in-call');
  $('grid').innerHTML = '';
  myTile = makeTile('me', `${myName} (${t('room.you')})`, null, true);
  applyMyTile(); layoutGrid(); updateCount(); refreshControls();
  const lang = LANG === 'ar' ? 'ar-AE' : 'en-US'; $('capLang').value = lang;
}
function refreshControls() {
  const hasAudio = !!audioTrack(), hasCam = !!cameraTrack();
  setIcon($('micBtn'), micOn && hasAudio ? 'mic' : 'micOff', t(micOn ? 'room.mic.on' : 'room.mic.off'));
  setIcon($('camBtn'), camOn && hasCam ? 'cam' : 'camOff', t(camOn ? 'room.cam.on' : 'room.cam.off'));
  setIcon($('shareBtn'), 'screen', t(sharing ? 'room.share.stop' : 'room.share'));
  setIcon($('recBtn'), recording ? 'stop' : 'rec', t(recording ? 'room.rec.stop' : 'room.rec'));
  const sideHidden = $('call').classList.contains('no-side');
  setIcon($('panelBtn'), 'panel', t(sideHidden ? 'room.panel.show' : 'room.panel.hide'));
  setIcon($('fsBtn'), 'fs', t(document.fullscreenElement ? 'room.fs.exit' : 'room.fs'));
  $('panelBtn').classList.toggle('active', !sideHidden);
  $('fsBtn').classList.toggle('active', !!document.fullscreenElement);
  setIcon($('leaveBtn'), 'leave', t('room.leave'));
  $('micBtn').classList.toggle('off', !micOn || !hasAudio);
  $('camBtn').classList.toggle('off', !camOn || !hasCam);
  $('micBtn').disabled = !hasAudio; $('camBtn').disabled = !hasCam;
  $('shareBtn').classList.toggle('active', sharing);
  $('recBtn').classList.toggle('recording', recording);
  $('shareBtn').style.display = navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia ? '' : 'none';
}
$('micBtn').addEventListener('click', () => {
  micOn = !micOn; if (audioTrack()) audioTrack().enabled = micOn;
  applyMyTile(); refreshControls(); sendState();
  if (!micOn) pauseSR(); else if (srWanted) launchSR();
});
$('camBtn').addEventListener('click', async () => {
  if (!cameraTrack()) {
    camOn = true;
    const ok = await ensureCamera();
    if (!ok) { toast($('lobbyNote').textContent); return; }
  } else {
    camOn = !camOn;
    cameraTrack().enabled = camOn;
    await setOutgoingVideo(camOn ? cameraTrack() : null);
  }
  applyMyTile(); refreshControls(); sendState();
});
$('panelBtn').addEventListener('click', () => { $('call').classList.toggle('no-side'); refreshControls(); layoutGrid(); });
$('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
});
$('shareBtn').addEventListener('click', async () => {
  if (sharing) { stopShare(); return; }
  try {
    const ds = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
    screenTrack = ds.getVideoTracks()[0];
    screenTrack.addEventListener('ended', stopShare);
    sharing = true;
    await setOutgoingVideo(screenTrack);
    applyMyTile(); refreshControls(); sendState();
  } catch (_) {}
});
async function stopShare() {
  if (!sharing) return;
  sharing = false;
  try { screenTrack.stop(); } catch (_) {}
  screenTrack = null;
  await setOutgoingVideo(cameraTrack());
  applyMyTile(); refreshControls(); sendState();
}
$('copyLink').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(inviteLink()); toast(t('room.copied')); } catch (_) {}
});
function inviteLink() {
  const base = BASE ? BASE.replace(/\/+$/, '') + '/' : location.href;
  return new URL('room.html?r=' + roomId, base).href;
}

// ---------- tabs ----------
const TABS = { Chat: 'panelChat', Captions: 'panelCaptions', Notes: 'panelNotes' };
Object.keys(TABS).forEach((k) => $('tab' + k).addEventListener('click', () => {
  Object.entries(TABS).forEach(([name, panel]) => {
    const on = name === k;
    $('tab' + name).classList.toggle('on', on); $('tab' + name).setAttribute('aria-selected', String(on));
    $(panel).hidden = !on;
  });
}));

// ---------- chat ----------
function refreshChatRecipients() {
  const select = $('chatRecipient');
  if (!select) return;
  const selected = select.value || 'all';
  select.innerHTML = '';
  const everyone = document.createElement('option');
  everyone.value = 'all'; everyone.textContent = t('room.chat.everyone');
  select.appendChild(everyone);
  for (const [id, peer] of peers) {
    const option = document.createElement('option');
    option.value = id; option.textContent = peer.name;
    select.appendChild(option);
  }
  select.value = peers.has(selected) ? selected : 'all';
  select.disabled = peers.size === 0;
  select.title = peers.size ? '' : t('room.chat.waiting');
}
function addChat(name, text, ts, mine, privateChat = false, recipientName = '') {
  const m = document.createElement('div'); m.className = 'msg' + (mine ? ' me' : '');
  const who = document.createElement('span'); who.className = 'who';
  const privateLabel = privateChat ? (mine ? t('room.chat.privateTo', { name: recipientName }) : t('room.chat.private')) + ' · ' : '';
  who.textContent = privateLabel + name + ' · ' + new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const p = document.createElement('p'); p.dir = 'auto'; p.textContent = text;
  m.append(who, p); $('chatLog').appendChild(m); $('chatLog').scrollTop = $('chatLog').scrollHeight;
}
function sendChat() {
  const text = $('chatText').value.trim(); if (!text) return;
  const ts = Date.now(); $('chatText').value = '';
  const recipient = $('chatRecipient').value;
  if (recipient === 'all') {
    addChat(myName, text, ts, true);
    broadcastMsg('chat', { text, ts });
  } else {
    const peer = peers.get(recipient);
    if (!peer) { refreshChatRecipients(); toast(t('room.chat.waiting')); return; }
    addChat(myName, text, ts, true, true, peer.name);
    sendTo(recipient, 'chat', { text, ts, private: true });
  }
}
$('chatSend').addEventListener('click', sendChat);
$('chatText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
document.querySelectorAll('.emoji-btn').forEach((button) => button.addEventListener('click', () => {
  const input = $('chatText'), emoji = button.dataset.emoji;
  const start = input.selectionStart == null ? input.value.length : input.selectionStart;
  const end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
  input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  input.focus();
  const cursor = start + emoji.length;
  input.setSelectionRange(cursor, cursor);
}));
refreshChatRecipients();

// ---------- live captions (each person transcribes their own voice and shares it) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let sr = null, srWanted = false;
function addCaption(line) {
  captionLines.push(line);
  $('capEmpty').hidden = true;
  const p = document.createElement('p'); p.className = 'line';
  const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = hms(line.ts - joinTime);
  const body = document.createElement('span');
  const who = document.createElement('span'); who.className = 'who'; who.textContent = line.name + ':';
  const tx = document.createElement('span'); tx.className = 'tx'; tx.dir = 'auto'; tx.textContent = line.text;
  body.append(who, tx); p.append(ts, body);
  $('capLog').appendChild(p); $('capLog').scrollTop = $('capLog').scrollHeight;
}
function onFinalCaption(text) {
  const ts = Date.now();
  addCaption({ name: myName, ts, text });
  broadcastMsg('caption', { ts, text });
}
function launchSR() {
  if (!SR || !srWanted || !micOn) return;
  sr = new SR(); sr.continuous = true; sr.interimResults = false; sr.lang = $('capLang').value;
  sr.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) { const tx = e.results[i][0].transcript.trim(); if (tx) onFinalCaption(tx); } } };
  sr.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { srWanted = false; $('capOn').checked = false; toast(t('meet.srdenied')); }
    else if (e.error === 'network') { srWanted = false; $('capOn').checked = false; toast(t('meet.srnet')); }
  };
  sr.onend = () => { if (srWanted && micOn && inCall) setTimeout(launchSR, 250); };
  try { sr.start(); } catch (_) {}
}
function pauseSR() { if (sr) { try { sr.stop(); } catch (_) {} sr = null; } }
$('capOn').addEventListener('change', () => {
  if ($('capOn').checked) {
    if (!SR) { toast(t('meet.nosr')); $('capOn').checked = false; return; }
    srWanted = true; launchSR();
  } else { srWanted = false; pauseSR(); }
});
$('capLang').addEventListener('change', () => { if (srWanted) { pauseSR(); launchSR(); } });

// ---------- notes + minutes ----------
function renderItems() {
  $('noteList').innerHTML = '';
  items.forEach((it, idx) => {
    const li = document.createElement('li'); li.className = 'note ' + it.type;
    const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = hms(it.ms);
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = t('note.' + it.type);
    const tx = document.createElement('span'); tx.className = 'tx'; tx.dir = 'auto'; tx.textContent = it.text;
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'x'; rm.textContent = '×'; rm.setAttribute('aria-label', t('note.remove'));
    rm.addEventListener('click', () => { items.splice(idx, 1); renderItems(); });
    li.append(ts, tag, tx, rm); $('noteList').appendChild(li);
  });
}
function addNote() {
  const text = $('noteText').value.trim(); if (!text) return;
  items.push({ ms: Date.now() - joinTime, type: $('noteType').value, text }); $('noteText').value = ''; renderItems();
}
$('noteAdd').addEventListener('click', addNote);
$('noteText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } });

function saveText(name, text, type) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function sortedLines() { return captionLines.slice().sort((a, b) => a.ts - b.ts); }
function buildMinutes() {
  const when = new Date(joinTime).toLocaleString(LANG === 'ar' ? 'ar-AE' : 'en-GB');
  const dur = hms((endTime || Date.now()) - joinTime);
  let md = `# ${t('min.untitled')} ${roomId}\n\n${when} · ${t('min.duration')}: ${dur}\n\n${t('room.participants')}: ${[...seenNames].join(', ')}\n\n`;
  const section = (type, head, f) => { const arr = items.filter((i) => i.type === type); if (arr.length) md += `## ${head}\n\n` + arr.map(f).join('\n') + '\n\n'; };
  section('action', t('min.actions'), (i) => `- [ ] [${hms(i.ms)}] ${i.text}`);
  section('decision', t('min.decisions'), (i) => `- [${hms(i.ms)}] ${i.text}`);
  section('note', t('min.notes'), (i) => `- [${hms(i.ms)}] ${i.text}`);
  const lines = sortedLines();
  if (lines.length) md += `## ${t('min.transcript')}\n\n` + lines.map((l) => `[${hms(l.ts - joinTime)}] **${l.name}:** ${l.text}`).join('\n\n') + '\n';
  return md;
}
function srtTime(ms) { const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000), x = Math.floor(ms % 1000); return `${pad(h)}:${pad(m)}:${pad(s)},${String(x).padStart(3, '0')}`; }
function buildSrt() {
  const lines = sortedLines();
  return lines.map((l, i) => {
    const start = l.ts - joinTime, next = lines[i + 1] ? lines[i + 1].ts - joinTime - 20 : start + 4000;
    const end = Math.max(Math.min(next, start + 8000), start + 200);
    return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${l.name}: ${l.text}\n`;
  }).join('\n');
}
const fileBase = () => 'meeting-' + roomId;
$('dlMinutes').addEventListener('click', () => saveText(fileBase() + '-minutes.md', buildMinutes(), 'text/markdown'));
$('dlSrt').addEventListener('click', () => saveText(fileBase() + '.srt', buildSrt(), 'application/x-subrip'));
$('copyMinutes').addEventListener('click', async () => { try { await navigator.clipboard.writeText(buildMinutes()); toast(t('copied')); } catch (_) {} });

// ---------- recording the whole meeting (all faces + all voices) ----------
const REC = { w: 1280, h: 720, fps: 25 };
let rec = null, recChunks = [], recCanvas = null, recCtx = null, recWorker = null, recActx = null, recDest = null, recNodes = [];
function syncRecAudio() {
  if (!recActx || !recDest) return;
  recNodes.forEach((n) => { try { n.disconnect(); } catch (_) {} }); recNodes = [];
  const add = (tracks) => { if (tracks.length) { const src = recActx.createMediaStreamSource(new MediaStream(tracks)); src.connect(recDest); recNodes.push(src); } };
  if (audioTrack()) add([audioTrack()]);
  peers.forEach((p) => add(p.stream.getAudioTracks()));
}
function coverDraw(v, x, y, w, h, contain) {
  const vw = v.videoWidth, vh = v.videoHeight; if (!vw || !vh) return false;
  const sc = contain ? Math.min(w / vw, h / vh) : Math.max(w / vw, h / vh);
  const dw = vw * sc, dh = vh * sc;
  recCtx.save(); recCtx.beginPath(); recCtx.rect(x, y, w, h); recCtx.clip();
  recCtx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); recCtx.restore(); return true;
}
function drawRec() {
  const W = recCanvas.width, H = recCanvas.height;
  recCtx.fillStyle = '#0f1226'; recCtx.fillRect(0, 0, W, H);
  const cells = [{ name: myName, video: myTile.video, off: !hasVideoOut(), share: sharing, mine: true }];
  peers.forEach((p) => cells.push({ name: p.name, video: p.tile.video, off: !p.state.cam && !p.state.share, share: p.state.share }));
  const n = cells.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), gap = 8;
  const cw = (W - gap * (cols + 1)) / cols, ch = (H - gap * (rows + 1)) / rows;
  cells.forEach((c, i) => {
    const x = gap + (i % cols) * (cw + gap), y = gap + Math.floor(i / cols) * (ch + gap);
    recCtx.fillStyle = '#070918'; recCtx.fillRect(x, y, cw, ch);
    let drawn = false;
    if (!c.off) {
      if (c.mine && !c.share) { recCtx.save(); recCtx.translate(x + cw, y); recCtx.scale(-1, 1); drawn = coverDraw(c.video, 0, 0, cw, ch, false); recCtx.restore(); }
      else drawn = coverDraw(c.video, x, y, cw, ch, c.share);
    }
    if (!drawn) {
      recCtx.fillStyle = '#7c5cff'; recCtx.beginPath(); recCtx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.16, 0, Math.PI * 2); recCtx.fill();
      recCtx.fillStyle = '#fff'; recCtx.font = `700 ${Math.round(Math.min(cw, ch) * 0.16)}px system-ui, sans-serif`; recCtx.textAlign = 'center'; recCtx.textBaseline = 'middle';
      recCtx.fillText(initials(c.name), x + cw / 2, y + ch / 2 + 2);
    }
    recCtx.font = '600 22px system-ui, "Segoe UI", sans-serif'; recCtx.textAlign = 'left'; recCtx.textBaseline = 'alphabetic';
    const label = c.name, tw = recCtx.measureText(label).width + 20;
    recCtx.fillStyle = 'rgba(15,18,38,.78)'; recCtx.fillRect(x + 10, y + ch - 40, tw, 30);
    recCtx.fillStyle = '#eef0ff'; recCtx.fillText(label, x + 20, y + ch - 18);
  });
}
async function startRec() {
  recCanvas = document.createElement('canvas'); recCanvas.width = REC.w; recCanvas.height = REC.h;
  recCtx = recCanvas.getContext('2d', { alpha: false });
  const stream = recCanvas.captureStream(REC.fps);
  recActx = new AudioContext(); await recActx.resume().catch(() => {});
  recDest = recActx.createMediaStreamDestination(); syncRecAudio();
  recDest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4e6, audioBitsPerSecond: 128000 });
  recChunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  rec.onstop = finishRec;
  recWorker = new Worker('timer-worker.js'); recWorker.onmessage = drawRec;
  recWorker.postMessage({ cmd: 'start', interval: Math.round(1000 / REC.fps) });
  drawRec(); rec.start(1000);
  recording = true; broadcastMsg('rec', { on: true }); updateRecBanner(); refreshControls();
}
function stopRec() {
  if (!rec || rec.state === 'inactive') return;
  recording = false; rec.stop(); broadcastMsg('rec', { on: false }); updateRecBanner(); refreshControls();
}
function finishRec() {
  if (recWorker) { recWorker.postMessage({ cmd: 'stop' }); recWorker.terminate(); recWorker = null; }
  recNodes = []; if (recActx) { recActx.close().catch(() => {}); recActx = null; recDest = null; }
  const blob = new Blob(recChunks, { type: (rec.mimeType || 'video/webm').split(';')[0] });
  recChunks = [];
  if (recBlobUrl) URL.revokeObjectURL(recBlobUrl);
  recBlobUrl = URL.createObjectURL(blob);
  $('recDownload').href = recBlobUrl;
  $('recDownload').download = fileBase() + '.' + (blob.type.includes('mp4') ? 'mp4' : 'webm');
  $('recResult').hidden = false; addVideoShareButton($('recResult'), $('recDownload'));
  toast(t('room.rec.ready'));
  if (!inCall) showEnded();
}
$('recBtn').addEventListener('click', () => { if (recording) stopRec(); else startRec(); });

// ---------- leaving ----------
let endTime = 0;
function leave() {
  if (!inCall) return;
  endTime = Date.now();
  srWanted = false; pauseSR();
  if (sharing) { try { screenTrack.stop(); } catch (_) {} sharing = false; }
  const wasRecording = recording;
  if (wasRecording) { recording = false; rec.stop(); broadcastMsg('rec', { on: false }); }
  if (es) es.close();
  peers.forEach((p) => { try { p.pc && p.pc.close(); } catch (_) {} });
  peers.clear();
  if (localStream) localStream.getTracks().forEach((tr) => tr.stop());
  localStream = null; inCall = false; recording = false;
  document.body.classList.remove('in-call');
  if (!wasRecording) showEnded();
  else showEnded();
}
function showEnded() {
  $('call').hidden = true; $('lobby').hidden = true; $('ended').hidden = false;
  $('endedExports').appendChild($('exportBox'));
}
$('leaveBtn').addEventListener('click', leave);
$('rejoinBtn').addEventListener('click', () => { location.href = location.pathname + '?r=' + roomId; });
window.addEventListener('beforeunload', (e) => { if (inCall) { e.preventDefault(); e.returnValue = ''; } });

// ---------- language switch ----------
document.addEventListener('langchange', () => {
  refreshLobbyButtons(); if (inCall) { if (myTile) myTile.nameEl.textContent = `${myName} (${t('room.you')})`; refreshControls(); updateCount(); layoutGrid(); updateRecBanner(); renderItems(); }
  if (new URLSearchParams(location.search).get('r')) $('newMeeting').textContent = t('room.joinas');
});

initLobby();

// Share the generated video file through the device's native share sheet when supported.
function addVideoShareButton(container, downloadLink) {
  if (container.querySelector('.video-share-btn')) return;
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary video-share-btn'; btn.textContent = 'Share video';
  btn.addEventListener('click', async () => {
    try {
      const response = await fetch(downloadLink.href); const blob = await response.blob();
      const file = new File([blob], downloadLink.download || 'ScreenStudio-video.' + (blob.type.includes('mp4') ? 'mp4' : 'webm'), { type: blob.type || 'video/webm' });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) await navigator.share({ files: [file], title: 'ScreenStudio video' });
      else { downloadLink.click(); alert('Video sharing is not supported here. The video was downloaded so you can attach it in another app.'); }
    } catch (err) { if (err.name !== 'AbortError') alert('Could not share this video. Try downloading it first.'); }
  }); container.appendChild(btn);
}
