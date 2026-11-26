// Tiny IndexedDB helper so the recorder page can hand a finished recording to the editor page.
const ClipStore = {
  open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('recorder-clips', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('clips');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  async put(key, blob) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('clips', 'readwrite');
      tx.objectStore('clips').put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('clips').objectStore('clips').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
};
