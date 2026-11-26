/**
 * Minimal self-hosted WebRTC signaling server
 * Rooms are identified by short codes.
 * No media passes through this server — only signaling.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3001;

// roomId -> Set of socketIds
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('create-room', (cb) => {
    let code;
    do {
      code = generateRoomCode();
    } while (rooms.has(code));

    rooms.set(code, new Set([socket.id]));
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;

    console.log(`Room ${code} created by ${socket.id}`);
    cb({ ok: true, code });
  });

  socket.on('join-room', ({ code }, cb) => {
    code = (code || '').toUpperCase().trim();
    if (!rooms.has(code)) {
      return cb({ ok: false, error: 'Room not found' });
    }

    const room = rooms.get(code);
    room.add(socket.id);
    socket.join(code);
    socket.roomCode = code;

    // Notify others
    socket.to(code).emit('peer-joined', { id: socket.id });

    // Send list of existing peers to the new joiner
    const peers = [...room].filter(id => id !== socket.id);
    cb({ ok: true, code, peers });

    console.log(`${socket.id} joined ${code}`);
  });

  // WebRTC signaling relay
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Broadcast to whole room (useful for "new stream available" etc.)
  socket.on('room-message', ({ type, payload }) => {
    if (socket.roomCode) {
      socket.to(socket.roomCode).emit('room-message', {
        from: socket.id,
        type,
        payload
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    if (socket.roomCode && rooms.has(socket.roomCode)) {
      const room = rooms.get(socket.roomCode);
      room.delete(socket.id);
      socket.to(socket.roomCode).emit('peer-left', { id: socket.id });

      if (room.size === 0) {
        rooms.delete(socket.roomCode);
        console.log(`Room ${socket.roomCode} deleted (empty)`);
      }
    }
  });
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Recorder Signaling Server',
    rooms: rooms.size,
    version: '1.0.0'
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Signaling server running on http://localhost:${PORT}`);
  console.log('   Open web-app or load the extension and start a meeting.\n');
});
