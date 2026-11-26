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
