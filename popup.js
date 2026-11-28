const statusText = document.getElementById("statusText");
document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", async () => {
    const page = button.dataset.page;
    button.disabled = true;
    try {
      const target = chrome.runtime.getURL(page);
      const tabs = await chrome.tabs.query({});
      const existing = tabs.find(tab => tab.url === target);
      if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: target });
      }
      window.close();
    } catch (error) {
      statusText.textContent = "Could not open page. Try again.";
      button.disabled = false;
    }
  });
});

chrome.action.getBadgeText({}, text => {
  if (chrome.runtime.lastError) return;
  if (text === "REC") statusText.textContent = "Recording is in progress";
  else if (text === "II") statusText.textContent = "Recording is paused";
});
