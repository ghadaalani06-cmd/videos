// Screen Recorder – no time limit. Recording lives in this tab, so keep it open (it can be in the background).
const $ = (id) => document.getElementById(id);

const el = {
  screen: $('screen'), preview: $('preview'), badge: $('badge'), badgeText: $('badgeText'),
  time: $('time'), size: $('size'), msg: $('msg'),
  sysAudio: $('sysAudio'), mic: $('mic'), quality: $('quality'), fps: $('fps'),
  format: $('format'), countdown: $('countdown'),
  pickFile: $('pickFile'), diskGroup: $('diskGroup'),
  start: $('start'), live: $('live'), pause: $('pause'), stop: $('stop'),
  result: $('result'), download: $('download'), discard: $('discard'), settings: $('settings'),
  camera: $('camera'), camOptions: $('camOptions'), layout: $('layout'), position: $('position'),
  shape: $('shape'), mirror: $('mirror'), cameraLook: $('cameraLook'), canvas: $('composite'),
  posField: $('posField'), shapeField: $('shapeField'),
  source: $('source'), floatBtn: $('floatBtn'),
  isolation: $('isolation'), micOptions: $('micOptions'), meterWrap: $('meterWrap'), meterBar: $('meterBar'),
};

const FORMATS = [
  { label: 'WebM (VP9) – recommended', mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { label: 'WebM (VP8)', mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { label: 'MP4 (H.264)', mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
  { label: 'MP4 (H.264)', mime: 'video/mp4', ext: 'mp4' },
];
const BITRATES = { 720: 4e6, 1080: 8e6, 1440: 14e6, 2160: 28e6 };
const HEIGHTS = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };

let displayStream = null, micStream = null, audioCtx = null, recorder = null;
let chunks = [], bytes = 0, fileHandle = null, writable = null, writeChain = Promise.resolve();
let startedAt = 0, pausedTotal = 0, pausedAt = 0, timer = null, blobUrl = null, currentExt = 'webm';
let recording = false, paused = false;
let camStream = null, camVideo = null, screenVideo = null, canvasStream = null, ctx2d = null;
let compositing = false, timerWorker = null;

// ---------- setup ----------
(function init() {
  const seen = new Set();
  for (const f of FORMATS) {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(f.mime)) continue;
    const key = f.ext + f.label;
    if (seen.has(key)) continue;
    seen.add(key);
    const o = document.createElement('option');
    o.value = f.mime; o.textContent = f.label; o.dataset.ext = f.ext;
    el.format.appendChild(o);
  }
  if (!el.format.options.length) say('This browser cannot record video.', true);
  if (!window.showSaveFilePicker) el.diskGroup.hidden = true;
})();

function say(text, isError = false) {
  el.msg.textContent = text;
  el.msg.classList.toggle('error', isError);
}
const pad = (n) => String(n).padStart(2, '0');
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function fmtSize(b) {
  return b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB';
}
function elapsed() {
  return (paused ? pausedAt : Date.now()) - startedAt - pausedTotal;
}
function notifyBackground() {
  // web app: no extension badge
}

// ---------- save-to-disk (optional, for very long recordings) ----------
el.pickFile.addEventListener('click', async () => {
  try {
    const mime = el.format.value;
    const ext = el.format.selectedOptions[0]?.dataset.ext || 'webm';
    fileHandle = await window.showSaveFilePicker({
      suggestedName: `recording-${stamp()}.${ext}`,
      types: [{ description: 'Video', accept: { [mime.split(';')[0]]: ['.' + ext] } }],
    });
    el.pickFile.textContent = 'Saving to: ' + fileHandle.name;
    el.pickFile.classList.add('set');
    say('Recording will be written directly to that file.');
  } catch (e) {
    if (e.name !== 'AbortError') say('Could not open that file: ' + e.message, true);
  }
});

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// ---------- start ----------
el.start.addEventListener('click', startRecording);

async function startRecording() {
  if (recording) return;
  say('');
  el.start.disabled = true;
  try {
    const [w, h] = HEIGHTS[el.quality.value];
    const fps = Number(el.fps.value);

    // Must be called straight from the click so the browser shows the picker.
    const videoConstraints = {
      frameRate: { ideal: fps },
      width: { ideal: w },
      height: { ideal: h },
    };
    // Prefer preferred surface but never fail the whole call if unsupported
    if (el.source.value) {
      try { videoConstraints.displaySurface = el.source.value; } catch (_) {}
    }
    const displayOpts = {
      video: videoConstraints,
      audio: !!el.sysAudio.checked,
    };
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia(displayOpts);
    } catch (err) {
      // Retry with minimal constraints (max compatibility)
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: !!el.sysAudio.checked,
      });
    }

    if (el.mic.checked) {
      try {
        const iso = el.isolation.value;
        const on = iso !== 'off';
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: on,
            noiseSuppression: on,
            autoGainControl: on,
            voiceIsolation: iso === 'strong',
          },
        });
      } catch (e) {
        say('Microphone blocked, recording without it.', true);
        el.mic.checked = false;
      }
    }

    if (el.camera.checked) {
      try {
        await startCompositor();
      } catch (e) {
        stopCompositor();
        say('Camera unavailable (' + (e.message || e.name) + '). Recording screen only.', true);
        el.camera.checked = false;
        el.camOptions.hidden = true;
      }
    }
    if (compositing) {
      el.screen.classList.add('has-canvas', 'has-video');
    } else {
      el.preview.srcObject = displayStream;
      el.preview.play().catch(() => {});
      el.screen.classList.add('has-video');
    }

    if (el.countdown.checked) await runCountdown();
    if (displayStream.getVideoTracks()[0].readyState === 'ended') throw new Error('Sharing was stopped.');

    const finalStream = await buildStream();
    const mime = el.format.value;
    currentExt = el.format.selectedOptions[0]?.dataset.ext || 'webm';

    recorder = new MediaRecorder(finalStream, {
      mimeType: mime,
      videoBitsPerSecond: BITRATES[el.quality.value],
      audioBitsPerSecond: 128000,
    });

    chunks = []; bytes = 0; pausedTotal = 0;
    writable = null; writeChain = Promise.resolve();
    if (fileHandle) writable = await fileHandle.createWritable();

    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      bytes += e.data.size;
      if (writable) {
        writeChain = writeChain.then(() => writable.write(e.data)).catch((err) => say('Disk write failed: ' + err.message, true));
      } else {
        chunks.push(e.data);
      }
    };
    recorder.onstop = finalize;
    recorder.onerror = (e) => say('Recorder error: ' + (e.error?.message || 'unknown'), true);

    displayStream.getVideoTracks()[0].addEventListener('ended', () => stopRecording());

    recorder.start(1000);
    recording = true; paused = false;
    startedAt = Date.now();
    timer = setInterval(tick, 250);
    setUI('recording');
    notifyBackground();
    say('Recording. You can switch to other tabs and windows; keep this tab open.');
  } catch (e) {
    cleanupStreams();
    el.screen.classList.remove('has-video');
    el.start.disabled = false;
    say(e.name === 'NotAllowedError' ? 'Screen sharing was cancelled.' : 'Could not start: ' + e.message, e.name !== 'NotAllowedError');
  }
}

