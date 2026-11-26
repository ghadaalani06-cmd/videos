/**
 * Free Recorder — Web App
 * Screen / Camera / Combined recording + self-hosted WebRTC meetings
 * Bilingual (EN / AR)
 */

const SIGNALING_URL = 'http://localhost:3001'; // change if you deploy the server elsewhere

// ---------- State ----------
let mediaRecorder = null;
let recordedChunks = [];
let currentStream = null;
let recordingStart = null;
let timerInterval = null;
let selectedSource = null;

// Meeting state
let socket = null;
let localStream = null;
let peers = new Map(); // peerId -> { pc, stream }
let isHost = false;
let roomCode = null;
let meetingRecorder = null;
let meetingChunks = [];
let isCamOn = true;
let isMicOn = true;
let screenStream = null;

// ---------- i18n helpers ----------
function setLanguage(lang) {
  setLang(lang);
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');
  document.getElementById('btn-ar').classList.toggle('active', lang === 'ar');
  refreshUI();
}

function refreshUI() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ---------- Recording (local) ----------
document.querySelectorAll('.source-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSource = btn.dataset.source;
    await startPreview(selectedSource);
    document.getElementById('btn-start').disabled = false;
  });
});

async function startPreview(source) {
  stopPreview();
  const withMic = document.getElementById('opt-mic').checked;
  try {
    if (source === 'screen') {
      currentStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: withMic
      });
    } else if (source === 'camera') {
      currentStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: withMic
      });
    } else if (source === 'both') {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const cam = await navigator.mediaDevices.getUserMedia({ video: true, audio: withMic });
      // Simple composite: we just use the screen stream for recording and keep camera for PiP later if needed.
      // For true PiP composite we would need a canvas — keep it simple for v1.
      currentStream = screen;
      // attach camera as secondary track if desired later
      cam.getVideoTracks().forEach(t => currentStream.addTrack(t));
      if (withMic) cam.getAudioTracks().forEach(t => currentStream.addTrack(t));
    }

    const video = document.getElementById('preview');
    video.srcObject = currentStream;
    video.classList.add('visible');
    document.getElementById('preview-placeholder').style.display = 'none';

    currentStream.getVideoTracks()[0].onended = () => {
      stopPreview();
      document.getElementById('btn-start').disabled = true;
    };
  } catch (err) {
    console.error(err);
    alert(t('permissionDenied') + '\n' + err.message);
  }
}

function stopPreview() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
  const video = document.getElementById('preview');
  video.srcObject = null;
  video.classList.remove('visible');
  document.getElementById('preview-placeholder').style.display = 'flex';
}

document.getElementById('btn-start').addEventListener('click', () => {
  if (!currentStream) return;
  recordedChunks = [];
  const options = { mimeType: 'video/webm;codecs=vp9,opus' };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options.mimeType = 'video/webm';
  }
  mediaRecorder = new MediaRecorder(currentStream, options);
  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    document.getElementById('btn-download').classList.remove('hidden');
    document.getElementById('rec-status').textContent = t('ready');
  };
  mediaRecorder.start(1000);
  recordingStart = Date.now();
  timerInterval = setInterval(updateRecTimer, 1000);
  document.getElementById('btn-start').classList.add('hidden');
  document.getElementById('btn-stop').classList.remove('hidden');
  document.getElementById('rec-status').textContent = t('recording');
});

document.getElementById('btn-stop').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  clearInterval(timerInterval);
  document.getElementById('btn-stop').classList.add('hidden');
  document.getElementById('btn-start').classList.remove('hidden');
});

document.getElementById('btn-download').addEventListener('click', () => {
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `recording-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.webm`;
  a.click();
  URL.revokeObjectURL(url);
});

function updateRecTimer() {
  const elapsed = Math.floor((Date.now() - recordingStart) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('rec-timer').textContent = `${m}:${s}`;
}

// ---------- Meeting / WebRTC ----------
function connectSocket() {
  if (socket) return;
  socket = io(SIGNALING_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    document.getElementById('server-status').textContent = 'Signaling: connected ✓';
  });
  socket.on('connect_error', () => {
    document.getElementById('server-status').textContent = 'Signaling: offline (start the server)';
  });

  socket.on('peer-joined', async ({ id }) => {
    console.log('Peer joined', id);
    await createPeerConnection(id, true);
  });

  socket.on('peer-left', ({ id }) => {
    removePeer(id);
  });

  socket.on('signal', async ({ from, data }) => {
    let peer = peers.get(from);
    if (!peer) {
      peer = await createPeerConnection(from, false);
    }
    const pc = peer.pc;
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { to: from, data: { sdp: pc.localDescription } });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (e) { /* ignore */ }
    }
  });
}

async function createPeerConnection(peerId, isInitiator) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('signal', { to: peerId, data: { candidate: e.candidate } });
    }
  };

  pc.ontrack = e => {
    const remoteStream = e.streams[0];
    let peer = peers.get(peerId);
    if (peer) peer.stream = remoteStream;
    renderRemoteVideo(peerId, remoteStream);
  };

  const peerObj = { pc, stream: null };
  peers.set(peerId, peerObj);

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: peerId, data: { sdp: pc.localDescription } });
  }

  return peerObj;
}

function removePeer(peerId) {
  const peer = peers.get(peerId);
  if (peer) {
    peer.pc.close();
    peers.delete(peerId);
  }
  const el = document.getElementById('video-' + peerId);
  if (el) el.remove();
}

