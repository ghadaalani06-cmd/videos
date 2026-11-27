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
  shape: $('shape'), mirror: $('mirror'), canvas: $('composite'),
  posField: $('posField'), shapeField: $('shapeField'),
  source: $('source'), floatBtn: $('floatBtn'),
  isolation: $('isolation'), micOptions: $('micOptions'), meterWrap: $('meterWrap'), meterBar: $('meterBar'),
};

const FORMATS = [
  { label: 'WebM (VP9)', mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
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

// Optional person segmentation for face-camera background effects.
const faceBgMode = $('faceBgMode'), faceBgFile = $('faceBgFile'), faceBgStatus = $('faceBgStatus');
let faceSegmenter = null, faceBgImage = null, faceBgImageId = 0;
let faceOutput = null, faceBusy = false, faceLastSent = 0;
const faceBgColors = {
  violet:['#7c5cff','#1b1e5a'], sunset:['#ff7a59','#e8204a','#5b3df0'],
  ocean:['#0f766e','#164e63','#0f1226'], mint:['#4fe3a0','#0f766e'],
  night:['#0f1226','#2a2f5e'], sand:['#f2d7a6','#e7a97b'], paper:['#eef0ff','#cfd6ff']
};
function faceBackgroundActive(){ return !!faceBgMode && faceBgMode.value !== 'none'; }
function setFaceStatus(message){ if(faceBgStatus) faceBgStatus.textContent=message; }
async function initFaceSegmenter(){
  if(faceSegmenter) return faceSegmenter;
  if(typeof SelfieSegmentation === 'undefined') throw new Error('Background model could not load. Check your internet connection.');
  faceSegmenter = new SelfieSegmentation({locateFile:(file)=>'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/'+file});
  faceSegmenter.setOptions({modelSelection:1});
  faceSegmenter.onResults((results)=>{
    if(!faceOutput || !camVideo || !results.segmentationMask) return;
    const w=faceOutput.width,h=faceOutput.height, out=faceOutput.getContext('2d');
    const person=document.createElement('canvas'); person.width=w; person.height=h;
    const pc=person.getContext('2d');
    pc.drawImage(results.image,0,0,w,h);
    pc.globalCompositeOperation='destination-in';
    pc.drawImage(results.segmentationMask,0,0,w,h);
    out.clearRect(0,0,w,h);
    if(faceBgMode.value==='blur'){
      out.save(); out.filter='blur(16px)'; out.drawImage(results.image,-12,-12,w+24,h+24); out.restore();
    } else if(faceBgMode.value==='image' && faceBgImage){
      const scale=Math.max(w/faceBgImage.width,h/faceBgImage.height),dw=faceBgImage.width*scale,dh=faceBgImage.height*scale;
      out.drawImage(faceBgImage,(w-dw)/2,(h-dh)/2,dw,dh);
    } else {
      const stops=faceBgColors[faceBgMode.value]||faceBgColors.night;
      const g=out.createLinearGradient(0,0,w,h);
      stops.forEach((c,i)=>g.addColorStop(i/(stops.length-1),c));
      out.fillStyle=g; out.fillRect(0,0,w,h);
    }
    out.drawImage(person,0,0,w,h);
  });
  await faceSegmenter.initialize();
  return faceSegmenter;
}
faceBgMode?.addEventListener('change',async()=>{
  if(faceBgMode.value==='image'){faceBgFile.click();return;}
  if(faceBgMode.value==='none'){faceOutput=null;setFaceStatus('Using your original camera background.');return;}
  try{await initFaceSegmenter();setFaceStatus('Background effect ready. It will be applied to the recorded camera.');}
  catch(e){faceBgMode.value='none';setFaceStatus(e.message+' Using original background instead.');}
});
faceBgFile?.addEventListener('change',async()=>{
  const file=faceBgFile.files?.[0]; faceBgFile.value=''; if(!file)return;
  try{
    const img=await createImageBitmap(file); faceBgImage=img; faceBgImageId++;
    faceBgMode.value='image'; await initFaceSegmenter();
    setFaceStatus('Custom background selected.');
  }catch(e){faceBgMode.value='none';setFaceStatus(e.message||'Could not load that image.');}
});
async function updateFaceBackground(){
  if(!faceBackgroundActive() || !camVideo || !faceSegmenter || faceBusy) return;
  const now=performance.now(); if(now-faceLastSent<90)return; faceLastSent=now; faceBusy=true;
  try{await faceSegmenter.send({image:camVideo});}
  catch(e){setFaceStatus('Background effect stopped; using original camera.');faceBgMode.value='none';faceOutput=null;}
  finally{faceBusy=false;}
}


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
  if (!el.format.options.length) say(t('msg.novideo'), true);
  if (!window.showSaveFilePicker) el.diskGroup.hidden = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    $('unsupported').hidden = false;
    el.start.disabled = true;
  }
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
  try { chrome.runtime.sendMessage({ type: 'recording-state', active: recording, paused }); } catch (_) {}
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
    el.pickFile.textContent = t('pick.set', { name: fileHandle.name });
    el.pickFile.classList.add('set');
    say(t('msg.disk'));
  } catch (e) {
    if (e.name !== 'AbortError') say(t('msg.fileerr', { m: e.message }), true);
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
    const videoConstraints = { frameRate: { ideal: fps }, width: { ideal: w }, height: { ideal: h } };
    if (el.source.value) videoConstraints.displaySurface = el.source.value;
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio: el.sysAudio.checked ? { echoCancellation: false, noiseSuppression: false } : false,
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    });

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
        say(t('msg.micblocked'), true);
        el.mic.checked = false;
      }
    }

    stopCamTest();
    if (el.camera.checked || bgOn()) {
      try {
        await startCompositor();
      } catch (e) {
        stopCompositor();
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
        writeChain = writeChain.then(() => writable.write(e.data)).catch((err) => say(t('msg.diskfail', { m: err.message }), true));
      } else {
        chunks.push(e.data);
      }
    };
    recorder.onstop = finalize;
    recorder.onerror = (e) => say(t('msg.recerr', { m: e.error?.message || 'unknown' }), true);

    displayStream.getVideoTracks()[0].addEventListener('ended', () => stopRecording());

    recorder.start(1000);
    recording = true; paused = false;
    startedAt = Date.now();
    timer = setInterval(tick, 250);
    setUI('recording');
    notifyBackground();
    say(t('msg.recording'));
    meetingOnStart();
  } catch (e) {
    cleanupStreams();
    el.screen.classList.remove('has-video');
    el.start.disabled = false;
    refreshBgPreview();
    say(e.name === 'NotAllowedError' ? t('msg.cancelled') : t('msg.startfail', { m: e.message }), e.name !== 'NotAllowedError');
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
    mixedTrack = audioTracks[0] || null;
  } else if (el.sysAudio.checked) {
    say(t('msg.noaudio'));
  }
  return new MediaStream([...videoTracks, ...audioTracks]);
}

