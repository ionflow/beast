export const PROJECT_FILE = "project.json";
export const SCRIPT_FILE = "script.fountain";
export const BEAST_PROJECT_VERSION = 1;

export type RightPanelMode = "preview" | "browser" | "notecards" | "images" | "research";

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
      outlineCacheVersion: 1,
    },
    script: input.script ?? DEFAULT_SCRIPT,
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
      return validateProjectBundle({
        metadata: JSON.parse(payload.projectJson) as ProjectMetadata,
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
        projectJson: JSON.stringify(updated.metadata, null, 2),
        script: updated.script,
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

  const [projectJson, script] = await Promise.all([projectFile.text(), scriptFile.text()]);
  return validateProjectBundle({
    metadata: JSON.parse(projectJson) as ProjectMetadata,
    script,
  });
}

function findBundleFile(files: File[], name: string): File | undefined {
  return files.find((file) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
    return file.name === name || relativePath.endsWith(`/${name}`);
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
      content: JSON.stringify(updated.metadata, null, 2),
      mimeType: "application/json",
    },
    {
      name: SCRIPT_FILE,
      content: updated.script,
      mimeType: "text/plain;charset=utf-8",
    },
  ];
}

function touchMetadata(metadata: ProjectMetadata): ProjectMetadata {
  const editor = {
    showOutline: metadata.editor?.showOutline ?? true,
    showPreview: metadata.editor?.showPreview ?? true,
    rightPanelMode: metadata.editor?.rightPanelMode ?? "preview",
    rightPanelWidth: clampPanelWidth(metadata.editor?.rightPanelWidth),
    fontSize: metadata.editor?.fontSize ?? 16,
  };

  return {
    ...metadata,
    title: metadata.title?.trim() || "Untitled",
    editor,
    updatedAt: new Date().toISOString(),
  };
}

function clampPanelWidth(width: unknown): number {
  if (typeof width !== "number" || !Number.isFinite(width)) return 420;
  return Math.min(Math.max(Math.round(width), 280), 760);
}
