const BRIDGE_URL = "http://127.0.0.1:33179";
const PENDING_CAPTURE_KEY = "beastPendingCapture";

const projectSelect = document.querySelector("#project-select");
const refreshProjectsButton = document.querySelector("#refresh-projects");
const useCurrentTabButton = document.querySelector("#use-current-tab");
const form = document.querySelector("#capture-form");
const titleInput = document.querySelector("#capture-title");
const urlInput = document.querySelector("#capture-url");
const noteInput = document.querySelector("#capture-note");
const selectionInput = document.querySelector("#selection-text");
const stackTitleInput = document.querySelector("#stack-title");
const includeScreenshotInput = document.querySelector("#include-screenshot");
const statusLine = document.querySelector("#status");

refreshProjectsButton.addEventListener("click", () => {
  void loadProjects();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") return;

  const pendingChange = changes[PENDING_CAPTURE_KEY];
  if (!pendingChange?.newValue) return;

  void applyPendingCapture(pendingChange.newValue);
});

window.addEventListener("focus", () => {
  void loadPendingCapture();
});

useCurrentTabButton.addEventListener("click", () => {
  void loadCurrentTab();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveCapture();
});

void boot();

async function boot() {
  await Promise.all([loadProjects(), loadPendingCapture()]);

  if (!titleInput.value || !urlInput.value) {
    await loadCurrentTab();
  }
}

async function loadProjects() {
  try {
    setStatus("Refreshing Beast projects...");
    const response = await fetch(`${BRIDGE_URL}/projects`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    const projects = payload.projects ?? [];

    projectSelect.textContent = "";

    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.title || project.path || project.id;
      option.selected = project.id === payload.activeProjectId;
      projectSelect.append(option);
    }

    setStatus(projects.length === 0 ? "No saved Beast projects registered." : "Connected to Beast.");
  } catch {
    projectSelect.textContent = "";
    setStatus("Open Beast desktop with a saved project.");
  }
}

async function loadPendingCapture() {
  const stored = await chrome.storage.session.get(PENDING_CAPTURE_KEY);
  const pending = stored[PENDING_CAPTURE_KEY];
  if (!pending) return;

  await applyPendingCapture(pending);
}

async function applyPendingCapture(pending) {
  titleInput.value = pending.title ?? "";
  urlInput.value = pending.url ?? "";
  selectionInput.value = pending.selectionText ?? "";
  await chrome.storage.session.remove(PENDING_CAPTURE_KEY);
  setStatus(selectionInput.value ? "Selection loaded from context menu." : "Page loaded from context menu.");
}

async function loadCurrentTab() {
  setStatus("Reading current tab...");
  const tab = await activeTab();
  if (!tab?.id) {
    setStatus("No active tab available.");
    return;
  }

  titleInput.value = tab.title ?? "";
  urlInput.value = tab.url ?? "";
  selectionInput.value = await selectedText(tab.id);
  setStatus(selectionInput.value ? "Current tab and selection loaded." : "Current tab loaded. No selected text found.");
}

async function saveCapture() {
  const projectId = projectSelect.value;
  if (!projectId) {
    setStatus("Choose a Beast project.");
    return;
  }

  const tab = await activeTab();
  const screenshot = includeScreenshotInput.checked && tab?.windowId != null ? await captureScreenshot(tab.windowId) : undefined;
  const payload = {
    projectId,
    stackTitle: stackTitleInput.value.trim() || "Chrome Captures",
    title: titleInput.value.trim(),
    url: urlInput.value.trim(),
    note: noteInput.value.trim(),
    selectionText: selectionInput.value.trim(),
    screenshot,
  };

  try {
    setStatus("Saving capture to Beast...");
    const response = await fetch(`${BRIDGE_URL}/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(await response.text());
    setStatus("Capture saved to Beast.");
    noteInput.value = "";
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Capture failed.");
  }
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function selectedText(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => String(window.getSelection?.() ?? "").trim(),
    });
    return results[0]?.result ?? "";
  } catch {
    return "";
  }
}

async function captureScreenshot(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "jpeg",
    quality: 92,
  });
  return {
    dataUrl,
    filename: `chrome-capture-${Date.now()}.jpg`,
  };
}

function setStatus(message) {
  statusLine.textContent = message;
}
