// Video editor: cut, trim, crop, speed, volume, text. Everything runs locally in the browser.
const $ = (id) => document.getElementById(id);
const el = {
  screen: $('screen'), view: $('view'), empty: $('empty'), openBtn: $('openBtn'), fileInput: $('fileInput'),
  playBtn: $('playBtn'), cur: $('curTime'), tot: $('totTime'), tl: $('tl'),
  splitBtn: $('splitBtn'), delBtn: $('delBtn'), undoBtn: $('undoBtn'), resetBtn: $('resetBtn'),
  speed: $('speed'), volume: $('volume'), volLabel: $('volLabel'),
  aspect: $('aspect'), zoom: $('zoom'), zoomLabel: $('zoomLabel'), panX: $('panX'), panY: $('panY'),
  addText: $('addText'), textList: $('textList'), res: $('res'), format: $('format'),
  exportBtn: $('exportBtn'), cancelBtn: $('cancelBtn'), progress: $('progress'), progBar: $('progBar'),
  msg: $('msg'), result: $('result'), download: $('download'), settings: $('settings'),
};
const pctx = el.view.getContext('2d');

const FORMATS = [
  { label: 'WebM (VP9)', mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { label: 'WebM (VP8)', mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { label: 'MP4 (H.264)', mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
  { label: 'MP4 (H.264)', mime: 'video/mp4', ext: 'mp4' },
];

// ---------- state ----------
const video = document.createElement('video');
video.playsInline = true; video.preload = 'auto';
video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
document.body.appendChild(video);

let loaded = false, srcUrl = null, dur = 0, vw = 0, vh = 0;
let segs = [], sel = 0, history = [];
let overlays = [], nextId = 1;
let exporting = false, cancelled = false;
let actx = null, gainNode = null, exportDest = null, timerWorker = null;
let outUrl = null, baseName = 'video';

const S = { speed: 1, volume: 1, aspect: 'orig', zoom: 1, panX: 0, panY: 0 };

const pad = (n) => String(n).padStart(2, '0');
const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60); return `${pad(m)}:${pad(Math.floor(t % 60))}.${Math.floor((t % 1) * 10)}`; };
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const even = (n) => Math.max(2, n - (n % 2));
const say = (t, err = false) => { el.msg.textContent = t; el.msg.classList.toggle('error', err); };
const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`; };

// formats
(function () {
  const seen = new Set();
  for (const f of FORMATS) {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(f.mime)) continue;
    if (seen.has(f.ext + f.label)) continue;
    seen.add(f.ext + f.label);
    const o = document.createElement('option');
    o.value = f.mime; o.textContent = f.label; o.dataset.ext = f.ext;
    el.format.appendChild(o);
  }
})();

// ---------- loading ----------
el.openBtn.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => { const f = el.fileInput.files[0]; if (f) loadBlob(f, f.name); });
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); el.screen.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); el.screen.classList.remove('drag'); }));
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) loadBlob(f, f.name);
});

(async function autoLoad() {
  const clip = new URLSearchParams(location.search).get('clip');
  if (!clip) return;
  try {
    const blob = await ClipStore.get(clip);
    if (blob) loadBlob(blob, 'recording');
    else say(t('ed.clipgone'), true);
  } catch (e) { say(t('ed.openfail', { m: e.message }), true); }
})();

async function loadBlob(blob, name) {
  say(t('ed.loading'));
  el.result.hidden = true;
  if (srcUrl) URL.revokeObjectURL(srcUrl);
  srcUrl = URL.createObjectURL(blob);
  baseName = (name || 'video').replace(/\.[^.]+$/, '');
  video.src = srcUrl;
  try {
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error(t('ed.badfile')));
    });
    if (!isFinite(video.duration)) await fixDuration();
  } catch (e) { say(e.message, true); return; }

  dur = video.duration; vw = video.videoWidth; vh = video.videoHeight;
  segs = [{ start: 0, end: dur }]; sel = 0; history = []; overlays = []; renderTexts();
  Object.assign(S, { speed: 1, volume: 1, aspect: 'orig', zoom: 1, panX: 0, panY: 0 });
  el.speed.value = '1'; el.volume.value = 100; el.aspect.value = 'orig';
  el.zoom.value = 100; el.panX.value = 0; el.panY.value = 0; syncLabels();
  setupAudio();
  video.playbackRate = 1; video.currentTime = 0;
  loaded = true;
  el.screen.classList.add('has-video');
  layoutPreview(); renderTimeline(); updateButtons();
  say(t('ed.loaded', { w: vw, h: vh, dur: fmt(dur) }));
}

// Recordings made by the browser often report an infinite length until you seek to the end.
function fixDuration() {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('timeupdate', onTU); video.currentTime = 0; resolve(); };
    const onTU = () => { if (isFinite(video.duration)) done(); };
    video.addEventListener('timeupdate', onTU);
    video.currentTime = 1e101;
    setTimeout(done, 5000);
  });
}

function setupAudio() {
  if (actx) return;
  actx = new AudioContext();
  const src = actx.createMediaElementSource(video);
  gainNode = actx.createGain();
  src.connect(gainNode);
  gainNode.connect(actx.destination);
}

// ---------- segments (cuts) ----------
function pushHistory() {
  history.push(JSON.stringify({ segs, sel }));
  if (history.length > 60) history.shift();
}
function undo() {
  if (!history.length || exporting) return;
  const h = JSON.parse(history.pop());
  segs = h.segs; sel = h.sel;
  renderTimeline(); updateButtons();
}
const segIndexAt = (t) => segs.findIndex((s) => t >= s.start - 0.001 && t < s.end);

el.splitBtn.addEventListener('click', () => {
  const t = video.currentTime, i = segIndexAt(t);
  if (i < 0 || t - segs[i].start < 0.1 || segs[i].end - t < 0.1) { say(t('ed.splitfail'), true); return; }
  pushHistory();
  const s = segs[i];
  segs.splice(i, 1, { start: s.start, end: t }, { start: t, end: s.end });
  sel = i; say('');
  renderTimeline(); updateButtons();
});
el.delBtn.addEventListener('click', () => {
  if (segs.length < 2) { say(t('ed.keepone'), true); return; }
  pushHistory();
  segs.splice(sel, 1);
  sel = Math.min(sel, segs.length - 1); say('');
  renderTimeline(); updateButtons();
  if (segIndexAt(video.currentTime) < 0) video.currentTime = segs[sel].start;
});
el.undoBtn.addEventListener('click', undo);
el.resetBtn.addEventListener('click', () => { pushHistory(); segs = [{ start: 0, end: dur }]; sel = 0; renderTimeline(); updateButtons(); });

// ---------- timeline ----------
let playheadEl = null;
function renderTimeline() {
  el.tl.innerHTML = '';
  segs.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'seg' + (i === sel ? ' sel' : '');
    d.style.left = (s.start / dur) * 100 + '%';
    d.style.width = ((s.end - s.start) / dur) * 100 + '%';
    d.dataset.i = i;
    d.textContent = t('part', { n: i + 1 });
    if (i === sel) {
      for (const side of ['l', 'r']) {
        const h = document.createElement('div');
        h.className = 'handle ' + side; h.dataset.side = side;
        d.appendChild(h);
      }
    }
    el.tl.appendChild(d);
  });
  playheadEl = document.createElement('div');
  playheadEl.className = 'playhead';
  el.tl.appendChild(playheadEl);
  updatePlayhead();
}
function updatePlayhead() {
  if (playheadEl && dur) playheadEl.style.left = (video.currentTime / dur) * 100 + '%';
}
function xToTime(x) {
  const r = el.tl.getBoundingClientRect();
  return clamp((x - r.left) / r.width, 0, 1) * dur;
}

let drag = null;
el.tl.addEventListener('pointerdown', (e) => {
  if (!loaded || exporting) return;
  el.tl.setPointerCapture(e.pointerId);
  const segEl = e.target.closest('.seg');
  if (e.target.classList.contains('handle')) {
    pushHistory();
    drag = { type: 'handle', side: e.target.dataset.side, i: Number(segEl.dataset.i) };
    return;
  }
  const t = xToTime(e.clientX);
  const i = segIndexAt(t);
  if (i >= 0 && i !== sel) { sel = i; renderTimeline(); updateButtons(); }
  video.currentTime = t;
  drag = { type: 'scrub' };
});
el.tl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const t = xToTime(e.clientX);
  if (drag.type === 'scrub') { video.currentTime = t; return; }
  const s = segs[drag.i];
  if (drag.side === 'l') {
    const min = drag.i > 0 ? segs[drag.i - 1].end : 0;
    s.start = clamp(t, min, s.end - 0.1);
    video.currentTime = s.start;
  } else {
    const max = drag.i < segs.length - 1 ? segs[drag.i + 1].start : dur;
    s.end = clamp(t, s.start + 0.1, max);
    video.currentTime = Math.max(s.start, s.end - 0.05);
  }
  renderTimeline();
});
const endDrag = () => { drag = null; };
el.tl.addEventListener('pointerup', endDrag);
el.tl.addEventListener('pointercancel', endDrag);

// ---------- playback ----------
el.playBtn.addEventListener('click', togglePlay);
function togglePlay() {
  if (!loaded || exporting) return;
  if (actx && actx.state === 'suspended') actx.resume();
  if (video.paused) {
    const t = video.currentTime;
    if (segIndexAt(t) < 0 && !segs.some((s) => s.start > t)) video.currentTime = segs[0].start;
    video.playbackRate = S.speed;
    video.play();
  } else video.pause();
}
video.addEventListener('play', () => { el.playBtn.textContent = t('pause'); });
video.addEventListener('pause', () => { el.playBtn.textContent = t('play'); });
video.addEventListener('ended', () => { if (!exporting) endReached(); });

function endReached() {
  if (exporting) { finishExport(); return; }
  video.pause();
  video.currentTime = segs[segs.length - 1].end - 0.02;
}
// Skips deleted parts and stops at the end of the last part. Runs every frame while playing.
function enforcePlayback() {
  if (video.paused && !exporting) return;
  const t = video.currentTime, i = segIndexAt(t);
  if (i < 0) {
    const n = segs.findIndex((s) => s.start > t);
    if (n < 0) endReached(); else video.currentTime = segs[n].start;
    return;
  }
  if (t >= segs[i].end - 0.03) {
    if (i + 1 < segs.length) video.currentTime = segs[i + 1].start;
    else endReached();
  }
}

function outputElapsed(t) {
  let acc = 0;
  for (const s of segs) {
    if (t >= s.end) acc += s.end - s.start;
    else { if (t > s.start) acc += t - s.start; break; }
  }
  return acc / S.speed;
}
const totalOutput = () => segs.reduce((a, s) => a + s.end - s.start, 0) / S.speed;

// ---------- frame (crop, zoom) and drawing ----------
function aspectValue() {
  switch (S.aspect) {
    case '16:9': return 16 / 9;
    case '1:1': return 1;
    case '9:16': return 9 / 16;
    case '4:5': return 4 / 5;
    default: return vw / vh;
  }
}
function cropRect() {
  const a = aspectValue();
  let w0, h0;
  if (vw / vh > a) { h0 = vh; w0 = vh * a; } else { w0 = vw; h0 = vw / a; }
  const sw = w0 / S.zoom, sh = h0 / S.zoom;
  const maxX = vw - sw, maxY = vh - sh;
  return { sx: (maxX / 2) * (1 + S.panX), sy: (maxY / 2) * (1 + S.panY), sw, sh, w0, h0, a };
}
function outSize(forExport) {
  const r = cropRect();
  const cap = forExport ? (el.res.value === 'orig' ? Infinity : Number(el.res.value)) : 540;
  const H = even(Math.round(Math.min(r.h0, cap)));
  return { W: even(Math.round(H * r.a)), H };
}
function layoutPreview() {
  const { W, H } = outSize(false);
  if (el.view.width !== W || el.view.height !== H) { el.view.width = W; el.view.height = H; }
}

function drawScene(ctx, W, H, t) {
  const r = cropRect();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (video.readyState >= 2) ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
  for (const o of overlays) {
    if (!o.text || t < o.start || t > o.end) continue;
    const px = Math.max(10, Math.round((H * o.size) / 100));
    ctx.font = `700 ${px}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = px * 0.16; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.fillStyle = o.color;
    const lines = o.text.split('\n');
    const lh = px * 1.2;
    const cy = o.pos === 'top' ? H * 0.12 : o.pos === 'center' ? H * 0.5 : H * 0.88;
    lines.forEach((ln, k) => {
      const y = cy + (k - (lines.length - 1) / 2) * lh;
      ctx.strokeText(ln, W / 2, y, W * 0.92);
      ctx.fillText(ln, W / 2, y, W * 0.92);
    });
  }
}

