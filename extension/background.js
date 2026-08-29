// KDP Book Analytics — background service worker.
//
// Opens the native side panel on Amazon book pages via the toolbar icon.
//
// The click is the source of truth: `activeTab` lets chrome.action.onClicked
// see the real tab.url, so we open the panel only for Amazon origins and do
// nothing elsewhere. Explicit chrome.sidePanel.open() (allowed inside a user
// gesture on Chrome 116+) makes the very first click deterministic — we do
// not rely on the auto `openPanelOnActionClick` behavior, which must be
// re-armed by a running service worker and silently fails otherwise.

const AMAZON_ORIGINS = [
  "https://www.amazon.com",
  "https://www.amazon.co.uk",
  "https://www.amazon.ca",
  "https://www.amazon.com.au",
  "https://www.amazon.de",
  "https://www.amazon.co.jp",
];

function isAmazonUrl(raw) {
  try {
    const u = new URL(raw || "");
    return AMAZON_ORIGINS.includes(u.origin);
  } catch (e) {
    return false;
  }
}

// Explicitly disable the native auto-open so WE control it in onClicked.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  console.log("[kdp] onInstalled; panel behavior armed");
});

// Toolbar icon: open the panel (Amazon pages only). activeTab makes
// tab.url visible here. chrome.sidePanel.open() MUST be called synchronously
// inside the click handler (a user gesture) — any await/.then before it
// expires the gesture and Chrome rejects the call.
chrome.action.onClicked.addListener((tab) => {
  console.log("[kdp] onClicked", tab && tab.id, tab && tab.url);
  if (!tab || tab.id === undefined || tab.id === null) return;
  if (!isAmazonUrl(tab.url)) {
    console.log("[kdp] non-amazon tab; ignoring");
    return;
  }
  if (!chrome.sidePanel.open) {
    console.log("[kdp] chrome.sidePanel.open unavailable (Chrome <116)");
    return;
  }
  chrome.sidePanel.open({ tabId: tab.id }).then(
    () => console.log("[kdp] panel opened", tab.id),
    (e) => console.log("[kdp] sidePanel.open failed", e)
  );
});