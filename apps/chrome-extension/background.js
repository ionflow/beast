const PENDING_CAPTURE_KEY = "beastPendingCapture";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "beast-capture-selection",
    title: "Capture selection in Beast",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "beast-capture-page",
    title: "Capture page in Beast",
    contexts: ["page", "link"],
  });

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const pendingCapture = {
    selectionText: info.selectionText ?? "",
    title: tab.title ?? "",
    url: info.linkUrl ?? tab.url ?? "",
  };

  await chrome.storage.session.set({ [PENDING_CAPTURE_KEY]: pendingCapture });

  if (tab.windowId != null) {
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});