// ---------- preview loop ----------
function loop() {
  requestAnimationFrame(loop);
  if (!loaded || exporting) return;
  enforcePlayback();
  drawScene(pctx, el.view.width, el.view.height, video.currentTime);
  updatePlayhead();
  el.cur.textContent = fmt(outputElapsed(video.currentTime));
}
requestAnimationFrame(loop);

function updateButtons() {
  const on = loaded && !exporting;
  el.playBtn.disabled = el.splitBtn.disabled = el.addText.disabled = el.exportBtn.disabled = !on;
  el.delBtn.disabled = !on || segs.length < 2;
  el.undoBtn.disabled = !on || !history.length;
  el.resetBtn.disabled = !on || (segs.length === 1 && segs[0].start === 0 && segs[0].end === dur);
  el.tot.textContent = fmt(totalOutput());
}

// ---------- settings ----------
function syncLabels() {
  el.volLabel.textContent = Math.round(S.volume * 100) + '%';
  el.zoomLabel.textContent = Math.round(S.zoom * 100) + '%';
}
el.speed.addEventListener('change', () => { S.speed = Number(el.speed.value); video.playbackRate = S.speed; updateButtons(); });
el.volume.addEventListener('input', () => { S.volume = el.volume.value / 100; if (gainNode) gainNode.gain.value = S.volume; syncLabels(); });
el.aspect.addEventListener('change', () => { S.aspect = el.aspect.value; layoutPreview(); });
el.zoom.addEventListener('input', () => { S.zoom = el.zoom.value / 100; syncLabels(); });
el.panX.addEventListener('input', () => { S.panX = el.panX.value / 100; });
el.panY.addEventListener('input', () => { S.panY = el.panY.value / 100; });

