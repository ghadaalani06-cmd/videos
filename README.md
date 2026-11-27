# Screen Recorder – web app with meeting rooms
Recorder, video editor and meeting rooms. One small Node.js server (no dependencies) serves the app and connects people in meetings.

## Run it on your computer
    node server.js
then open http://localhost:8080 in Chrome or Edge. Open the same address in a second tab to try a meeting.
(Camera, microphone and screen capture need HTTPS or localhost.)

## Put it online so other people can join your meetings
You need a host that runs Node.js and gives you HTTPS (Render, Railway, Fly.io, a VPS...). Upload this folder, set the start command to `node server.js` (or `npm start`) and open the address it gives you. A Dockerfile is included.

### Easiest free option: Render
1. Put this folder in a GitHub repository.
2. Create a free account at render.com (no card needed), choose New > Blueprint and pick the repository. `render.yaml` is included.
3. When it finishes, Render shows an address like https://screen-recorder-meet.onrender.com. Open /room.html on it, or paste the address into the extension's "Server address" box.
Free Render services sleep when idle, so the first visit can take about a minute. Open the address a minute before a meeting.
- Video and audio go directly between people. The server only relays connection setup, chat, captions and mic/camera status.
- Up to 8 people per meeting. Most home and office networks connect directly; a few strict networks need a TURN relay. Add one with the environment variable ICE_SERVERS, for example:
  ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"user","credential":"pass"}]'

## Recorder, editor and offline use only (no meetings)
Static hosting is enough (Vercel, Netlify, GitHub Pages): upload the files; the meeting rooms just need the Node server.

Once online over HTTPS, Chrome and Edge show an "Install app" button.

# تطبيق ويب – مسجّل الشاشة
للتجربة محليًا: شغّل node server.js ثم افتح http://localhost:8080 في Chrome أو Edge، وافتح العنوان نفسه في تبويب ثانٍ لتجربة اجتماع.
لكي ينضم إليك الآخرون ارفع المجلد إلى استضافة تشغّل Node.js وتوفر HTTPS (مثل Render أو Railway أو Fly.io) واجعل أمر التشغيل node server.js.
الفيديو والصوت ينتقلان مباشرة بين المشاركين، والخادم يمرّر فقط إعداد الاتصال والدردشة والنص المباشر. الحد الأقصى 8 أشخاص في الاجتماع.
