/**
 * LiveKit Cloud meetings (token from our server /api/livekit-token)
 */
const $ = (id) => document.getElementById(id);
const el = {
  lobby: $('lobby'), room: $('room'),
  createBtn: $('createBtn'), joinBtn: $('joinBtn'),
  roomInput: $('roomInput'), copyBtn: $('copyBtn'), status: $('status'),
  roomCode: $('roomCode'), roomStatus: $('roomStatus'), leaveBtn: $('leaveBtn'),
  videos: $('videos'),
  toggleCam: $('toggleCam'), toggleMic: $('toggleMic'), shareScreen: $('shareScreen'),
  recBtn: $('recBtn'), stopRecBtn: $('stopRecBtn'),
  connStatus: $('connStatus'), recTimer: $('recTimer'),
};

let room = null;          // LiveKit Room
let localVideoTrack = null;
let localAudioTrack = null;
let screenTrack = null;
let roomName = null;
let isCamOn = true;
let isMicOn = true;
let mediaRecorder = null;
let recChunks = [];
let recTimerId = null;
let recStarted = 0;
let localMediaStream = null; // for local recording

function say(msg, isError = false) {
  el.status.textContent = msg || '';
  el.status.classList.toggle('error', isError);
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
}
function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

async function fetchToken(roomName, identity) {
  const res = await fetch('/api/livekit-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: roomName, identity }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Token request failed');
  return data;
}

function ensureTile(id, label, muted = false) {
  let tile = document.getElementById('tile-' + id);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'tile';
    tile.id = 'tile-' + id;
    tile.innerHTML = '<video autoplay playsinline ' + (muted ? 'muted' : '') + '></video><div class="label"></div>';
    el.videos.appendChild(tile);
  }
  tile.querySelector('.label').textContent = label;
  return tile.querySelector('video');
}

function attachTrack(track, participant) {
  if (track.kind !== 'video' && track.kind !== 'audio') return;
  const id = participant.identity + '-' + track.sid;
  if (track.kind === 'video') {
    const videoEl = ensureTile(id, participant.identity === room?.localParticipant?.identity ? 'You' : participant.identity);
    track.attach(videoEl);
  } else {
    // audio: attach to a hidden audio element or the existing video tile
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.dataset.sid = track.sid;
    document.body.appendChild(audioEl);
    track.attach(audioEl);
  }
}

function detachTrack(track) {
  track.detach().forEach((el) => {
    el.remove();
  });
  // remove empty video tiles
  document.querySelectorAll('.tile').forEach((tile) => {
    const v = tile.querySelector('video');
    if (v && !v.srcObject) tile.remove();
  });
}

async function joinLiveKit(name) {
  const identity = 'user-' + Math.random().toString(36).slice(2, 8);
  el.connStatus.textContent = 'Requesting token…';
  const { token, url } = await fetchToken(name, identity);

  const LK = window.LivekitClient || window.livekit;
  if (!LK || !LK.Room) throw new Error('LiveKit client SDK failed to load');

  room = new LK.Room({ adaptiveStream: true, dynacast: true });

  room.on(LK.RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    attachTrack(track, participant);
  });
  room.on(LK.RoomEvent.TrackUnsubscribed, (track) => {
    detachTrack(track);
  });
  room.on(LK.RoomEvent.ParticipantDisconnected, (participant) => {
    document.querySelectorAll('[id^="tile-' + participant.identity + '"]').forEach((n) => n.remove());
    el.roomStatus.textContent = participant.identity + ' left';
  });
  room.on(LK.RoomEvent.Disconnected, () => {
    el.connStatus.textContent = 'Disconnected';
    el.connStatus.className = 'bad';
  });

  await room.connect(url, token);
  el.connStatus.textContent = 'Connected (LiveKit)';
  el.connStatus.className = 'ok';

  // publish camera + mic
  const tracks = await LK.createLocalTracks({ audio: true, video: true });
  for (const track of tracks) {
    await room.localParticipant.publishTrack(track);
    if (track.kind === 'video') {
      localVideoTrack = track;
      const v = ensureTile('local', 'You', true);
      track.attach(v);
    }
    if (track.kind === 'audio') localAudioTrack = track;
  }

  // media stream for local recording
  localMediaStream = new MediaStream(
    tracks.map((t) => t.mediaStreamTrack).filter(Boolean)
  );

  roomName = name;
  el.lobby.hidden = true;
  el.room.hidden = false;
  el.roomCode.textContent = name;
  el.roomStatus.textContent = 'In meeting';
  el.roomInput.value = name;
  el.copyBtn.disabled = false;
  document.body.classList.add('recording');
  say('');
}

