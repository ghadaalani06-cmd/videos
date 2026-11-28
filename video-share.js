(() => {
  const button = document.getElementById('shareVideo');
  if (!button) return;
  let currentBlob = null, currentName = 'ScreenStudio-video.webm';
  const isArabic = () => (localStorage.getItem('lang') || document.documentElement.lang || 'en') === 'ar';
  const updateLabel = () => { button.textContent = isArabic() ? 'مشاركة الفيديو' : 'Share video'; };
  updateLabel();
  window.setShareableVideo = (blob, filename) => {
    currentBlob = blob || null;
    currentName = filename || 'ScreenStudio-video.webm';
    button.hidden = !currentBlob;
  };
  button.addEventListener('click', async () => {
    if (!currentBlob) return;
    const file = new File([currentBlob], currentName, { type: currentBlob.type || 'video/webm' });
    try {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'ScreenStudio video' });
      } else {
        const note = isArabic()
          ? 'مشاركة الملفات غير مدعومة في هذا المتصفح. استخدم زر تنزيل الفيديو.'
          : 'File sharing is not supported in this browser. Use Download video instead.';
        const msg = document.getElementById('msg');
        if (msg) { msg.textContent = note; msg.classList.remove('error'); }
      }
    } catch (error) {
      if (error && error.name !== 'AbortError') {
        const msg = document.getElementById('msg');
        if (msg) { msg.textContent = isArabic() ? 'تعذرت مشاركة الفيديو.' : 'Could not share the video.'; msg.classList.add('error'); }
      }
    }
  });
  window.addEventListener('storage', updateLabel);
})();