function runCountdown() {
  return new Promise((resolve) => {
    let n = 3;
    const tickCount = () => {
      if (n === 0) { resolve(); return; }
      say(t('msg.countdown', { n }));
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
    recorder.pause(); paused = true; pausedAt = Date.now(); meetingOnPause(true);
    el.pause.textContent = t('resume');
    el.badge.classList.add('paused'); el.badgeText.textContent = t('badge.paused');
    syncFloat();
  } else {
    recorder.resume(); paused = false; pausedTotal += Date.now() - pausedAt; meetingOnPause(false);
    el.pause.textContent = t('pause');
    el.badge.classList.remove('paused'); el.badgeText.textContent = t('badge.rec');
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
  meetingOnStop();
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
      say(t('msg.savedto', { name: fileHandle.name, size: fmtSize(bytes) }));
    } catch (e) {
      say(t('msg.finishfail', { m: e.message }), true);
    }
    writable = null; fileHandle = null;
    el.pickFile.textContent = t('pick');
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
  say(t('msg.finished', { time: fmtTime(elapsed()), size: fmtSize(blob.size) }));
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
  if (idle && el.camera.checked && !camTestStream) startCamTest();
  if (idle) refreshBgPreview();
  el.start.hidden = !idle;
  el.start.disabled = !idle;
  el.live.hidden = mode !== 'recording';
  el.floatBtn.hidden = mode !== 'recording' || !window.documentPictureInPicture;
  el.badge.hidden = mode !== 'recording';
  el.badge.classList.remove('paused'); el.badgeText.textContent = t('badge.rec');
  el.pause.textContent = t('pause');
  el.result.hidden = mode !== 'done';
  el.settings.querySelectorAll('input,select').forEach((i) => (i.disabled = !idle && !i.closest('#camOptions') && i.id !== 'speechLang' && i.id !== 'meetTitle' && !(compositing && i.closest('#bgOptions'))));
  bgSwatches.querySelectorAll('button').forEach((b) => (b.disabled = !idle && !compositing));
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
  if (el.camera.checked) {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      camVideo = hiddenVideo(camStream);
    } catch (e) {
      camFail(e);
      el.camera.checked = false;
      el.camOptions.hidden = true;
      camStream = null; camVideo = null;
      if (!bgOn()) throw e;
    }
  }
  screenVideo = hiddenVideo(displayStream);
  await Promise.all([camVideo ? videoReady(camVideo) : null, videoReady(screenVideo)]);

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

function drawFrame() {
  if (!compositing || !ctx2d) return;
  const W = el.canvas.width, H = el.canvas.height;
  const L = el.layout.value, mirror = el.mirror.checked, hasCam = !!camVideo;
  if(hasCam && faceBackgroundActive()) updateFaceBackground();
  const cameraSource = faceOutput || camVideo;
  if (!bgOn()) { ctx2d.fillStyle = '#0d1620'; ctx2d.fillRect(0, 0, W, H); }

  if (hasCam && L === 'camera') { drawCover(cameraSource, 0, 0, W, H, mirror); return; }

  const side = hasCam && L === 'side';
  const camW = Math.round(W * 0.3);
  drawScreenIn({ x: 0, y: 0, w: side ? W - camW : W, h: H });

  if (side) {
    drawCover(cameraSource, W - camW, 0, camW, H, mirror);
  } else if (hasCam) {
    const d = Math.round(H * (L === 'big' ? 0.44 : 0.26));
    const bw = el.shape.value === 'circle' ? d : Math.round(d * 1.33);
    const m = Math.round(W * 0.02);
    const pos = el.position.value;
    const x = pos.endsWith('r') ? W - bw - m : m;
    const y = pos.startsWith('b') ? H - d - m : m;
    const path = () => {
      ctx2d.beginPath();
      if (el.shape.value === 'circle') ctx2d.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
      else ctx2d.roundRect(x, y, bw, d, d * 0.14);
    };
    ctx2d.save(); path(); ctx2d.clip();
    drawCover(cameraSource, x, y, bw, d, mirror);
    ctx2d.restore();
    path();
    ctx2d.lineWidth = Math.max(3, W * 0.003);
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.stroke();
  }
}

function drawScreenIn(area) {
  if (!bgOn()) { drawContain(screenVideo, area.x, area.y, area.w, area.h); return; }
  const vw = screenVideo.videoWidth, vh = screenVideo.videoHeight;
  if (!vw || !vh) return;
  const aspect = vw / vh;
  ctx2d.drawImage(getBackdrop(el.canvas.width, el.canvas.height, area, aspect), 0, 0);
  const g = frameGeom(area, aspect);
  ctx2d.save();
  ctx2d.beginPath(); ctx2d.roundRect(g.x, g.y, g.dw, g.dh, g.r); ctx2d.clip();
  ctx2d.drawImage(screenVideo, g.x, g.y, g.dw, g.dh);
  ctx2d.restore();
}

// ---------- floating always-on-top controls (so you can stop while working in VS Code etc.) ----------
let pipWin = null, pipTime = null, pipPause = null;

el.floatBtn.addEventListener('click', async () => {
  if (pipWin) { closeFloat(); return; }
  try {
    pipWin = await documentPictureInPicture.requestWindow({ width: 280, height: 120 });
  } catch (e) {
    say(t('msg.floatfail', { m: e.message }), true);
    return;
  }
  const d = pipWin.document;
  d.documentElement.lang = LANG; d.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
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
  pipPause = d.createElement('button'); pipPause.textContent = t('pause');
  const stopB = d.createElement('button'); stopB.textContent = t('stop'); stopB.className = 's';
  pipPause.addEventListener('click', () => el.pause.click());
  stopB.addEventListener('click', () => stopRecording());
  row.append(pipPause, stopB);
  d.body.append(pipTime, row);
  pipWin.addEventListener('pagehide', () => { pipWin = null; pipTime = pipPause = null; el.floatBtn.textContent = t('float'); });
  el.floatBtn.textContent = t('float.close');
  syncFloat();
});

function syncFloat() {
  if (!pipWin || !pipTime) return;
  pipTime.textContent = fmtTime(elapsed());
  pipPause.textContent = paused ? t('resume') : t('pause');
}
function closeFloat() {
  if (pipWin) { try { pipWin.close(); } catch (_) {} }
  pipWin = null; pipTime = pipPause = null;
  el.floatBtn.textContent = t('float');
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
      say(t('msg.gate'), true);
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
    window.open(new URL('editor.html?clip=latest', location.href).href, '_blank');
  } catch (e) {
    say(t('msg.editfail', { m: e.message }), true);
  }
});


