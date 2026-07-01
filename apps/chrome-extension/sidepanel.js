const BRIDGE_URL = "http://127.0.0.1:33179";
const PENDING_CAPTURE_KEY = "beastPendingCapture";
const DEFAULT_STACK_TITLE = "Chrome Captures";

const projectSelect = document.querySelector("#project-select");
const refreshProjectsButton = document.querySelector("#refresh-projects");
const useCurrentTabButton = document.querySelector("#use-current-tab");
const form = document.querySelector("#capture-form");
const titleInput = document.querySelector("#capture-title");
const urlInput = document.querySelector("#capture-url");
const noteInput = document.querySelector("#capture-note");
const selectionInput = document.querySelector("#selection-text");
const stackPicker = document.querySelector("#stack-picker");
const stackSelect = document.querySelector("#stack-select");
const newStackButton = document.querySelector("#new-stack");
const stackCreate = document.querySelector("#stack-create");
const newStackTitleInput = document.querySelector("#new-stack-title");
const cancelNewStackButton = document.querySelector("#cancel-new-stack");
const saveNewStackButton = document.querySelector("#save-new-stack");
const includeScreenshotInput = document.querySelector("#include-screenshot");
const statusLine = document.querySelector("#status");

let projects = [];

refreshProjectsButton.addEventListener("click", () => {
  void loadProjects();
});

projectSelect.addEventListener("change", () => {
  renderStackOptions({ useMostRecent: true });
});

newStackButton.addEventListener("click", () => {
  showStackCreate();
});

cancelNewStackButton.addEventListener("click", () => {
  hideStackCreate();
});

saveNewStackButton.addEventListener("click", () => {
  void saveNewStack();
});

newStackTitleInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    hideStackCreate();
  }

  if (event.key === "Enter") {
    event.preventDefault();
    void saveNewStack();
  }
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
    const previousProjectId = projectSelect.value;
    const previousStackId = stackSelect.value;
    const response = await fetch(`${BRIDGE_URL}/projects`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    projects = Array.isArray(payload.projects) ? payload.projects : [];
    const preferredProjectId = projects.some((project) => project.id === previousProjectId)
      ? previousProjectId
      : payload.activeProjectId;

    projectSelect.textContent = "";

    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.title || project.path || project.id;
      option.selected = project.id === preferredProjectId;
      projectSelect.append(option);
    }

    if (preferredProjectId && projects.some((project) => project.id === preferredProjectId)) {
      projectSelect.value = preferredProjectId;
    }

    renderStackOptions({
      preferredStackId: previousProjectId === projectSelect.value ? previousStackId : undefined,
      useMostRecent: true,
    });
    hideStackCreate();
    if (projects.length === 0) {
      setStatus("No saved Beast projects registered.", "error");
    } else {
      setStatus("Connected to Beast.");
    }
  } catch {
    projects = [];
    projectSelect.textContent = "";
    stackSelect.textContent = "";
    setStatus("Open Beast desktop with a saved project.", "error");
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
    setStatus("No active tab available.", "error");
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
    setStatus("Choose a Beast project.", "error");
    return;
  }

  if (isCreatingStack()) {
    setStatus("Save or cancel the new stack first.", "error");
    return;
  }

  const selectedStack = selectedStackOption();
  const tab = await activeTab();
  const screenshot = includeScreenshotInput.checked && tab?.windowId != null ? await captureScreenshot(tab.windowId) : undefined;
  const payload = {
    projectId,
    stackId: selectedStack?.value || undefined,
    stackTitle: selectedStack?.dataset.title || DEFAULT_STACK_TITLE,
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
    await loadProjects();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Capture failed.", "error");
  }
}

async function saveNewStack() {
  const projectId = projectSelect.value;
  if (!projectId) {
    setStatus("Choose a Beast project.", "error");
    return;
  }

  const title = newStackTitleInput.value.trim();
  if (!title) {
    setStatus("Name the new stack before saving.", "error");
    newStackTitleInput.focus();
    return;
  }

  try {
    setStatus("Saving research stack...");
    saveNewStackButton.disabled = true;
    const response = await fetch(`${BRIDGE_URL}/stacks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title }),
    });

    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    const stack = payload.stack;
    if (!stack?.id) throw new Error("Beast did not return the saved stack.");

    upsertProjectStack(projectId, stack);
    hideStackCreate();
    renderStackOptions({ preferredStackId: stack.id });
    setStatus("Research stack saved.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not save research stack.", "error");
  } finally {
    saveNewStackButton.disabled = false;
  }
}

function renderStackOptions({ preferredStackId, useMostRecent = false } = {}) {
  const project = selectedProject();
  const stacks = sortedStacks(project?.stacks);
  stackSelect.textContent = "";

  if (stacks.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.dataset.title = DEFAULT_STACK_TITLE;
    option.textContent = `${DEFAULT_STACK_TITLE} (new on save)`;
    stackSelect.append(option);
    stackSelect.disabled = !project;
    return;
  }

  for (const stack of stacks) {
    const option = document.createElement("option");
    option.value = stack.id;
    option.dataset.title = stack.title || DEFAULT_STACK_TITLE;
    option.textContent = stack.title || DEFAULT_STACK_TITLE;
    stackSelect.append(option);
  }

  const defaultStackId = preferredStackId || (useMostRecent ? stacks[0]?.id : undefined);
  if (defaultStackId && stacks.some((stack) => stack.id === defaultStackId)) {
    stackSelect.value = defaultStackId;
  }

  stackSelect.disabled = false;
}

function sortedStacks(stacks) {
  if (!Array.isArray(stacks)) return [];
  return [...stacks]
    .filter((stack) => stack && typeof stack.id === "string")
    .sort((a, b) => stackTime(b.createdAt, b.updatedAt) - stackTime(a.createdAt, a.updatedAt));
}

function stackTime(createdAt, updatedAt) {
  const createdTime = Date.parse(createdAt ?? "");
  if (Number.isFinite(createdTime)) return createdTime;
  const updatedTime = Date.parse(updatedAt ?? "");
  return Number.isFinite(updatedTime) ? updatedTime : 0;
}

function selectedProject() {
  return projects.find((project) => project.id === projectSelect.value);
}

function selectedStackOption() {
  return stackSelect.selectedOptions[0];
}

function upsertProjectStack(projectId, stack) {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) return;

  const stacks = Array.isArray(project.stacks) ? project.stacks : [];
  project.stacks = [...stacks.filter((candidate) => candidate.id !== stack.id), stack];
}

function showStackCreate() {
  stackPicker.classList.add("is-hidden");
  stackCreate.classList.remove("is-hidden");
  newStackTitleInput.value = "";
  newStackTitleInput.focus();
}

function hideStackCreate() {
  newStackTitleInput.value = "";
  stackCreate.classList.add("is-hidden");
  stackPicker.classList.remove("is-hidden");
}

function isCreatingStack() {
  return !stackCreate.classList.contains("is-hidden");
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

function setStatus(message, tone = "info") {
  statusLine.textContent = message;
  statusLine.dataset.tone = tone;
}