async function buildStream() {
  const videoTracks = compositing ? canvasStream.getVideoTracks() : displayStream.getVideoTracks();
  const sysTracks = displayStream.getAudioTracks();
  const micTracks = micStream ? micStream.getAudioTracks() : [];
  let audioTracks = [];
  if (sysTracks.length || micTracks.length) {
    audioCtx = new AudioContext();
    await audioCtx.resume().catch(() => {});
    const dest = audioCtx.createMediaStreamDestination();
    if (sysTracks.length) audioCtx.createMediaStreamSource(new MediaStream(sysTracks)).connect(dest);
    if (micTracks.length) await connectMic(new MediaStream(micTracks), dest);
    audioTracks = dest.stream.getAudioTracks();
  } else if (el.sysAudio.checked) {
    say('No audio was shared. Tick "Share audio" in the picker to capture sound.');
  }
  return new MediaStream([...videoTracks, ...audioTracks]);
}

function runCountdown() {
  return new Promise((resolve) => {
    let n = 3;
    const tickCount = () => {
      if (n === 0) { resolve(); return; }
      say(`Starting in ${n}…`);
      n--;
      setTimeout(tickCount, 1000);
    };
    tickCount();
  });
}

// ---------- controls ----------
el.pause.addEventListener('click', () => {
  if (!recorder) return;
  if (!paused) {
    recorder.pause(); paused = true; pausedAt = Date.now();
    el.pause.textContent = 'Resume';
    el.badge.classList.add('paused'); el.badgeText.textContent = 'PAUSED';
    syncFloat();
  } else {
    recorder.resume(); paused = false; pausedTotal += Date.now() - pausedAt;
    el.pause.textContent = 'Pause';
    el.badge.classList.remove('paused'); el.badgeText.textContent = 'REC';
    syncFloat();
  }
  notifyBackground();
});
el.stop.addEventListener('click', stopRecording);

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  recorder.stop();
}