// ---------- camera test preview (see your face before you record) ----------
const camTest = $('camLive'), camNote = $('camNote');
let camTestStream = null;

function applyMirror() { camTest.style.transform = el.mirror.checked ? 'scaleX(-1)' : 'none'; }
el.mirror.addEventListener('change', applyMirror);

el.camera.addEventListener('change', () => {
  camNote.hidden = true;
  if (el.camera.checked) startCamTest(); else stopCamTest();
});

async function startCamTest() {
  stopCamTest();
  try {
    camTestStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    camTest.srcObject = camTestStream;
    camTest.classList.add('on');
    applyMirror();
    camTest.play().catch(() => {});
  } catch (e) {
    camFail(e);
    el.camera.checked = false;
    syncCamUI();
  }
}
function stopCamTest() {
  if (camTestStream) { camTestStream.getTracks().forEach((t) => t.stop()); camTestStream = null; }
  camTest.srcObject = null;
  camTest.classList.remove('on');
}
function camFail(e) {
  let msg;
  if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
    const extId = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
    msg = extId
      ? t('cam.blocked.ext', { url: 'chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F' + extId })
      : t('cam.blocked.web');
  } else if (e.name === 'NotFoundError') {
    msg = t('cam.notfound');
  } else if (e.name === 'NotReadableError') {
    msg = t('cam.busy');
  } else {
    msg = t('cam.other', { m: e.message || e.name });
  }
  camNote.textContent = msg;
  camNote.hidden = false;
}


