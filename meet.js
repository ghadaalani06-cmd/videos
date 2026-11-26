/**
 * Self-hosted WebRTC meetings for the Screen Recorder extension.
 * Configurable Socket.IO signaling server. Peer-to-peer media. Local recording.
 */

const $ = (id) => document.getElementById(id);

const el = {
  lobby: $('lobby'),
  room: $('room'),
  createBtn: $('createBtn'),
  joinBtn: $('joinBtn'),
  roomInput: $('roomInput'),
  copyBtn: $('copyBtn'),
  status: $('status'),
  serverUrl: $('serverUrl'),
  saveServer: $('saveServer'),
  roomCode: $('roomCode'),
  roomStatus: $('roomStatus'),
  leaveBtn: $('leaveBtn'),
  videos: $('videos'),
  toggleCam: $('toggleCam'),
  toggleMic: $('toggleMic'),
  shareScreen: $('shareScreen'),
  recBtn: $('recBtn'),
  stopRecBtn: $('stopRecBtn'),
  connStatus: $('connStatus'),
  recTimer: $('recTimer'),
};

let socket = null;
let localStream = null;
let screenStream = null;
let peers = new Map();
let roomCode = null;
let isCamOn = true;
let isMicOn = true;
let sharingScreen = false;
let mediaRecorder = null;
let recChunks = [];
let recStarted = 0;
let recTimerId = null;

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function say(msg, isError = false) {
  el.status.textContent = msg || '';
  el.status.classList.toggle('error', isError);
}

function getServerUrl() {
  return localStorage.getItem('meetServerUrl') || 'http://localhost:3001';
}

function setServerUrl(url) {
  localStorage.setItem('meetServerUrl', url.replace(/\/$/, ''));
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

// ---------- server URL ----------
el.serverUrl.value = getServerUrl();
el.saveServer.addEventListener('click', () => {
  const url = el.serverUrl.value.trim();
  if (!url) return;
  setServerUrl(url);
  say('Server URL saved. You can create or join a room now.');
  if (socket) { socket.disconnect(); socket = null; }
});

// ---------- socket ----------
function ensureSocket() {
  if (socket && socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const url = getServerUrl();
    if (socket) socket.disconnect();
    socket = io(url, { transports: ['websocket', 'polling'], timeout: 8000 });

    const onConnect = () => {
      cleanup();
      el.connStatus.textContent = 'Signaling connected';
      el.connStatus.className = 'ok';
      resolve();
    };
    const onError = () => {
      cleanup();
      el.connStatus.textContent = 'Signaling offline';
      el.connStatus.className = 'bad';
      reject(new Error('Cannot reach signaling server at ' + url));
    };
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);

    socket.on('peer-joined', async ({ id }) => {
      await createPeer(id, true);
      el.roomStatus.textContent = 'Participant joined';
    });
    socket.on('peer-left', ({ id }) => {
      removePeer(id);
      el.roomStatus.textContent = 'Participant left';
    });
    socket.on('signal', async ({ from, data }) => {
      let peer = peers.get(from);
      if (!peer) peer = await createPeer(from, false);
      const pc = peer.pc;
      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { to: from, data: { sdp: pc.localDescription } });
          }
        } else if (data.candidate) {
          await pc.addIceCandidate(data.candidate);
        }
      } catch (e) {
        console.warn('signal error', e);
      }
    });
  });
}

// ---------- media ----------
async function startLocalMedia() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      say('Camera unavailable — audio only.', true);
    } catch (e2) {
      throw new Error('Camera and microphone are blocked.');
    }
  }
  addLocalTile();
  return localStream;
}

function addLocalTile() {
  let tile = document.getElementById('tile-local');
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'tile';
    tile.id = 'tile-local';
    tile.innerHTML = '<video autoplay muted playsinline></video><div class="label">You</div>';
    el.videos.prepend(tile);
  }
  tile.querySelector('video').srcObject = localStream;
}

function addRemoteTile(peerId, stream) {
  let tile = document.getElementById('tile-' + peerId);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'tile';
    tile.id = 'tile-' + peerId;
    tile.innerHTML = '<video autoplay playsinline></video><div class="label">' + peerId.slice(0, 6) + '</div>';
    el.videos.appendChild(tile);
  }
  tile.querySelector('video').srcObject = stream;
}

// ---------- WebRTC ----------
async function createPeer(peerId, isInitiator) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(ICE);

  if (localStream) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('signal', { to: peerId, data: { candidate: e.candidate } });
  };

  pc.ontrack = (e) => {
    const stream = e.streams[0];
    const peer = peers.get(peerId);
    if (peer) peer.stream = stream;
    addRemoteTile(peerId, stream);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removePeer(peerId);
    }
  };

  const peer = { pc, stream: null };
  peers.set(peerId, peer);

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: peerId, data: { sdp: pc.localDescription } });
  }

  return peer;
}

function removePeer(peerId) {
  const peer = peers.get(peerId);
  if (peer) {
    peer.pc.close();
    peers.delete(peerId);
  }
  const tile = document.getElementById('tile-' + peerId);
  if (tile) tile.remove();
}