function tick() {
  el.time.textContent = fmtTime(elapsed());
  el.size.textContent = fmtSize(bytes);
  syncFloat();
}

async function finalize() {
  clearInterval(timer);
  closeFloat();
  tick();
  recording = false; paused = false;
  notifyBackground();
  cleanupStreams();
  el.preview.srcObject = null;
  el.screen.classList.remove('has-video');

  if (writable) {
    try {
      await writeChain;
      await writable.close();
      say(`Saved to ${fileHandle.name} (${fmtSize(bytes)}).`);
    } catch (e) {
      say('Could not finish the file: ' + e.message, true);
    }
    writable = null; fileHandle = null;
    el.pickFile.textContent = 'Save straight to a file';
    el.pickFile.classList.remove('set');
    setUI('idle');
    return;
  }

  const blob = new Blob(chunks, { type: el.format.value.split(';')[0] });
  chunks = [];
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(blob);
  lastBlob = blob;
  el.preview.src = blobUrl;
  el.preview.muted = false;
  el.preview.controls = true;
  el.screen.classList.add('has-video');
  el.download.href = blobUrl;
  el.download.download = `recording-${stamp()}.${currentExt}`;
  setUI('done');
  say(`Finished: ${fmtTime(elapsed())}, ${fmtSize(blob.size)}.`);
}

el.discard.addEventListener('click', () => {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
  el.preview.removeAttribute('src');
  el.preview.controls = false; el.preview.muted = true;
  el.screen.classList.remove('has-video');
  el.time.textContent = '00:00:00'; el.size.textContent = '0 MB';
  setUI('idle'); say('');
});

function cleanupStreams() {
  stopMeter();
  stopCompositor();
  el.screen.classList.remove('has-canvas');
  [displayStream, micStream].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
  displayStream = micStream = null;
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
}

function setUI(mode) {
  document.body.classList.toggle('recording', mode === 'recording');
  const idle = mode === 'idle';
  el.start.hidden = !idle;
  el.start.disabled = !idle;
  el.live.hidden = mode !== 'recording';
  el.floatBtn.hidden = mode !== 'recording' || !window.documentPictureInPicture;
  el.badge.hidden = mode !== 'recording';
  el.badge.classList.remove('paused'); el.badgeText.textContent = 'REC';
  el.pause.textContent = 'Pause';
  el.result.hidden = mode !== 'done';
  el.settings.querySelectorAll('input,select').forEach((i) => (i.disabled = !idle && !i.closest('#camOptions')));
  el.pickFile.disabled = !idle;
}

window.addEventListener('beforeunload', (e) => {
  if (recording) { e.preventDefault(); e.returnValue = ''; }
});


// ---------- camera overlay ----------
function syncCamUI() {
  const L = el.layout.value;
  el.camOptions.hidden = !el.camera.checked;
  const bubble = L === 'small' || L === 'big';
  el.posField.hidden = !bubble;
  el.shapeField.hidden = !bubble;
}
el.camera.addEventListener('change', syncCamUI);
el.layout.addEventListener('change', syncCamUI);
syncCamUI();

function hiddenVideo(stream) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.srcObject = stream;
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  v.play().catch(() => {});
  return v;
}
function videoReady(v) {
  return new Promise((resolve) => {
    if (v.readyState >= 2 && v.videoWidth) return resolve();
    const done = () => resolve();
    v.addEventListener('loadeddata', done, { once: true });
    setTimeout(done, 3000);
  });
}

