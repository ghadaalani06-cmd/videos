FREE SCREEN & VIDEO RECORDER — WEB APP

This folder is a browser-based version of the supplied Chrome extension project.
It keeps the recorder and editor pages and adds a browser-friendly home page at index.html.

RUN LOCALLY
1. Extract this folder.
2. Serve it from localhost (recommended): python -m http.server 8000
3. Open http://localhost:8000 in Chrome or Microsoft Edge.

IMPORTANT BROWSER REQUIREMENTS
- Screen capture uses getDisplayMedia and requires a secure context: HTTPS or localhost.
- The user must select the screen, window, or tab in the browser's own picker.
- Microphone and camera require browser permission.
- MediaRecorder format support varies by browser. WebM is generally the safest option.
- Direct-to-file saving depends on showSaveFilePicker support and browser permissions.
- Keep the recorder tab open while recording. Browser tab recording cannot continue if the tab is closed.

MEETINGS
The meeting page opens rooms on the public Jitsi service (meet.jit.si). This web app does not host
its own meeting infrastructure, provide private-room authentication, or guarantee availability
of that third-party service. For a production product, configure a managed or self-hosted Jitsi/
LiveKit deployment, authentication, privacy policy, and recording infrastructure.

DEPLOY
Upload the contents of this folder to any static HTTPS host. Do not upload the extension manifest
or service worker; they are not needed by the web app.

BILINGUAL UI & CAMERA BACKGROUNDS
- Use the language toggle at the top-right (العربية / English) to switch languages. Arabic mode uses right-to-left layout.
- Camera background choices include original, blur, office, studio, beach, solid color, and a user-uploaded image.
- Background replacement uses MediaPipe Selfie Segmentation in the browser. The model is loaded from jsDelivr on first use; internet access is required for that first load. Camera frames are processed locally and are not uploaded by this feature.
- Background replacement applies to the camera layer in screen recordings when the camera overlay is enabled. It does not automatically change the backgrounds of third-party Jitsi meeting participants.