// ===================== Meeting mode =====================
const mode = { meeting: false, presetApplied: false };
const M = {
  title: $('meetTitle'), lang: $('speechLang'), on: $('transcribeOn'),
  panel: $('meetingPanel'), section: $('meetSection'),
  transcript: $('transcript'), tEmpty: $('transcriptEmpty'),
  noteType: $('noteType'), noteText: $('noteText'), noteAdd: $('noteAdd'), noteList: $('noteList'), markBtn: $('markBtn'),
  modeScreen: $('modeScreen'), modeMeeting: $('modeMeeting'), result: $('meetResult'),
  dlMin: $('dlMinutes'), dlSrt: $('dlSrt'), copy: $('copyMinutes'),
};
let mixedTrack = null;
let lines = [], items = [], meetStart = 0, meetDurMs = 0;
let sr = null, srWanted = false, interimEl = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function setMode(meeting) {
  mode.meeting = meeting;
  document.body.classList.toggle('meeting-mode', meeting);
  M.modeScreen.classList.toggle('on', !meeting);
  M.modeMeeting.classList.toggle('on', meeting);
  M.modeScreen.setAttribute('aria-pressed', String(!meeting));
  M.modeMeeting.setAttribute('aria-pressed', String(meeting));
  M.panel.hidden = !meeting;
  M.section.hidden = !meeting;
  M.result.hidden = true;
  el.start.textContent = t(meeting ? 'start.meeting' : 'start');
  if (meeting && !mode.presetApplied) {
    mode.presetApplied = true;
    // Sensible defaults for calls: capture a tab with its sound plus your microphone.
    el.source.value = 'browser'; el.sysAudio.checked = true;
    el.mic.checked = true; el.micOptions.hidden = false;
    el.quality.value = '720'; el.fps.value = '30'; el.countdown.checked = false;
    M.lang.value = LANG === 'ar' ? 'ar-AE' : 'en-US';
  }
}
M.modeScreen.addEventListener('click', () => { if (!recording) setMode(false); });
M.modeMeeting.addEventListener('click', () => { if (!recording) setMode(true); });
if (new URLSearchParams(location.search).get('mode') === 'meeting') setMode(true);

