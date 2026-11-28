(() => {
  const appUrl = new URL('./', window.location.href).href;
  const arabic = () => document.documentElement.lang.toLowerCase().startsWith('ar') ||
    document.documentElement.dir === 'rtl';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'app-share-button';
  button.setAttribute('aria-label', 'Share ScreenStudio');
  const toast = document.createElement('div');
  toast.className = 'app-share-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const label = () => arabic() ? 'مشاركة التطبيق' : 'Share app';
  const message = (kind) => {
    if (arabic()) return kind === 'copied' ? 'تم نسخ رابط التطبيق' : 'تعذرت المشاركة. يمكنك نسخ الرابط من شريط العنوان.';
    return kind === 'copied' ? 'App link copied' : 'Sharing is not available. You can copy the link from the address bar.';
  };
  button.textContent = label();
  document.body.append(button, toast);
  const showToast = (text) => {
    toast.textContent = text;
    toast.classList.add('visible');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
  };
  button.addEventListener('click', async () => {
    const shareData = { title: 'ScreenStudio', text: arabic() ? 'جرّب ScreenStudio لإنشاء وتحرير الفيديوهات.' : 'Try ScreenStudio to record and edit videos.', url: appUrl };
    button.disabled = true;
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(appUrl);
        showToast(message('copied'));
      } else {
        const field = document.createElement('textarea');
        field.value = appUrl;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        showToast(copied ? message('copied') : message('unavailable'));
      }
    } catch (error) {
      if (error && error.name !== 'AbortError') showToast(message('unavailable'));
    } finally {
      button.disabled = false;
    }
  });
  const observer = new MutationObserver(() => {
    button.textContent = label();
    button.setAttribute('aria-label', label());
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] });
})();