// ---------- text overlays ----------
el.addText.addEventListener('click', () => {
  const t = video.currentTime;
  overlays.push({ id: nextId++, text: t('txt.default'), start: +t.toFixed(1), end: +Math.min(t + 3, dur).toFixed(1), pos: 'bottom', size: 7, color: '#ffffff' });
  renderTexts();
});
function renderTexts() {
  el.textList.innerHTML = '';
  overlays.forEach((o) => {
    const card = document.createElement('div'); card.className = 'text-item';
    const ta = document.createElement('textarea'); ta.value = o.text; ta.setAttribute('aria-label', 'Text');
    ta.addEventListener('input', () => { o.text = ta.value; });
    const times = document.createElement('div'); times.className = 'two';
    times.append(numField(t('txt.from'), o.start, (v) => { o.start = v; }), numField(t('txt.until'), o.end, (v) => { o.end = v; }));
    const row = document.createElement('div'); row.className = 'two';
    const posL = document.createElement('label'); posL.textContent = t('txt.pos');
    const pos = document.createElement('select');
    [['top', t('top')], ['center', t('middle')], ['bottom', t('bottom')]].forEach(([v, l]) => { const op = new Option(l, v); pos.add(op); });
    pos.value = o.pos; pos.addEventListener('change', () => { o.pos = pos.value; });
    posL.appendChild(pos);
    const colL = document.createElement('label'); colL.textContent = t('txt.color');
    const col = document.createElement('input'); col.type = 'color'; col.value = o.color;
    col.addEventListener('input', () => { o.color = col.value; });
    colL.appendChild(col);
    row.append(posL, colL);
    const sizeL = document.createElement('label'); sizeL.textContent = t('txt.size');
    const size = document.createElement('input'); size.type = 'range'; size.min = 3; size.max = 20; size.value = o.size;
    size.addEventListener('input', () => { o.size = Number(size.value); });
    sizeL.appendChild(size);
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm'; rm.textContent = t('txt.remove');
    rm.addEventListener('click', () => { overlays = overlays.filter((x) => x !== o); renderTexts(); });
    card.append(ta, times, row, sizeL, rm);
    el.textList.appendChild(card);
  });
}
function numField(label, value, onChange) {
  const l = document.createElement('label'); l.textContent = label;
  const i = document.createElement('input'); i.type = 'number'; i.step = '0.1'; i.min = '0'; i.value = value;
  i.addEventListener('input', () => { const v = parseFloat(i.value); if (!isNaN(v)) onChange(v); });
  l.appendChild(i); return l;
}