// ---------- helpers ----------
const hms = (ms) => fmtTime(ms);
function saveText(name, text, type) {
  const blob = new Blob(['\ufeff' + text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const safeName = (s) => (s || 'meeting').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'meeting';

// ---------- transcript ----------
function addLine(text) {
  const ms = Math.max(0, elapsed());
  lines.push({ ms, text, lang: M.lang.value });
  if (interimEl) { interimEl.remove(); interimEl = null; }
  M.tEmpty.hidden = true;
  const p = document.createElement('p');
  p.className = 'line';
  const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = hms(ms);
  const tx = document.createElement('span'); tx.className = 'tx'; tx.dir = 'auto'; tx.textContent = text;
  p.append(ts, tx);
  M.transcript.appendChild(p);
  M.transcript.scrollTop = M.transcript.scrollHeight;
}
function showInterim(text) {
  if (!text) { if (interimEl) { interimEl.remove(); interimEl = null; } return; }
  if (!interimEl) {
    interimEl = document.createElement('p'); interimEl.className = 'line interim';
    const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = '…';
    const tx = document.createElement('span'); tx.className = 'tx'; tx.dir = 'auto';
    interimEl.append(ts, tx);
    M.transcript.appendChild(interimEl);
  }
  interimEl.querySelector('.tx').textContent = text;
  M.transcript.scrollTop = M.transcript.scrollHeight;
}
function launchSR() {
  if (!SR) return;
  sr = new SR();
  sr.continuous = true; sr.interimResults = true; sr.maxAlternatives = 1; sr.lang = M.lang.value;
  sr.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], tx = r[0].transcript.trim();
      if (r.isFinal) { if (tx) addLine(tx); } else interim += tx + ' ';
    }
    showInterim(interim.trim());
  };
  sr.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { srWanted = false; say(t('meet.srdenied'), true); }
    else if (e.error === 'network') { srWanted = false; say(t('meet.srnet'), true); }
  };
  sr.onend = () => {
    showInterim('');
    if (srWanted && recording && !paused) setTimeout(() => { if (srWanted && recording && !paused) launchSR(); }, 250);
  };
  try {
    // Newer Chrome can listen to the mixed meeting audio; older versions ignore the argument and use the microphone.
    if (mixedTrack && mixedTrack.readyState === 'live') sr.start(mixedTrack); else sr.start();
  } catch (_) {
    try { sr.start(); } catch (__) {}
  }
}
function stopSR() {
  srWanted = false;
  if (sr) { try { sr.stop(); } catch (_) {} sr = null; }
  showInterim('');
}
M.lang.addEventListener('change', () => {
  if (srWanted && recording && !paused) { if (sr) { try { sr.abort(); } catch (_) {} } }
});

