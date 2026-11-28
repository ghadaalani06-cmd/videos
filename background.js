// Opens or focuses one of the extension's tools.
const ROUTES = {
  "open-recorder": "recorder.html",
  "open-meeting": "room.html",
  "open-editor": "editor.html"
};

async function openTool(page) {
  const target = chrome.runtime.getURL(page);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.url === target);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: target });
  }
}

chrome.action.onClicked.addListener(() => openTool("recorder.html"));

chrome.commands.onCommand.addListener(command => {
  const page = ROUTES[command];
  if (page) openTool(page);
});

// Keep the toolbar badge synchronized with the recorder's state.
chrome.runtime.onMessage.addListener(msg => {
  if (msg && msg.type === "recording-state") {
    chrome.action.setBadgeBackgroundColor({ color: msg.paused ? "#B7791F" : "#D92D20" });
    chrome.action.setBadgeText({ text: msg.active ? (msg.paused ? "II" : "REC") : "" });
  }
});
