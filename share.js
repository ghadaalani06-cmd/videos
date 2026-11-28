(() => {
  if (document.getElementById('screenstudioShare')) return;
  const isArabic = () => document.documentElement.lang === 'ar' || document.documentElement.dir === 'rtl';
  const button = document.createElement('button');
  button.id = 'screenstudioShare';
  button.type = 'button';
  button.className = 'ss-share-button';
  button.setAttribute('aria-label', 'Share ScreenStudio');
  const toast = document.createElement('div');
  toast.className = 'ss-share-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.append(button, toast);
  const labels = () => isArabic()
    ? {button:'مشاركة التطبيق', shared:'تم فتح قائمة المشاركة', copied:'تم نسخ رابط ScreenStudio', failed:'تعذّر نسخ الرابط'}
    : {button:'Share app', shared:'Share menu opened', copied:'ScreenStudio link copied', failed:'Could not copy the link'};
  let toastTimer;
  function notify(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }
  function render() {
    button.textContent = '↗ ' + labels().button;
    button.setAttribute('aria-label', labels().button);
  }
  render();
  button.addEventListener('click', async () => {
    const url = new URL('./', window.location.href).href;
    const data = { title: 'ScreenStudio', text: isArabic() ? 'جرّب ScreenStudio لتسجيل الشاشة والكاميرا وتحرير الفيديو.' : 'Try ScreenStudio to record your screen and camera, and edit videos.', url };
    if (navigator.share) {
      try { await navigator.share(data); notify(labels().shared); }
      catch (error) { if (error && error.name !== 'AbortError') notify(labels().failed); }
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
      else {
        const field = document.createElement('textarea');
        field.value = url; field.setAttribute('readonly', '');
        field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.select();
        const ok = document.execCommand('copy'); field.remove();
        if (!ok) throw new Error('Copy unavailable');
      }
      notify(labels().copied);
    } catch (_) { notify(labels().failed); }
  });
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] });
})();