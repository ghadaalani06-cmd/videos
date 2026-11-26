# Free Screen & Video Recorder (fixed meetings)

Version 1.7.0 — Meetings now use **self-hosted WebRTC** instead of Jitsi.

## What's fixed

- Real multi-user video meetings (camera + screen share)
- Short room codes
- Local recording of the meeting (no cloud, no watermark)
- Configurable signaling server URL (works with any host)
- Same polished UI as the recorder / editor

## How to use meetings

1. **Start the signaling server** (one time):

```bash
cd server
npm install
node index.js
# runs on http://localhost:3001
```

For production, deploy `server/` to Railway, Render, Fly.io or a VPS (needs persistent WebSockets + HTTPS).

2. Load the extension:
   - `chrome://extensions` → Developer mode → Load unpacked → select this folder

3. Open the extension → click **Start / join meeting**
4. Paste your signaling server URL → Save
5. Create a room (or join with a code)

## Files

| File | Purpose |
|------|---------|
| `recorder.html` + `recorder.js` | Screen / camera recorder |
| `editor.html` + `editor.js` | Built-in video editor |
| `meet.html` + `meet.js` | **Self-hosted WebRTC meetings** |
| `server/` | Signaling server (Socket.IO) |
| `background.js` | Opens the recorder tab + REC badge |

## Notes

- Media is peer-to-peer. Only signaling goes through your server.
- For users behind strict NATs, add a TURN server to the ICE config in `meet.js`.
- The extension works fully offline for recording & editing. Meetings need the signaling server.
