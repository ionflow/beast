export const PROJECT_FILE = "project.json";
export const SCRIPT_FILE = "script.fountain";
export const PANELS_DIR = "panels";
export const BROWSER_PANEL_FILE = `${PANELS_DIR}/browser.json`;
export const PANEL_PREFERENCES_FILE = `${PANELS_DIR}/preferences.json`;
export const CONTEXTS_DIR = `${PANELS_DIR}/contexts`;
export const BEAST_PROJECT_VERSION = 1;

export type RightPanelMode = "preview" | "media" | "notecards" | "images" | "research";
export type PanelViewMode = "stacked" | "grid";

export interface BrowserPanelMetadata {
  currentUrl: string;
  history: string[];
  historyIndex: number;
}

export interface PanelNotecard {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface PanelImagePrompt {
  id: string;
  prompt: string;
  createdAt: string;
}

export type ResearchAssetKind = "image" | "pdf" | "file";
export type ResearchAssetStorage = "project" | "external";

export interface ResearchAsset {
  id: string;
  name: string;
  kind: ResearchAssetKind;
  source: string;
  storage: ResearchAssetStorage;
  mimeType?: string;
  size?: number;
  createdAt: string;
}

export interface ResearchItem {
  id: string;
  type: "website" | "file";
  title: string;
  source: string;
  note: string;
  quote?: string;
  assets: ResearchAsset[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchStack {
  id: string;
  title: string;
  items: ResearchItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PanelContextMetadata {
  notecards: PanelNotecard[];
  imagePrompts: PanelImagePrompt[];
  researchStacks: ResearchStack[];
}

export interface PanelPreferencesMetadata {
  notecardsView: PanelViewMode;
  researchView: PanelViewMode;
}

export interface ProjectPanelsMetadata {
  browser: BrowserPanelMetadata;
  preferences: PanelPreferencesMetadata;
  contexts: Record<string, PanelContextMetadata>;
}

export interface ProjectMetadata {
  version: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  activeDocumentPath: string;
  editor: {
    showOutline: boolean;
    showPreview: boolean;
    rightPanelMode: RightPanelMode;
    rightPanelWidth: number;
    fontSize: number;
  };
  panels: ProjectPanelsMetadata;
  outlineCacheVersion: number;
}

export interface ProjectBundle {
  metadata: ProjectMetadata;
  script: string;
  path?: string;
}

export type ProjectLoadSource =
  | { kind: "files"; files: File[] }
  | { kind: "local" }
  | { kind: "path"; path: string };

export type ProjectSaveTarget =
  | { kind: "local" }
  | { kind: "download" }
  | { kind: "path"; path?: string };

export interface ExportFile {
  name: string;
  content: string;
  mimeType: string;
}

export interface ProjectSaveResult {
  path?: string;
  files?: ExportFile[];
}

export interface StorageAdapter {
  platform: "web" | "tauri";
  createProject(input?: Partial<Pick<ProjectMetadata, "title">> & { script?: string }): ProjectBundle;
  loadProject(source?: ProjectLoadSource): Promise<ProjectBundle>;
  saveProject(bundle: ProjectBundle, target?: ProjectSaveTarget): Promise<ProjectSaveResult>;
  exportProjectFiles(bundle: ProjectBundle): ExportFile[];
}

const LOCAL_DRAFT_KEY = "beast:fountain-editor:draft";
const DEFAULT_SCRIPT = `Title: Untitled
Author: 

INT. WRITING ROOM - DAY

The cursor waits on a clean page.

WRITER
Let's begin.
`;

export function createProjectBundle(input: Partial<Pick<ProjectMetadata, "title">> & { script?: string } = {}): ProjectBundle {
  const now = new Date().toISOString();
  const title = input.title?.trim() || "Untitled";

  return {
    metadata: {
      version: BEAST_PROJECT_VERSION,
      title,
      createdAt: now,
      updatedAt: now,
      appVersion: "0.1.0",
      activeDocumentPath: SCRIPT_FILE,
      editor: {
        showOutline: true,
        showPreview: true,
        rightPanelMode: "preview",
        rightPanelWidth: 420,
        fontSize: 16,
      },
      panels: createProjectPanelsMetadata(),
      outlineCacheVersion: 1,
    },
    script: input.script ?? DEFAULT_SCRIPT,
  };
}

export function createPanelContextMetadata(): PanelContextMetadata {
  return {
    notecards: [],
    imagePrompts: [],
    researchStacks: [],
  };
}

export function validateProjectBundle(bundle: ProjectBundle): ProjectBundle {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Project bundle is missing.");
  }

  if (!bundle.metadata || typeof bundle.metadata !== "object") {
    throw new Error("Project metadata is missing.");
  }

  if (bundle.metadata.version !== BEAST_PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${String(bundle.metadata.version)}.`);
  }

  if (bundle.metadata.activeDocumentPath !== SCRIPT_FILE) {
    throw new Error(`Unsupported active document: ${bundle.metadata.activeDocumentPath}.`);
  }

  if (typeof bundle.script !== "string") {
    throw new Error(`${SCRIPT_FILE} must contain text.`);
  }

  return {
    ...bundle,
    metadata: touchMetadata(bundle.metadata),
  };
}

export function createWebStorageAdapter(): StorageAdapter {
  return {
    platform: "web",
    createProject: createProjectBundle,
    async loadProject(source: ProjectLoadSource = { kind: "local" }) {
      if (source.kind === "files") {
        return loadFromFiles(source.files);
      }

      if (source.kind === "path") {
        throw new Error("Browser builds cannot open native project paths.");
      }

      const stored = globalThis.localStorage?.getItem(LOCAL_DRAFT_KEY);
      if (!stored) return createProjectBundle();
      return validateProjectBundle(JSON.parse(stored) as ProjectBundle);
    },
    async saveProject(bundle: ProjectBundle, target: ProjectSaveTarget = { kind: "local" }) {
      const updated = validateProjectBundle({
        ...bundle,
        metadata: touchMetadata(bundle.metadata),
      });

      if (target.kind === "download") {
        return { files: exportProjectFiles(updated) };
      }

      if (target.kind === "path") {
        throw new Error("Browser builds cannot write native project paths.");
      }

      globalThis.localStorage?.setItem(LOCAL_DRAFT_KEY, JSON.stringify(updated));
      return {};
    },
    exportProjectFiles,
  };
}

export function createTauriStorageAdapter(): StorageAdapter {
  return {
    platform: "tauri",
    createProject: createProjectBundle,
    async loadProject(source?: ProjectLoadSource) {
      const path = source?.kind === "path" ? source.path : await selectDirectory("Open Beast Project");
      if (!path) throw new Error("No project folder selected.");

      const { invoke } = await import("@tauri-apps/api/core");
      const payload = await invoke<TauriProjectPayload>("read_project_bundle", { path });
      const metadata = JSON.parse(payload.projectJson) as ProjectMetadata;

      return validateProjectBundle({
        metadata: mergeMetadataWithPanelFiles(metadata, payload.files ?? []),
        script: payload.script,
        path: payload.path,
      });
    },
    async saveProject(bundle: ProjectBundle, target?: ProjectSaveTarget) {
      const path =
        target?.kind === "path"
          ? target.path ?? (await selectDirectory("Save Beast Project"))
          : bundle.path ?? (await selectDirectory("Save Beast Project"));
      if (!path) throw new Error("No project folder selected.");

      const updated = validateProjectBundle({
        ...bundle,
        path,
        metadata: touchMetadata(bundle.metadata),
      });
      const { invoke } = await import("@tauri-apps/api/core");

      await invoke("write_project_bundle", {
        path,
        projectJson: JSON.stringify(projectMetadataFile(updated.metadata), null, 2),
        script: updated.script,
        projectFiles: exportProjectFiles(updated).filter((file) => file.name !== PROJECT_FILE && file.name !== SCRIPT_FILE),
      });

      return { path };
    },
    exportProjectFiles,
  };
}

interface TauriProjectPayload {
  path: string;
  projectJson: string;
  script: string;
  files?: TauriProjectFilePayload[];
}

interface TauriProjectFilePayload {
  name: string;
  content: string;
}

async function selectDirectory(title: string): Promise<string | undefined> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title,
    directory: true,
    multiple: false,
  });

  if (Array.isArray(selected)) return selected[0];
  return selected ?? undefined;
}

async function loadFromFiles(files: File[]): Promise<ProjectBundle> {
  const projectFile = findBundleFile(files, PROJECT_FILE);
  const scriptFile = findBundleFile(files, SCRIPT_FILE);

  if (!projectFile) throw new Error(`${PROJECT_FILE} is missing from the selected project bundle.`);
  if (!scriptFile) throw new Error(`${SCRIPT_FILE} is missing from the selected project bundle.`);

  const [projectJson, script, panelFiles] = await Promise.all([projectFile.text(), scriptFile.text(), loadPanelFiles(files)]);
  const metadata = JSON.parse(projectJson) as ProjectMetadata;

  return validateProjectBundle({
    metadata: mergeMetadataWithPanelFiles(metadata, panelFiles),
    script,
  });
}

function findBundleFile(files: File[], name: string): File | undefined {
  return files.find((file) => {
    const path = normalizeBundlePath(bundleFilePath(file));
    return file.name === name || path === name || path.endsWith(`/${name}`);
  });
}

function exportProjectFiles(bundle: ProjectBundle): ExportFile[] {
  const updated = validateProjectBundle({
    ...bundle,
    metadata: touchMetadata(bundle.metadata),
  });

  return [
    {
      name: PROJECT_FILE,
      content: JSON.stringify(projectMetadataFile(updated.metadata), null, 2),
      mimeType: "application/json",
    },
    {
      name: SCRIPT_FILE,
      content: updated.script,
      mimeType: "text/plain;charset=utf-8",
    },
    {
      name: BROWSER_PANEL_FILE,
      content: JSON.stringify(updated.metadata.panels.browser, null, 2),
      mimeType: "application/json",
    },
    {
      name: PANEL_PREFERENCES_FILE,
      content: JSON.stringify(updated.metadata.panels.preferences, null, 2),
      mimeType: "application/json",
    },
    ...Object.entries(updated.metadata.panels.contexts).map(([key, context]) => ({
      name: contextPanelFileName(key),
      content: JSON.stringify({ key, ...context }, null, 2),
      mimeType: "application/json",
    })),
  ];
}

async function loadPanelFiles(files: File[]): Promise<TauriProjectFilePayload[]> {
  const panelFiles = files.filter((file) => isPanelFilePath(bundleFilePath(file)));

  return Promise.all(
    panelFiles.map(async (file) => ({
      name: normalizeBundlePath(bundleFilePath(file)),
      content: await file.text(),
    })),
  );
}

function mergeMetadataWithPanelFiles(metadata: ProjectMetadata, files: TauriProjectFilePayload[]): ProjectMetadata {
  const splitPanels = hydrateSplitPanelFiles(files);
  if (!splitPanels) return metadata;

  const legacyPanels = hydrateProjectPanelsMetadata(metadata.panels);
  return {
    ...metadata,
    panels: {
      browser: splitPanels.browser ?? legacyPanels.browser,
      preferences: splitPanels.preferences ?? legacyPanels.preferences,
      contexts: {
        ...legacyPanels.contexts,
        ...splitPanels.contexts,
      },
    },
  };
}

function hydrateSplitPanelFiles(files: TauriProjectFilePayload[]): Partial<ProjectPanelsMetadata> | undefined {
  let browser: BrowserPanelMetadata | undefined;
  let preferences: PanelPreferencesMetadata | undefined;
  const contexts: Record<string, PanelContextMetadata> = {};

  for (const file of files) {
    const path = normalizeBundlePath(file.name);

    try {
      const parsed = JSON.parse(file.content) as unknown;

      if (path === BROWSER_PANEL_FILE) {
        browser = hydrateBrowserPanelMetadata(parsed);
        continue;
      }

      if (path === PANEL_PREFERENCES_FILE) {
        preferences = hydratePanelPreferencesMetadata(parsed);
        continue;
      }

      if (isContextPanelFilePath(path) && isRecord(parsed) && typeof parsed.key === "string") {
        contexts[parsed.key] = hydratePanelContextMetadata(parsed);
      }
    } catch {
      // Optional panel files should not prevent opening the screenplay itself.
    }
  }

  if (!browser && !preferences && Object.keys(contexts).length === 0) return undefined;
  return { browser, preferences, contexts };
}

function projectMetadataFile(metadata: ProjectMetadata): Omit<ProjectMetadata, "panels"> {
  const { panels: _panels, ...projectMetadata } = metadata;
  return projectMetadata;
}

function bundleFilePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function normalizeBundlePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isPanelFilePath(path: string): boolean {
  const normalized = normalizeBundlePath(path);
  return normalized === BROWSER_PANEL_FILE || normalized === PANEL_PREFERENCES_FILE || isContextPanelFilePath(normalized);
}

function isContextPanelFilePath(path: string): boolean {
  const normalized = normalizeBundlePath(path);
  return normalized.startsWith(`${CONTEXTS_DIR}/`) && normalized.endsWith(".json");
}

function contextPanelFileName(contextKey: string): string {
  return `${CONTEXTS_DIR}/${encodeURIComponent(contextKey)}.json`;
}

function touchMetadata(metadata: ProjectMetadata): ProjectMetadata {
  const editor = {
    showOutline: metadata.editor?.showOutline ?? true,
    showPreview: metadata.editor?.showPreview ?? true,
    rightPanelMode: hydrateRightPanelMode(metadata.editor?.rightPanelMode),
    rightPanelWidth: clampPanelWidth(metadata.editor?.rightPanelWidth),
    fontSize: metadata.editor?.fontSize ?? 16,
  };

  return {
    ...metadata,
    title: metadata.title?.trim() || "Untitled",
    editor,
    panels: hydrateProjectPanelsMetadata(metadata.panels),
    updatedAt: new Date().toISOString(),
  };
}

function clampPanelWidth(width: unknown): number {
  if (typeof width !== "number" || !Number.isFinite(width)) return 420;
  return Math.min(Math.max(Math.round(width), 280), 760);
}

function hydrateRightPanelMode(mode: unknown): RightPanelMode {
  if (mode === "browser") return "media";
  if (mode === "preview" || mode === "media" || mode === "notecards" || mode === "images" || mode === "research") return mode;
  return "preview";
}

function createProjectPanelsMetadata(): ProjectPanelsMetadata {
  return {
    browser: {
      currentUrl: "",
      history: [],
      historyIndex: -1,
    },
    preferences: {
      notecardsView: "stacked",
      researchView: "stacked",
    },
    contexts: {},
  };
}

function hydrateProjectPanelsMetadata(panels: unknown): ProjectPanelsMetadata {
  if (!isRecord(panels)) return createProjectPanelsMetadata();

  const browser = hydrateBrowserPanelMetadata(panels.browser);
  const preferences = hydratePanelPreferencesMetadata(panels.preferences);
  const contexts = isRecord(panels.contexts)
    ? Object.fromEntries(
        Object.entries(panels.contexts).map(([key, context]) => [key, hydratePanelContextMetadata(context)]),
      )
    : {};

  return { browser, preferences, contexts };
}

function hydratePanelPreferencesMetadata(preferences: unknown): PanelPreferencesMetadata {
  if (!isRecord(preferences)) return createProjectPanelsMetadata().preferences;

  return {
    notecardsView: preferences.notecardsView === "grid" ? "grid" : "stacked",
    researchView: preferences.researchView === "grid" ? "grid" : "stacked",
  };
}

function hydrateBrowserPanelMetadata(browser: unknown): BrowserPanelMetadata {
  if (!isRecord(browser)) return createProjectPanelsMetadata().browser;

  const history = Array.isArray(browser.history) ? browser.history.filter((entry): entry is string => typeof entry === "string") : [];
  const historyIndex =
    typeof browser.historyIndex === "number" && Number.isFinite(browser.historyIndex)
      ? Math.min(Math.max(Math.round(browser.historyIndex), history.length > 0 ? 0 : -1), history.length - 1)
      : history.length - 1;
  const historyUrl = historyIndex >= 0 ? history[historyIndex] ?? "" : "";
  const currentUrl = typeof browser.currentUrl === "string" ? browser.currentUrl : historyUrl;

  return {
    currentUrl,
    history,
    historyIndex,
  };
}

function hydratePanelContextMetadata(context: unknown): PanelContextMetadata {
  if (!isRecord(context)) return createPanelContextMetadata();

  return {
    notecards: Array.isArray(context.notecards) ? context.notecards.map(hydrateNotecard).filter(isDefined) : [],
    imagePrompts: Array.isArray(context.imagePrompts) ? context.imagePrompts.map(hydrateImagePrompt).filter(isDefined) : [],
    researchStacks: Array.isArray(context.researchStacks)
      ? context.researchStacks.map(hydrateResearchStack).filter(isDefined)
      : [],
  };
}

function hydrateNotecard(card: unknown): PanelNotecard | undefined {
  if (!isRecord(card) || typeof card.id !== "string") return undefined;
  const now = new Date().toISOString();

  return {
    id: card.id,
    title: typeof card.title === "string" ? card.title : "",
    body: typeof card.body === "string" ? card.body : "",
    createdAt: typeof card.createdAt === "string" ? card.createdAt : now,
    updatedAt: typeof card.updatedAt === "string" ? card.updatedAt : now,
  };
}

function hydrateImagePrompt(prompt: unknown): PanelImagePrompt | undefined {
  if (!isRecord(prompt) || typeof prompt.id !== "string") return undefined;

  return {
    id: prompt.id,
    prompt: typeof prompt.prompt === "string" ? prompt.prompt : "",
    createdAt: typeof prompt.createdAt === "string" ? prompt.createdAt : new Date().toISOString(),
  };
}

function hydrateResearchStack(stack: unknown): ResearchStack | undefined {
  if (!isRecord(stack) || typeof stack.id !== "string") return undefined;
  const now = new Date().toISOString();

  return {
    id: stack.id,
    title: typeof stack.title === "string" ? stack.title : "",
    items: Array.isArray(stack.items) ? stack.items.map(hydrateResearchItem).filter(isDefined) : [],
    createdAt: typeof stack.createdAt === "string" ? stack.createdAt : now,
    updatedAt: typeof stack.updatedAt === "string" ? stack.updatedAt : now,
  };
}

function hydrateResearchItem(item: unknown): ResearchItem | undefined {
  if (!isRecord(item) || typeof item.id !== "string") return undefined;
  const now = new Date().toISOString();
  const type = item.type === "file" ? "file" : "website";

  return {
    id: item.id,
    type,
    title: typeof item.title === "string" ? item.title : "",
    source: typeof item.source === "string" ? item.source : "",
    note: typeof item.note === "string" ? item.note : "",
    quote: typeof item.quote === "string" ? item.quote : undefined,
    assets: Array.isArray(item.assets) ? item.assets.map(hydrateResearchAsset).filter(isDefined) : [],
    createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
  };
}

function hydrateResearchAsset(asset: unknown): ResearchAsset | undefined {
  if (typeof asset === "string") {
    const source = asset.trim();
    if (!source) return undefined;

    const name = assetNameFromSource(source);
    return {
      id: deterministicAssetId(source),
      name,
      kind: inferResearchAssetKind(name, undefined),
      source,
      storage: "project",
      createdAt: new Date().toISOString(),
    };
  }

  if (!isRecord(asset) || typeof asset.source !== "string" || !asset.source.trim()) return undefined;
  const source = asset.source.trim();
  const name = typeof asset.name === "string" && asset.name.trim() ? asset.name.trim() : assetNameFromSource(source);
  const mimeType = typeof asset.mimeType === "string" && asset.mimeType.trim() ? asset.mimeType.trim() : undefined;

  return {
    id: typeof asset.id === "string" && asset.id.trim() ? asset.id.trim() : deterministicAssetId(source),
    name,
    kind:
      asset.kind === "image" || asset.kind === "pdf" || asset.kind === "file"
        ? asset.kind
        : inferResearchAssetKind(`${name} ${source}`, mimeType),
    source,
    storage: asset.storage === "external" ? "external" : "project",
    mimeType,
    size: typeof asset.size === "number" && Number.isFinite(asset.size) && asset.size >= 0 ? Math.round(asset.size) : undefined,
    createdAt: typeof asset.createdAt === "string" ? asset.createdAt : new Date().toISOString(),
  };
}

function inferResearchAssetKind(name: string, mimeType: string | undefined): ResearchAssetKind {
  const normalizedMime = mimeType?.toLowerCase() ?? "";
  const normalizedName = name.toLowerCase();

  if (
    normalizedMime.startsWith("image/") ||
    normalizedName.includes("data:image/") ||
    /\.(?:avif|gif|jpe?g|png|webp)(?:$|[\s?#])/i.test(normalizedName)
  ) {
    return "image";
  }

  if (normalizedMime === "application/pdf" || normalizedName.includes("data:application/pdf") || /\.pdf(?:$|[\s?#])/i.test(normalizedName)) {
    return "pdf";
  }

  return "file";
}

function assetNameFromSource(source: string): string {
  const withoutQuery = source.split(/[?#]/, 1)[0] ?? source;
  const segments = withoutQuery.split(/[\\/]/).filter(Boolean);
  return safeDecodeURIComponent(segments.at(-1) ?? "Attachment");
}

function deterministicAssetId(source: string): string {
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `asset-${hash.toString(36)}`;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
