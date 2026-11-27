// Meeting server: serves the web app AND helps people find each other (WebRTC signaling).
// No dependencies. Run:  node server.js   (PORT and ICE_SERVERS are optional environment variables)
// Video and audio travel directly between participants. This server only relays small messages:
// connection setup, chat, live captions and mic/camera status. Nothing is stored.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const MAX_PEOPLE = 50;
let ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
try { if (process.env.ICE_SERVERS) ICE = JSON.parse(process.env.ICE_SERVERS); } catch (e) { console.error('ICE_SERVERS is not valid JSON, using default'); }

const rooms = new Map(); // roomId -> Map(peerId -> { res, name })
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8',
};
const PRIVATE = new Set(['server.js', 'package.json', 'Dockerfile']);
const ROOM_RE = /^[a-z0-9-]{4,48}$/;
const PEER_RE = /^[a-z0-9]{6,32}$/;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function sse(res, event, data) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}
function broadcast(room, exceptId, event, data) {
  for (const [id, p] of room) if (id !== exceptId) sse(p.res, event, data);
}
function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (u.pathname === '/api/health') return json(res, 200, { ok: true });
  if (u.pathname === '/api/config') return json(res, 200, { iceServers: ICE, maxPeople: MAX_PEOPLE });

  if (u.pathname === '/api/events' && req.method === 'GET') {
    const roomId = (u.searchParams.get('room') || '').toLowerCase();
    const peerId = (u.searchParams.get('peer') || '').toLowerCase();
    const name = (u.searchParams.get('name') || 'Guest').slice(0, 40);
    if (!ROOM_RE.test(roomId) || !PEER_RE.test(peerId)) return json(res, 400, { error: 'bad request' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    let room = rooms.get(roomId);
    if (!room) { room = new Map(); rooms.set(roomId, room); }
    if (room.size >= MAX_PEOPLE && !room.has(peerId)) { sse(res, 'full', {}); return res.end(); }
    const others = [...room.entries()].map(([id, p]) => ({ id, name: p.name }));
    room.set(peerId, { res, name });
    sse(res, 'welcome', { id: peerId, peers: others });
    broadcast(room, peerId, 'peer-joined', { id: peerId, name });
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) {} }, 20000);
    req.on('close', () => {
      clearInterval(hb);
      const cur = rooms.get(roomId);
      if (cur && cur.get(peerId) && cur.get(peerId).res === res) {
        cur.delete(peerId);
        broadcast(cur, peerId, 'peer-left', { id: peerId });
        if (!cur.size) rooms.delete(roomId);
      }
    });
    return;
  }

  if (u.pathname === '/api/send' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const room = rooms.get(String(body.room || '').toLowerCase());
      if (!room || !room.has(body.from)) return json(res, 404, { error: 'not in room' });
      const msg = { from: body.from, type: String(body.type || '').slice(0, 20), payload: body.payload };
      if (body.to) { const t = room.get(body.to); if (t) sse(t.res, 'msg', msg); }
      else broadcast(room, body.from, 'msg', msg);
      res.writeHead(204); return res.end();
    } catch (e) { return json(res, 400, { error: 'bad request' }); }
  }

  // ---- static files ----
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const base = path.basename(file);
  if (!file.startsWith(ROOT) || PRIVATE.has(base) || base.startsWith('.')) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log('Meeting server running on http://localhost:' + PORT));
