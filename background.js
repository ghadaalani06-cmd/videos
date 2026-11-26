// Opens (or focuses) the recorder page when the toolbar icon is clicked.
const RECORDER_URL = chrome.runtime.getURL('recorder.html');

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: RECORDER_URL });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: RECORDER_URL });
  }
});

// Shows a REC badge on the toolbar icon while recording.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'recording-state') {
    chrome.action.setBadgeBackgroundColor({ color: msg.paused ? '#B7791F' : '#D92D20' });
    chrome.action.setBadgeText({ text: msg.active ? (msg.paused ? 'II' : 'REC') : '' });
  }
});
