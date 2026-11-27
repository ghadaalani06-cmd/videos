# Screen Recorder – web app
Plain static files. No build step and no server code.

## Try it on your computer
    python3 -m http.server 8080
then open http://localhost:8080 in Chrome or Edge.
(Screen, camera and microphone capture need HTTPS or localhost.)

## Put it online (free)
- Vercel / Netlify / Cloudflare Pages: drag this folder into the dashboard, or connect a GitHub repo. Output folder: the root. No build command.
- GitHub Pages: upload the files to a repo and enable Pages.
Once online over HTTPS, Chrome and Edge show an "Install app" button, and it works offline.

# تطبيق ويب – مسجّل الشاشة
ملفات ثابتة فقط، بدون بناء أو خادم.
للتجربة محليًا: شغّل python3 -m http.server 8080 ثم افتح http://localhost:8080 في Chrome أو Edge.
للنشر المجاني: اسحب المجلد إلى Vercel أو Netlify أو Cloudflare Pages. يجب أن يكون الموقع على HTTPS ليعمل تسجيل الشاشة والكاميرا والميكروفون.


## Group meetings (new)
The `meeting.html` page provides link/code-based multi-person video meetings using WebRTC. To enable joining across devices, deploy the signaling server:

1. Install Node.js 18 or newer.
2. In this folder run `npm install` and `npm start` (default port 8787).
3. Deploy the web files over HTTPS and the signaling server with a secure WebSocket URL (`wss://...`).
4. On the Group meeting page, replace the signaling server URL with your deployed `wss://` address.
5. Create a meeting and share the invite link. Guests open the link, enter their name and click Join meeting.

The included signaling server relays connection setup only; audio/video travels peer-to-peer. It is a starter implementation (12-person room limit), not a production conferencing service. For reliable connections across restrictive networks, configure a TURN server and add its credentials to the `iceServers` list in `meeting.js`. Use authentication, rate limiting, TLS, and a privacy policy before public deployment.


## Group meetings
A new `meeting.html` page supports creating a room and inviting others by link/code using WebRTC. To make meetings work between devices, deploy the included Node signaling server: run `npm install` then `npm start` (default port 8787). Host the web files on HTTPS and the signaling server on WSS, then enter that WSS URL in the meeting page. Share the invite link with guests; they open it, enter a name and join. In the browser extension, set the public meeting page URL to your deployed web app `meeting.html` address so invitees get a link they can open outside the extension.

This is a starter peer-to-peer mesh implementation with a 12-person room limit. Audio/video is peer-to-peer; the server relays signaling only. For reliable connections across restrictive networks, configure a TURN server and add credentials to `iceServers` in `meeting.js`. Before public use, add authentication, rate limiting, TLS, and privacy/security review.