// ---------- export ----------
const exportCanvas = document.createElement('canvas');
let recorder = null, chunks = [];

el.exportBtn.addEventListener('click', startExport);
el.cancelBtn.addEventListener('click', () => { cancelled = true; finishExport(); });

async function startExport() {
  if (!loaded || exporting) return;
  if (!el.format.options.length) { say(t('msg.novideo'), true); return; }
  video.pause();
  if (actx.state === 'suspended') await actx.resume();
  exporting = true; cancelled = false; chunks = [];
  document.body.classList.add('recording');
  el.result.hidden = true; el.progress.hidden = false; el.progBar.style.width = '0%';
  el.exportBtn.hidden = true; el.cancelBtn.hidden = false;
  el.settings.querySelectorAll('input,select,button').forEach((n) => (n.disabled = true));
  updateButtons();
  say(t('ed.exporting'));

  const { W, H } = outSize(true);
  exportCanvas.width = W; exportCanvas.height = H;
  const ectx = exportCanvas.getContext('2d', { alpha: false });
  const canvasStream = exportCanvas.captureStream(30);

  // Silence the speakers during export, send audio to the recording instead.
  exportDest = actx.createMediaStreamDestination();
  gainNode.disconnect();
  gainNode.connect(exportDest);

  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...exportDest.stream.getAudioTracks()]);
  const mime = el.format.value;
  const ext = el.format.selectedOptions[0].dataset.ext;
  const bps = H >= 1080 ? 8e6 : H >= 720 ? 5e6 : 3e6;
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 128000 });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    if (cancelled) { say(t('ed.cancelled')); return; }
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (outUrl) URL.revokeObjectURL(outUrl);
    outUrl = URL.createObjectURL(blob);
    el.download.href = outUrl;
    el.download.download = `${baseName}-edited-${stamp()}.${ext}`;
    el.result.hidden = false;
    say(t('ed.done', { dur: fmt(totalOutput()) }));
  };

  video.currentTime = segs[0].start;
  await new Promise((r) => { video.onseeked = r; setTimeout(r, 1500); });
  video.onseeked = null;
  video.playbackRate = S.speed;
  await video.play();
  recorder.start(1000);

  timerWorker = new Worker('timer-worker.js');
  timerWorker.onmessage = () => {
    if (!exporting) return;
    enforcePlayback();
    if (!exporting) return;
    drawScene(ectx, W, H, video.currentTime);
    pctx.drawImage(exportCanvas, 0, 0, el.view.width, el.view.height);
    const p = clamp(outputElapsed(video.currentTime) / totalOutput(), 0, 1);
    el.progBar.style.width = (p * 100).toFixed(1) + '%';
    el.cur.textContent = fmt(outputElapsed(video.currentTime));
    updatePlayhead();
  };
  timerWorker.postMessage({ cmd: 'start', interval: 16 });
}