// ---------- notes ----------
function addItem(type, text) {
  items.push({ ms: Math.max(0, elapsed()), type, text });
  renderItems();
}
function renderItems() {
  M.noteList.innerHTML = '';
  items.forEach((it, idx) => {
    const li = document.createElement('li');
    li.className = 'note ' + it.type;
    const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = hms(it.ms);
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = t('note.' + it.type);
    const tx = document.createElement('span'); tx.className = 'tx'; tx.dir = 'auto'; tx.textContent = it.text || '';
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'x'; rm.textContent = '×';
    rm.setAttribute('aria-label', t('note.remove'));
    rm.addEventListener('click', () => { items.splice(idx, 1); renderItems(); });
    li.append(ts, tag, tx, rm);
    M.noteList.appendChild(li);
  });
}
function submitNote() {
  const text = M.noteText.value.trim();
  if (!text) return;
  addItem(M.noteType.value, text);
  M.noteText.value = '';
}
M.noteAdd.addEventListener('click', submitNote);
M.noteText.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitNote(); } });
M.markBtn.addEventListener('click', () => { if (recording) addItem('moment', ''); });
document.addEventListener('keydown', (e) => {
  if (!mode.meeting || !recording) return;
  if (['input', 'textarea', 'select'].includes((e.target.tagName || '').toLowerCase())) return;
  if (e.key === 'm' || e.key === 'M') addItem('moment', '');
});

// ---------- lifecycle hooks (called from the recorder code above) ----------
function meetingOnStart() {
  if (!mode.meeting) return;
  lines = []; items = []; meetStart = Date.now(); meetDurMs = 0;
  M.transcript.querySelectorAll('.line').forEach((n) => n.remove());
  M.tEmpty.hidden = false; renderItems(); M.result.hidden = true;
  if (M.on.checked) {
    if (!SR) say(t('meet.nosr'), true);
    else { srWanted = true; launchSR(); }
  }
}
function meetingOnPause(isPaused) {
  if (!mode.meeting || !srWanted) return;
  if (isPaused) { if (sr) { try { sr.stop(); } catch (_) {} } }
  else launchSR();
}
function meetingOnStop() {
  if (!mode.meeting) return;
  meetDurMs = Math.max(0, elapsed());
  stopSR();
  M.result.hidden = !(lines.length || items.length);
}

