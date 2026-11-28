const statusText = document.getElementById("statusText");
const themeToggle = document.getElementById("themeToggle");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  const light = theme === "light";
  themeToggle.textContent = light ? "🌙" : "☀️";
  themeToggle.title = light ? "Switch to dark mode" : "Switch to light mode";
  themeToggle.setAttribute("aria-label", themeToggle.title);
}

let savedTheme = "dark";
try { savedTheme = localStorage.getItem("screenstudio-theme") || "dark"; } catch (_) {}
applyTheme(savedTheme);
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  try { localStorage.setItem("screenstudio-theme", next); } catch (_) {}
});

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

const langToggle=document.getElementById("langToggle");
const popupCopy={en:{title:"Screen Recorder",tag:"Capture, meet and create",ready:"Ready when you are",record:"Record screen",recordSub:"Capture screen, camera and audio",meeting:"Start a meeting",meetingSub:"Meet people with live captions",editor:"Video editor",editorSub:"Trim and prepare your recordings",shortcuts:"Keyboard shortcuts",openRecorder:"Open recorder",openMeeting:"Open meeting",openEditor:"Open editor",free:"Free · No watermark",about:"About extension ↗"},ar:{title:"مسجّل الشاشة",tag:"سجّل واجتمع وأبدع",ready:"جاهز عندما تكون مستعدًا",record:"تسجيل الشاشة",recordSub:"سجّل الشاشة والكاميرا والصوت",meeting:"بدء اجتماع",meetingSub:"اجتمع مع الآخرين مع النص المباشر",editor:"محرر الفيديو",editorSub:"قصّ تسجيلاتك وجهّزها",shortcuts:"اختصارات لوحة المفاتيح",openRecorder:"فتح المسجّل",openMeeting:"فتح الاجتماع",openEditor:"فتح المحرر",free:"مجاني · بلا علامة مائية",about:"حول الإضافة ↗"}};
function applyPopupLanguage(l){const d=popupCopy[l]||popupCopy.en;document.documentElement.lang=l;document.documentElement.dir=l==="ar"?"rtl":"ltr";document.querySelector(".brand h1").textContent=d.title;document.querySelector(".brand p").textContent=d.tag;document.getElementById("statusText").textContent=d.ready;const a=[...document.querySelectorAll(".action")];[[d.record,d.recordSub],[d.meeting,d.meetingSub],[d.editor,d.editorSub]].forEach((v,i)=>{if(a[i]){a[i].querySelector("strong").textContent=v[0];a[i].querySelector("small").textContent=v[1]}});document.querySelector(".shortcuts h2").textContent=d.shortcuts;[d.openRecorder,d.openMeeting,d.openEditor].forEach((v,i)=>{const e=document.querySelectorAll(".shortcuts p span")[i];if(e)e.textContent=v});document.querySelector("footer span").textContent=d.free;document.querySelector("footer a").textContent=d.about;langToggle.textContent=l==="ar"?"English":"العربية";try{localStorage.setItem("lang",l)}catch(_){}}
let popupLang="en";try{popupLang=localStorage.getItem("lang")||((navigator.language||"").toLowerCase().startsWith("ar")?"ar":"en")}catch(_){}applyPopupLanguage(popupLang);langToggle.addEventListener("click",()=>{popupLang=popupLang==="ar"?"en":"ar";applyPopupLanguage(popupLang)});