function finishExport() {
  if (!exporting) return;
  exporting = false;
  video.pause();
  if (timerWorker) { timerWorker.postMessage({ cmd: 'stop' }); timerWorker.terminate(); timerWorker = null; }
  const stopRec = () => { if (recorder && recorder.state !== 'inactive') recorder.stop(); };
  if (cancelled) stopRec();
  else { try { recorder.requestData(); } catch (_) {} setTimeout(stopRec, 300); }
  // restore speakers
  try { gainNode.disconnect(); } catch (_) {}
  gainNode.connect(actx.destination);
  document.body.classList.remove('recording');
  el.progress.hidden = true; el.cancelBtn.hidden = true; el.exportBtn.hidden = false;
  el.settings.querySelectorAll('input,select,button').forEach((n) => (n.disabled = false));
  video.currentTime = segs[0].start;
  updateButtons();
}

window.addEventListener('beforeunload', (e) => { if (exporting) { e.preventDefault(); e.returnValue = ''; } });

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (!loaded || exporting) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 's' || e.key === 'S') el.splitBtn.click();
  else if (e.key === 'Delete' || e.key === 'Backspace') el.delBtn.click();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 0.1 : 1));
  else if (e.key === 'ArrowRight') video.currentTime = Math.min(dur, video.currentTime + (e.shiftKey ? 0.1 : 1));
});


document.addEventListener('langchange', () => {
  el.playBtn.textContent = video.paused ? t('play') : t('pause');
  if (loaded) renderTimeline();
  renderTexts();
  if (el.msg.textContent && !exporting) say('');
});