// ---------- minutes + captions ----------
function buildMinutes() {
  const title = M.title.value.trim() || t('min.untitled');
  const when = new Date(meetStart || Date.now()).toLocaleString(LANG === 'ar' ? 'ar-AE' : 'en-GB');
  let md = `# ${title}\n\n${when} · ${t('min.duration')}: ${hms(meetDurMs)}\n\n`;
  const section = (type, head, fmtItem) => {
    const arr = items.filter((i) => i.type === type);
    if (!arr.length) return;
    md += `## ${head}\n\n` + arr.map(fmtItem).join('\n') + '\n\n';
  };
  section('action', t('min.actions'), (i) => `- [ ] [${hms(i.ms)}] ${i.text}`);
  section('decision', t('min.decisions'), (i) => `- [${hms(i.ms)}] ${i.text}`);
  section('note', t('min.notes'), (i) => `- [${hms(i.ms)}] ${i.text}`);
  section('moment', t('min.moments'), (i) => `- [${hms(i.ms)}] ${i.text || t('note.moment')}`);
  if (lines.length) md += `## ${t('min.transcript')}\n\n` + lines.map((l) => `[${hms(l.ms)}] ${l.text}`).join('\n\n') + '\n';
  return md;
}
function srtTime(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), x = Math.floor(ms % 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(x, 3)}`;
}
function buildSrt() {
  return lines.map((l, i) => {
    const next = lines[i + 1] ? lines[i + 1].ms - 20 : l.ms + 4000;
    const end = Math.max(Math.min(next, l.ms + 8000), l.ms + 200);
    return `${i + 1}\n${srtTime(l.ms)} --> ${srtTime(end)}\n${l.text}\n`;
  }).join('\n');
}
M.dlMin.addEventListener('click', () => saveText(safeName(M.title.value) + '-minutes.md', buildMinutes(), 'text/markdown'));
M.dlSrt.addEventListener('click', () => saveText(safeName(M.title.value) + '.srt', buildSrt(), 'application/x-subrip'));
M.copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(buildMinutes()); say(t('copied')); } catch (_) {}
});

// ---------- language switch: refresh text that scripts set ----------
document.addEventListener('langchange', () => {
  el.start.textContent = t(mode.meeting ? 'start.meeting' : 'start');
  el.pause.textContent = paused ? t('resume') : t('pause');
  el.badgeText.textContent = paused ? t('badge.paused') : t('badge.rec');
  el.pickFile.textContent = fileHandle ? t('pick.set', { name: fileHandle.name }) : t('pick');
  el.floatBtn.textContent = pipWin ? t('float.close') : t('float');
  syncFloat();
  renderItems();
  if (el.msg.textContent && !recording) say('');
  if (mode.meeting && !recording && M.lang.value.slice(0, 2) !== LANG) M.lang.value = LANG === 'ar' ? 'ar-AE' : 'en-US';
});


// ===================== Background (styled backdrop behind your screen) =====================
const bgSwatches = $('bgSwatches'), bgOptions = $('bgOptions'), bgFile = $('bgFile'), bgNote = $('bgNote');
const bgPad = $('bgPad'), bgRadius = $('bgRadius'), bgShadow = $('bgShadow'), bgUploadBtn = $('bgUploadBtn');
const BG = { type: 'none', img: null, url: null, imgId: 0 };
const BG_PRESETS = {
  violet: ['#7c5cff', '#1b1e5a'], sunset: ['#ff7a59', '#e8204a', '#5b3df0'], ocean: ['#0f766e', '#164e63', '#0f1226'],
  mint: ['#4fe3a0', '#0f766e'], night: ['#0f1226', '#2a2f5e'], sand: ['#f2d7a6', '#e7a97b'], paper: ['#eef0ff', '#cfd6ff'],
};
function bgOn() { return BG.type !== 'none'; }

function paintBg(ctx, W, H) {
  if (BG.type === 'image' && BG.img) {
    const iw = BG.img.width, ih = BG.img.height, sc = Math.max(W / iw, H / ih);
    const dw = iw * sc, dh = ih * sc;
    ctx.drawImage(BG.img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return;
  }
  const stops = BG_PRESETS[BG.type] || BG_PRESETS.night;
  const g = ctx.createLinearGradient(0, 0, W, H);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// Where the screen sits on the background (padding, rounded corners).
function frameGeom(area, aspect) {
  const pad = Math.round(Math.min(area.w, area.h) * (+bgPad.value) / 100);
  const iw = area.w - 2 * pad, ih = area.h - 2 * pad;
  let dw = iw, dh = dw / aspect;
  if (dh > ih) { dh = ih; dw = dh * aspect; }
  return { x: area.x + pad + (iw - dw) / 2, y: area.y + pad + (ih - dh) / 2, dw, dh, r: dh * (+bgRadius.value) / 400 };
}
function paintShadow(ctx, g) {
  ctx.save();
  if (bgShadow.checked) { ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = g.dh * 0.05; ctx.shadowOffsetY = g.dh * 0.02; }
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.roundRect(g.x, g.y, g.dw, g.dh, g.r); ctx.fill();
  ctx.restore();
}
// Background + shadow are drawn once and reused for every frame (blurs are too slow to repeat 30 times a second).
let backdrop = null, backdropKey = '';
function getBackdrop(W, H, area, aspect) {
  const key = [W, H, area.x, area.y, area.w, area.h, aspect.toFixed(4), BG.type, BG.imgId, bgPad.value, bgRadius.value, bgShadow.checked].join('|');
  if (backdrop && key === backdropKey) return backdrop;
  backdrop = backdrop || document.createElement('canvas');
  backdrop.width = W; backdrop.height = H;
  const c = backdrop.getContext('2d');
  paintBg(c, W, H);
  paintShadow(c, frameGeom(area, aspect));
  backdropKey = key;
  return backdrop;
}
// Used for the idle preview.
function styledFrame(ctx, area, aspect, inner) {
  const g = frameGeom(area, aspect);
  paintShadow(ctx, g);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(g.x, g.y, g.dw, g.dh, g.r); ctx.clip();
  inner(g.x, g.y, g.dw, g.dh);
  ctx.restore();
}

// Idle preview: shows how the background will look before you record.
function refreshBgPreview() {
  if (recording || compositing || el.start.hidden || el.start.disabled || !el.result.hidden) return;
  if (!bgOn()) { el.screen.classList.remove('has-canvas', 'has-video'); return; }
  el.canvas.width = 960; el.canvas.height = 540;
  const ctx = el.canvas.getContext('2d');
  paintBg(ctx, 960, 540);
  styledFrame(ctx, { x: 0, y: 0, w: 960, h: 540 }, 16 / 9, (x, y, w, h) => {
    ctx.fillStyle = '#0d1620'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1b2238'; ctx.fillRect(x, y, w, h * 0.07);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + w * 0.03 + i * w * 0.025, y + h * 0.035, h * 0.013, 0, 6.283); ctx.fill(); });
    ctx.fillStyle = 'rgba(238,240,255,.16)';
    [0.16, 0.24, 0.32, 0.40].forEach((f, i) => ctx.fillRect(x + w * 0.05, y + h * (f + 0.04), w * (0.55 - i * 0.07), h * 0.03));
  });
  el.screen.classList.add('has-canvas', 'has-video');
}

function selectBg(type) {
  BG.type = type;
  bgSwatches.querySelectorAll('.sw').forEach((b) => {
    const on = b.dataset.bg === type;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  bgOptions.hidden = type === 'none';
  bgNote.hidden = true;
  refreshBgPreview();
}
bgSwatches.addEventListener('click', (e) => {
  const b = e.target.closest('.sw');
  if (!b || b.disabled) return;
  if (b.dataset.bg === 'image') { bgFile.click(); return; }
  selectBg(b.dataset.bg);
});
bgFile.addEventListener('change', async () => {
  const f = bgFile.files[0];
  bgFile.value = '';
  if (!f) return;
  try {
    const img = await createImageBitmap(f);
    BG.img = img; BG.imgId++;
    if (BG.url) URL.revokeObjectURL(BG.url);
    BG.url = URL.createObjectURL(f);
    bgUploadBtn.style.backgroundImage = `url("${BG.url}")`;
    bgUploadBtn.textContent = '';
    selectBg('image');
  } catch (_) {
    bgNote.textContent = t('bg.badimage');
    bgNote.hidden = false;
  }
});
[bgPad, bgRadius, bgShadow].forEach((n) => n.addEventListener('input', refreshBgPreview));