async function startMeeting(create) {
  const name = (el.roomInput.value.trim() || (create ? randomCode() : '')).toUpperCase();
  if (!name) {
    say('Enter a room code to join.', true);
    return;
  }
  el.createBtn.disabled = true;
  el.joinBtn.disabled = true;
  say(create ? 'Creating room…' : 'Joining…');
  try {
    await joinLiveKit(name);
  } catch (e) {
    console.error(e);
    say(e.message || 'Could not connect', true);
    el.createBtn.disabled = false;
    el.joinBtn.disabled = false;
  }
}

el.createBtn.addEventListener('click', () => startMeeting(true));
el.joinBtn.addEventListener('click', () => startMeeting(false));

el.roomInput.addEventListener('input', () => {
  el.copyBtn.disabled = !el.roomInput.value.trim();
});
el.copyBtn.addEventListener('click', async () => {
  const code = (el.roomInput.value || roomName || '').trim().toUpperCase();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    say('Room code copied.');
  } catch (_) {
    say('Code: ' + code);
  }
});

el.leaveBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (room) {
    await room.disconnect();
    room = null;
  }
  localVideoTrack = localAudioTrack = screenTrack = null;
  localMediaStream = null;
  el.videos.innerHTML = '';
  document.querySelectorAll('audio[data-sid]').forEach((a) => a.remove());
  el.room.hidden = true;
  el.lobby.hidden = false;
  el.createBtn.disabled = false;
  el.joinBtn.disabled = false;
  document.body.classList.remove('recording');
  say('Left the meeting.');
});

el.toggleCam.addEventListener('click', async () => {
  if (!localVideoTrack) return;
  isCamOn = !isCamOn;
  if (typeof localVideoTrack.setEnabled === 'function') {
    await localVideoTrack.setEnabled(isCamOn);
  } else if (localVideoTrack.mediaStreamTrack) {
    localVideoTrack.mediaStreamTrack.enabled = isCamOn;
  }
  el.toggleCam.textContent = isCamOn ? 'Camera on' : 'Camera off';
});

el.toggleMic.addEventListener('click', async () => {
  if (!localAudioTrack) return;
  isMicOn = !isMicOn;
  if (typeof localAudioTrack.setEnabled === 'function') {
    await localAudioTrack.setEnabled(isMicOn);
  } else {
    localAudioTrack.mediaStreamTrack.enabled = isMicOn;
  }
  el.toggleMic.textContent = isMicOn ? 'Mic on' : 'Mic muted';
});

el.shareScreen.addEventListener('click', async () => {
  const LK = window.LivekitClient || window.livekit;
  if (!room || !LK) return;

  if (screenTrack) {
    await room.localParticipant.unpublishTrack(screenTrack);
    screenTrack.stop();
    screenTrack = null;
    el.shareScreen.textContent = 'Share screen';
    return;
  }

  try {
    screenTrack = await LK.createLocalScreenTracks({ audio: false }).then((arr) => arr[0]);
    await room.localParticipant.publishTrack(screenTrack);
    el.shareScreen.textContent = 'Stop sharing';
    screenTrack.mediaStreamTrack.onended = () => el.shareScreen.click();
  } catch (e) {
    if (e.name !== 'NotAllowedError') say('Screen share failed: ' + e.message, true);
  }
});

el.recBtn.addEventListener('click', () => {
  const stream = localMediaStream;
  if (!stream) {
    say('No local media to record yet.', true);
    return;
  }
  recChunks = [];
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus' : 'video/webm';
  mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4e6 });
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meeting-' + (roomName || 'rec') + '-' + Date.now() + '.webm';
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

// health check
fetch('/api/health').then((r) => r.json()).then((h) => {
  if (h.livekit) {
    el.connStatus.textContent = 'LiveKit ready';
    el.connStatus.className = 'ok';
    say('LiveKit is configured. Create or join a room.');
  } else {
    el.connStatus.textContent = 'LiveKit not configured';
    el.connStatus.className = 'bad';
    say('Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET on the server, then restart.', true);
  }
}).catch(() => {
  say('Server offline — start the Node server to use meetings.', true);
});