async function startCompositor() {
  camStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
  camVideo = hiddenVideo(camStream);
  screenVideo = hiddenVideo(displayStream);
  await Promise.all([videoReady(camVideo), videoReady(screenVideo)]);

  const s = displayStream.getVideoTracks()[0].getSettings();
  let W = s.width || screenVideo.videoWidth || 1920;
  let H = s.height || screenVideo.videoHeight || 1080;
  const maxH = HEIGHTS[el.quality.value][1];
  if (H > maxH) { W = Math.round(W * maxH / H); H = maxH; }
  el.canvas.width = W - (W % 2);
  el.canvas.height = H - (H % 2);
  ctx2d = el.canvas.getContext('2d', { alpha: false });
  canvasStream = el.canvas.captureStream(Number(el.fps.value));

  compositing = true;
  timerWorker = new Worker('timer-worker.js');
  timerWorker.onmessage = drawFrame;
  timerWorker.postMessage({ cmd: 'start', interval: Math.round(1000 / Number(el.fps.value)) });
  drawFrame();
}

function stopCompositor() {
  compositing = false;
  if (timerWorker) { timerWorker.postMessage({ cmd: 'stop' }); timerWorker.terminate(); timerWorker = null; }
  [camVideo, screenVideo].forEach((v) => { if (v) { v.srcObject = null; v.remove(); } });
  camVideo = screenVideo = null;
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  if (canvasStream) { canvasStream.getTracks().forEach((t) => t.stop()); canvasStream = null; }
}

