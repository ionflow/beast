import { parseFountain, type EditorCommand, type SceneNode, type ScreenplayBlock } from "@beast/core";
import { FountainEditor } from "@beast/editor";
import {
  createTauriStorageAdapter,
  createWebStorageAdapter,
  type ExportFile,
  type ProjectBundle,
  type StorageAdapter,
} from "@beast/storage";
import {
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  Heading1,
  MessageSquareText,
  PanelLeft,
  Parentheses,
  Save,
  ScrollText,
  StickyNote,
  Text,
  Type,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const commandButtons: Array<{ command: EditorCommand; label: string; icon: LucideIcon }> = [
  { command: "force-scene-heading", label: "Scene", icon: Heading1 },
  { command: "force-action", label: "Action", icon: Text },
  { command: "force-character", label: "Character", icon: Type },
  { command: "force-dialogue", label: "Dialogue", icon: MessageSquareText },
  { command: "force-parenthetical", label: "Parenthetical", icon: Parentheses },
  { command: "force-transition", label: "Transition", icon: Zap },
  { command: "toggle-note", label: "Note", icon: StickyNote },
];

export function BeastApp() {
  const storage = useMemo(createRuntimeStorage, []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [bundle, setBundle] = useState<ProjectBundle>(() => storage.createProject({ title: "Untitled" }));
  const [status, setStatus] = useState("Ready");
  const [scrollToPosition, setScrollToPosition] = useState<number | undefined>();
  const [activeCommand, setActiveCommand] = useState<EditorCommand | null>(null);
  const document = useMemo(() => parseFountain(bundle.script), [bundle.script]);

  useEffect(() => {
    if (storage.platform !== "web") return;

    storage
      .loadProject({ kind: "local" })
      .then((project) => {
        setBundle(project);
        setStatus("Draft restored");
      })
      .catch(() => {
        setStatus("Ready");
      });
  }, [storage]);

  useEffect(() => {
    if (storage.platform !== "web") return;

    const handle = window.setTimeout(() => {
      storage.saveProject(bundle, { kind: "local" }).catch(() => {
        setStatus("Autosave failed");
      });
    }, 600);

    return () => window.clearTimeout(handle);
  }, [bundle, storage]);

  function updateBundle(updater: (current: ProjectBundle) => ProjectBundle) {
    setBundle((current) => updater(current));
  }

  async function handleNewProject() {
    setBundle(storage.createProject({ title: "Untitled" }));
    setStatus("New project");
  }

  async function handleOpenProject() {
    if (storage.platform === "web") {
      fileInputRef.current?.click();
      return;
    }

    try {
      const project = await storage.loadProject();
      setBundle(project);
      setStatus("Project opened");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function handleSaveProject() {
    try {
      const result = await storage.saveProject(bundle);
      if (result.path) {
        updateBundle((current) => ({ ...current, path: result.path }));
      }
      setStatus("Saved");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function handleExportProject() {
    try {
      const result = await storage.saveProject(bundle, storage.platform === "web" ? { kind: "download" } : { kind: "path" });
      if (result.files) downloadFiles(result.files);
      if (result.path) updateBundle((current) => ({ ...current, path: result.path }));
      setStatus(storage.platform === "web" ? "Exported" : "Saved");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files) return;

    try {
      const project = await storage.loadProject({ kind: "files", files: Array.from(files) });
      setBundle(project);
      setStatus("Project imported");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleTitleChange(title: string) {
    updateBundle((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        title,
      },
    }));
  }

  function handleEditorChange(script: string) {
    updateBundle((current) => ({
      ...current,
      script,
    }));
  }

  function handleSceneSelect(scene: SceneNode) {
    setScrollToPosition(scene.position);
    window.setTimeout(() => setScrollToPosition(undefined), 0);
  }

  function handleCommandClick(command: EditorCommand) {
    setActiveCommand(command);
    window.setTimeout(() => setActiveCommand(null), 0);
  }

  return (
    <main className="beast-shell">
      <input
        ref={(node) => {
          fileInputRef.current = node;
          node?.setAttribute("webkitdirectory", "");
          node?.setAttribute("directory", "");
        }}
        className="beast-hidden-input"
        type="file"
        multiple
        onChange={(event) => void handleFilesSelected(event.currentTarget.files)}
      />

      <header className="beast-toolbar">
        <div className="beast-file-actions" aria-label="Project actions">
          <IconButton label="New" icon={FilePlus2} onClick={() => void handleNewProject()} />
          <IconButton label="Open" icon={FolderOpen} onClick={() => void handleOpenProject()} />
          <IconButton label="Save" icon={Save} onClick={() => void handleSaveProject()} />
          <IconButton label={storage.platform === "web" ? "Export" : "Save As"} icon={Download} onClick={() => void handleExportProject()} />
        </div>

        <input
          className="beast-title-input"
          value={bundle.metadata.title}
          aria-label="Project title"
          onChange={(event) => handleTitleChange(event.currentTarget.value)}
        />

        <div className="beast-command-actions" aria-label="Format actions">
          {commandButtons.map((button) => (
            <IconButton
              key={button.command}
              label={button.label}
              icon={button.icon}
              onClick={() => handleCommandClick(button.command)}
            />
          ))}
        </div>
      </header>

      <section className="beast-workspace">
        <OutlinePanel scenes={document.scenes} onSceneSelect={handleSceneSelect} />
        <section className="beast-editor-pane" aria-label="Fountain editor">
          <FountainEditor
            value={bundle.script}
            onChange={handleEditorChange}
            scrollToPosition={scrollToPosition}
            className="beast-editor"
          />
          <CommandRelay command={activeCommand} />
        </section>
        <PreviewPanel blocks={document.blocks} title={bundle.metadata.title} />
      </section>

      <footer className="beast-statusbar">
        <span>{status}</span>
        <span>{document.scenes.length} scenes</span>
        <span>{storage.platform}</span>
      </footer>
    </main>
  );
}

function CommandRelay({ command }: { command: EditorCommand | null }) {
  useEffect(() => {
    if (!command) return;
    window.dispatchEvent(new CustomEvent("beast:editor-command", { detail: command }));
  }, [command]);

  return null;
}

function OutlinePanel({ scenes, onSceneSelect }: { scenes: SceneNode[]; onSceneSelect: (scene: SceneNode) => void }) {
  return (
    <aside className="beast-outline" aria-label="Outline">
      <div className="beast-pane-heading">
        <PanelLeft size={16} aria-hidden="true" />
        <span>Outline</span>
      </div>
      <div className="beast-outline-list">
        {scenes.length === 0 ? (
          <div className="beast-empty">No scenes</div>
        ) : (
          scenes.map((scene) => (
            <button key={scene.id} className="beast-outline-item" type="button" onClick={() => onSceneSelect(scene)}>
              <span>{scene.title}</span>
              <small>Line {scene.line}</small>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function PreviewPanel({ blocks, title }: { blocks: ScreenplayBlock[]; title: string }) {
  return (
    <aside className="beast-preview" aria-label="Preview">
      <div className="beast-pane-heading">
        <Eye size={16} aria-hidden="true" />
        <span>Preview</span>
      </div>
      <div className="beast-preview-page">
        <h1>{title}</h1>
        {blocks.map((block) => (
          <PreviewBlock key={`${block.startLine}-${block.startOffset}`} block={block} />
        ))}
      </div>
    </aside>
  );
}

function PreviewBlock({ block }: { block: ScreenplayBlock }) {
  if (block.type === "blank" || block.type === "title") return <div className="preview-gap" />;

  if (block.type === "page-break") {
    return (
      <div className="preview-page-break">
        <ScrollText size={14} aria-hidden="true" />
      </div>
    );
  }

  return <p className={`preview-block preview-${block.type}`}>{block.text}</p>;
}

function IconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button className="beast-icon-button" type="button" title={label} aria-label={label} onClick={onClick}>
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

function createRuntimeStorage(): StorageAdapter {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return createTauriStorageAdapter();
  }

  return createWebStorageAdapter();
}

function downloadFiles(files: ExportFile[]) {
  for (const file of files) {
    const blob = new Blob([file.content], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