// ---------- room actions ----------
el.createBtn.addEventListener('click', async () => {
  el.createBtn.disabled = true;
  say('Connecting…');
  try {
    await ensureSocket();
    await startLocalMedia();
    socket.emit('create-room', (res) => {
      if (!res || !res.ok) {
        say((res && res.error) || 'Could not create room', true);
        el.createBtn.disabled = false;
        return;
      }
      roomCode = res.code;
      enterRoom();
    });
  } catch (e) {
    say(e.message, true);
    el.createBtn.disabled = false;
  }
});

el.joinBtn.addEventListener('click', async () => {
  const code = el.roomInput.value.trim().toUpperCase();
  if (!code) {
    say('Enter a room code first.', true);
    return;
  }
  el.joinBtn.disabled = true;
  say('Joining…');
  try {
    await ensureSocket();
    await startLocalMedia();
    socket.emit('join-room', { code }, async (res) => {
      if (!res || !res.ok) {
        say((res && res.error) || 'Room not found', true);
        el.joinBtn.disabled = false;
        return;
      }
      roomCode = res.code;
      enterRoom();
      for (const id of res.peers || []) {
        await createPeer(id, true);
      }
    });
  } catch (e) {
    say(e.message, true);
    el.joinBtn.disabled = false;
  }
});

el.roomInput.addEventListener('input', () => {
  el.copyBtn.disabled = !el.roomInput.value.trim();
});

el.copyBtn.addEventListener('click', async () => {
  const code = (el.roomInput.value || roomCode || '').trim().toUpperCase();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    say('Room code copied. Share it with participants.');
  } catch (_) {
    say('Code: ' + code);
  }
});

function enterRoom() {
  el.lobby.hidden = true;
  el.room.hidden = false;
  el.roomCode.textContent = roomCode;
  el.roomStatus.textContent = 'Waiting for others…';
  el.roomInput.value = roomCode;
  el.copyBtn.disabled = false;
  document.body.classList.add('recording');
  say('');
}

el.leaveBtn.addEventListener('click', leaveRoom);

function leaveRoom() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  peers.forEach((p) => p.pc.close());
  peers.clear();
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  el.videos.innerHTML = '';
  el.room.hidden = true;
  el.lobby.hidden = false;
  el.createBtn.disabled = false;
  el.joinBtn.disabled = false;
  roomCode = null;
  sharingScreen = false;
  el.shareScreen.textContent = 'Share screen';
  document.body.classList.remove('recording');
  say('Left the meeting.');
}

// ---------- in-room controls ----------
el.toggleCam.addEventListener('click', () => {
  if (!localStream) return;
  isCamOn = !isCamOn;
  localStream.getVideoTracks().forEach((t) => (t.enabled = isCamOn));
  el.toggleCam.textContent = isCamOn ? 'Camera on' : 'Camera off';
});

el.toggleMic.addEventListener('click', () => {
  if (!localStream) return;
  isMicOn = !isMicOn;
  localStream.getAudioTracks().forEach((t) => (t.enabled = isMicOn));
  el.toggleMic.textContent = isMicOn ? 'Mic on' : 'Mic muted';
});

el.shareScreen.addEventListener('click', async () => {
  if (sharingScreen) {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    const camTrack = localStream && localStream.getVideoTracks()[0];
    peers.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender && camTrack) sender.replaceTrack(camTrack);
    });
    const localVideo = document.querySelector('#tile-local video');
    if (localVideo && localStream) localVideo.srcObject = localStream;
    sharingScreen = false;
    el.shareScreen.textContent = 'Share screen';
    return;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = screenStream.getVideoTracks()[0];
    peers.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    });
    const localVideo = document.querySelector('#tile-local video');
    if (localVideo) localVideo.srcObject = screenStream;
    screenTrack.onended = () => el.shareScreen.click();
    sharingScreen = true;
    el.shareScreen.textContent = 'Stop sharing';
  } catch (e) {
    if (e.name !== 'NotAllowedError') say('Screen share failed: ' + e.message, true);
  }
});

// ---------- local recording ----------
el.recBtn.addEventListener('click', () => {
  if (!localStream) return;
  recChunks = [];
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';
  mediaRecorder = new MediaRecorder(localStream, { mimeType: mime, videoBitsPerSecond: 4e6 });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size) recChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meeting-' + (roomCode || 'rec') + '-' + Date.now() + '.webm';
    a.click();
    URL.revokeObjectURL(url);
    clearInterval(recTimerId);
    el.recTimer.textContent = '';
  };
  mediaRecorder.start(1000);
  recStarted = Date.now();
  recTimerId = setInterval(() => {
    el.recTimer.textContent = 'REC ' + fmt(Date.now() - recStarted);
  }, 500);
  el.recBtn.hidden = true;
  el.stopRecBtn.hidden = false;
});

el.stopRecBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  el.stopRecBtn.hidden = true;
  el.recBtn.hidden = false;
});

say('Set the signaling server URL, then create or join a room.');