function drawCover(v, x, y, w, h, mirror) {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(w / vw, h / vh);
  const sw = w / scale, sh = h / scale;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
  ctx2d.save();
  if (mirror) { ctx2d.translate(x + w, y); ctx2d.scale(-1, 1); ctx2d.drawImage(v, sx, sy, sw, sh, 0, 0, w, h); }
  else ctx2d.drawImage(v, sx, sy, sw, sh, x, y, w, h);
  ctx2d.restore();
}
function drawContain(v, x, y, w, h) {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.min(w / vw, h / vh);
  const dw = vw * scale, dh = vh * scale;
  ctx2d.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawCameraCover(x, y, w, h, mirror) {
  const look = el.cameraLook?.value || 'none';
  ctx2d.save();
  if (look === 'soft') ctx2d.filter = 'blur(1.2px)';
  else if (look === 'mono') ctx2d.filter = 'grayscale(1)';
  else if (look === 'warm') ctx2d.filter = 'sepia(.22) saturate(1.18)';
  drawCover(camVideo, x, y, w, h, mirror);
  ctx2d.restore();
}

function drawFrame() {
  if (!compositing || !ctx2d) return;
  const W = el.canvas.width, H = el.canvas.height;
  const L = el.layout.value, mirror = el.mirror.checked;
  ctx2d.fillStyle = '#0d1620';
  ctx2d.fillRect(0, 0, W, H);

  if (L === 'camera') {
    drawCameraCover(0, 0, W, H, mirror);
  } else if (L === 'side') {
    const camW = Math.round(W * 0.3);
    drawContain(screenVideo, 0, 0, W - camW, H);
    drawCameraCover(W - camW, 0, camW, H, mirror);
  } else {
    drawContain(screenVideo, 0, 0, W, H);
    const d = Math.round(H * (L === 'big' ? 0.44 : 0.26));
    const bw = el.shape.value === 'circle' ? d : Math.round(d * 1.33);
    const m = Math.round(W * 0.02);
    const pos = el.position.value;
    const x = pos.endsWith('r') ? W - bw - m : m;
    const y = pos.startsWith('b') ? H - d - m : m;
    ctx2d.save();
    ctx2d.beginPath();
    if (el.shape.value === 'circle') ctx2d.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
    else ctx2d.roundRect(x, y, bw, d, d * 0.14);
    ctx2d.clip();
    drawCameraCover(x, y, bw, d, mirror);
    ctx2d.restore();
    ctx2d.beginPath();
    if (el.shape.value === 'circle') ctx2d.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
    else ctx2d.roundRect(x, y, bw, d, d * 0.14);
    ctx2d.lineWidth = Math.max(3, W * 0.003);
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.stroke();
  }
}


// ---------- floating always-on-top controls (so you can stop while working in VS Code etc.) ----------
let pipWin = null, pipTime = null, pipPause = null;

el.floatBtn.addEventListener('click', async () => {
  if (pipWin) { closeFloat(); return; }
  try {
    pipWin = await documentPictureInPicture.requestWindow({ width: 280, height: 120 });
  } catch (e) {
    say('Floating controls are not available: ' + e.message, true);
    return;
  }
  const d = pipWin.document;
  const style = d.createElement('style');
  style.textContent = `
    body{margin:0;padding:12px;background:#0f1226;color:#eef0ff;font-family:system-ui,"Segoe UI",sans-serif;display:grid;gap:10px}
    .t{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;letter-spacing:-.02em}
    .r{display:grid;grid-template-columns:1fr 1.4fr;gap:8px}
    button{font:inherit;font-weight:600;padding:9px;border-radius:8px;border:1px solid #2a2f5e;background:#1f2348;color:#fff;cursor:pointer}
    button.s{background:#e8204a;border-color:#e8204a}
    button:focus-visible{outline:3px solid #a594ff}`;
  d.head.appendChild(style);
  pipTime = d.createElement('div'); pipTime.className = 't';
  const row = d.createElement('div'); row.className = 'r';
  pipPause = d.createElement('button'); pipPause.textContent = 'Pause';
  const stopB = d.createElement('button'); stopB.textContent = 'Stop and save'; stopB.className = 's';
  pipPause.addEventListener('click', () => el.pause.click());
  stopB.addEventListener('click', () => stopRecording());
  row.append(pipPause, stopB);
  d.body.append(pipTime, row);
  pipWin.addEventListener('pagehide', () => { pipWin = null; pipTime = pipPause = null; el.floatBtn.textContent = 'Floating controls (stay on top)'; });
  el.floatBtn.textContent = 'Close floating controls';
  syncFloat();
});

function syncFloat() {
  if (!pipWin || !pipTime) return;
  pipTime.textContent = fmtTime(elapsed());
  pipPause.textContent = paused ? 'Resume' : 'Pause';
}
function closeFloat() {
  if (pipWin) { try { pipWin.close(); } catch (_) {} }
  pipWin = null; pipTime = pipPause = null;
  el.floatBtn.textContent = 'Floating controls (stay on top)';
}


// ---------- voice isolation + mic meter ----------
let analyser = null, meterTimer = null;

el.mic.addEventListener('change', () => { el.micOptions.hidden = !el.mic.checked; });
el.micOptions.hidden = !el.mic.checked;

async function connectMic(stream, dest) {
  const src = audioCtx.createMediaStreamSource(stream);
  let node = src;
  if (el.isolation.value === 'strong') {
    // Cut rumble and hiss, gate out non-speech noise, then even out the volume.
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 90;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 14000;
    node.connect(hp); hp.connect(lp); node = lp;
    try {
      await audioCtx.audioWorklet.addModule('gate-processor.js');
      const gate = new AudioWorkletNode(audioCtx, 'voice-gate');
      node.connect(gate); node = gate;
    } catch (e) {
      say('Noise gate unavailable; using filters only.', true);
    }
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -26; comp.knee.value = 12; comp.ratio.value = 3;
    comp.attack.value = 0.005; comp.release.value = 0.2;
    node.connect(comp); node = comp;
  }
  node.connect(dest);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  node.connect(analyser);
  startMeter();
}

function startMeter() {
  const buf = new Uint8Array(analyser.fftSize);
  el.meterWrap.hidden = false;
  clearInterval(meterTimer);
  meterTimer = setInterval(() => {
    if (!analyser) return;
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
    el.meterBar.style.width = Math.min(100, (peak / 128) * 140) + '%';
  }, 60);
}
function stopMeter() {
  clearInterval(meterTimer); meterTimer = null; analyser = null;
  el.meterBar.style.width = '0%';
  el.meterWrap.hidden = true;
}


// ---------- hand the recording to the video editor ----------
let lastBlob = null;
$('editBtn').addEventListener('click', async () => {
  if (!lastBlob) return;
  try {
    await ClipStore.put('latest', lastBlob);
    window.open('editor.html?clip=latest', '_blank');
  } catch (e) {
    say('Could not open the editor: ' + e.message, true);
  }
});