function renderLocalVideo() {
  const grid = document.getElementById('videos-grid');
  let tile = document.getElementById('video-local');
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'video-local';
    tile.innerHTML = `<video autoplay muted playsinline></video><div class="video-label">${t('you')}</div>`;
    grid.prepend(tile);
  }
  const video = tile.querySelector('video');
  video.srcObject = localStream;
}

function renderRemoteVideo(peerId, stream) {
  const grid = document.getElementById('videos-grid');
  let tile = document.getElementById('video-' + peerId);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'video-' + peerId;
    tile.innerHTML = `<video autoplay playsinline></video><div class="video-label">${peerId.slice(0,6)}</div>`;
    grid.appendChild(tile);
  }
  tile.querySelector('video').srcObject = stream;
}

async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    renderLocalVideo();
  } catch (err) {
    console.warn('Camera/mic failed, trying audio only', err);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      renderLocalVideo();
    } catch (e2) {
      alert(t('noDevices'));
    }
  }
}

document.getElementById('btn-create-room').addEventListener('click', async () => {
  connectSocket();
  await startLocalMedia();
  socket.emit('create-room', (res) => {
    if (res.ok) {
      roomCode = res.code;
      isHost = true;
      enterMeetingUI();
    }
  });
});

document.getElementById('btn-join-room').addEventListener('click', async () => {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code) return;
  connectSocket();
  await startLocalMedia();
  socket.emit('join-room', { code }, async (res) => {
    if (!res.ok) {
      alert(res.error || 'Cannot join');
      return;
    }
    roomCode = res.code;
    enterMeetingUI();
    // create connections to existing peers
    for (const peerId of res.peers) {
      await createPeerConnection(peerId, true);
    }
  });
});

function enterMeetingUI() {
  document.getElementById('meeting-lobby').classList.add('hidden');
  document.getElementById('meeting-room').classList.remove('hidden');
  document.getElementById('room-code-display').textContent = roomCode;
  document.getElementById('meeting-status').textContent = t('meetingActive');
}

document.getElementById('btn-leave').addEventListener('click', () => {
  if (socket) socket.disconnect();
  socket = null;
  peers.forEach(p => p.pc.close());
  peers.clear();
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  document.getElementById('videos-grid').innerHTML = '';
  document.getElementById('meeting-room').classList.add('hidden');
  document.getElementById('meeting-lobby').classList.remove('hidden');
  roomCode = null;
});

document.getElementById('btn-copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText(roomCode).then(() => {
    const btn = document.getElementById('btn-copy-code');
    btn.textContent = t('copied');
    setTimeout(() => btn.textContent = t('copyCode'), 1500);
  });
});

document.getElementById('btn-toggle-cam').addEventListener('click', () => {
  if (!localStream) return;
  isCamOn = !isCamOn;
  localStream.getVideoTracks().forEach(t => t.enabled = isCamOn);
  document.getElementById('btn-toggle-cam').textContent = isCamOn ? t('cameraOn') : t('cameraOff');
});

document.getElementById('btn-toggle-mic').addEventListener('click', () => {
  if (!localStream) return;
  isMicOn = !isMicOn;
  localStream.getAudioTracks().forEach(t => t.enabled = isMicOn);
  document.getElementById('btn-toggle-mic').textContent = isMicOn ? t('mute') : t('unmute');
});

document.getElementById('btn-share-screen').addEventListener('click', async () => {
  try {
    if (screenStream) {
      // stop sharing
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
      // replace with camera again
      peers.forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && localStream) {
          const camTrack = localStream.getVideoTracks()[0];
          if (camTrack) sender.replaceTrack(camTrack);
        }
      });
      document.getElementById('btn-share-screen').textContent = t('shareScreen');
      return;
    }

    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    peers.forEach(({ pc }) => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    });
    // also update local preview
    const localVideo = document.querySelector('#video-local video');
    if (localVideo) localVideo.srcObject = screenStream;

    screenTrack.onended = () => {
      document.getElementById('btn-share-screen').click(); // stop
    };
    document.getElementById('btn-share-screen').textContent = t('stopShare');
  } catch (err) {
    console.error(err);
  }
});

// Local recording of the meeting (records the mixed view via canvas would be better, but for simplicity record local stream)
document.getElementById('btn-rec-meeting').addEventListener('click', () => {
  if (!localStream) return;
  meetingChunks = [];
  const opts = { mimeType: 'video/webm;codecs=vp9,opus' };
  if (!MediaRecorder.isTypeSupported(opts.mimeType)) opts.mimeType = 'video/webm';
  meetingRecorder = new MediaRecorder(localStream, opts);
  meetingRecorder.ondataavailable = e => { if (e.data.size) meetingChunks.push(e.data); };
  meetingRecorder.onstop = () => {
    const blob = new Blob(meetingChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-${roomCode}-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };
  meetingRecorder.start(1000);
  document.getElementById('btn-rec-meeting').classList.add('hidden');
  document.getElementById('btn-stop-rec-meeting').classList.remove('hidden');
});

document.getElementById('btn-stop-rec-meeting').addEventListener('click', () => {
  if (meetingRecorder && meetingRecorder.state !== 'inactive') {
    meetingRecorder.stop();
  }
  document.getElementById('btn-stop-rec-meeting').classList.add('hidden');
  document.getElementById('btn-rec-meeting').classList.remove('hidden');
});

// ---------- Init ----------
window.refreshUI = refreshUI;
const savedLang = localStorage.getItem('lang') || 'en';
setLanguage(savedLang);
connectSocket(); // just to show server status early