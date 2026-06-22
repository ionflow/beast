import { parseFountain, type EditorCommand, type InlineSpan, type OutlineNode, type ScreenplayBlock } from "@beast/core";
import { FountainEditor } from "@beast/editor";
import {
  createTauriStorageAdapter,
  createWebStorageAdapter,
  type ExportFile,
  type ProjectBundle,
  type RightPanelMode,
  type StorageAdapter,
} from "@beast/storage";
import {
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  Globe,
  Hash,
  Heading1,
  Images,
  Italic,
  Music,
  MessageSquareText,
  NotebookTabs,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Parentheses,
  Bot,
  Save,
  ScrollText,
  StickyNote,
  Text,
  Type,
  Underline,
  Zap,
  AlignCenter,
  Bold,
  type LucideIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const screenplayCommandButtons: Array<{ command: EditorCommand; label: string; icon: LucideIcon }> = [
  { command: "force-scene-heading", label: "Scene", icon: Heading1 },
  { command: "force-action", label: "Action", icon: Text },
  { command: "force-character", label: "Character", icon: Type },
  { command: "force-dialogue", label: "Dialogue", icon: MessageSquareText },
  { command: "force-parenthetical", label: "Parenthetical", icon: Parentheses },
  { command: "force-transition", label: "Transition", icon: Zap },
  { command: "toggle-note", label: "Note", icon: StickyNote },
  { command: "toggle-centered", label: "Centered", icon: AlignCenter },
  { command: "toggle-lyrics", label: "Lyrics", icon: Music },
  { command: "toggle-scene-number", label: "Scene Number", icon: Hash },
  { command: "toggle-boneyard", label: "Omit", icon: EyeOff },
];

const textCommandButtons: Array<{ command: EditorCommand; label: string; icon: LucideIcon }> = [
  { command: "toggle-bold", label: "Bold", icon: Bold },
  { command: "toggle-italic", label: "Italic", icon: Italic },
  { command: "toggle-underline", label: "Underline", icon: Underline },
];

const rightPanelModes: Array<{ mode: RightPanelMode; label: string; icon: LucideIcon; enabled: boolean }> = [
  { mode: "preview", label: "Preview", icon: Eye, enabled: true },
  { mode: "browser", label: "Research Browser", icon: Globe, enabled: false },
  { mode: "notecards", label: "Notecards", icon: NotebookTabs, enabled: false },
  { mode: "images", label: "Images", icon: Images, enabled: false },
  { mode: "research", label: "Research Notes", icon: Bot, enabled: false },
];

export function BeastApp() {
  const storage = useMemo(createRuntimeStorage, []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [bundle, setBundle] = useState<ProjectBundle>(() => storage.createProject({ title: "Untitled" }));
  const [status, setStatus] = useState("Ready");
  const [scrollToPosition, setScrollToPosition] = useState<number | undefined>();
  const [activeCommand, setActiveCommand] = useState<EditorCommand | null>(null);
  const document = useMemo(() => parseFountain(bundle.script), [bundle.script]);
  const showOutline = bundle.metadata.editor.showOutline;
  const showRightPanel = bundle.metadata.editor.showPreview;
  const rightPanelMode = bundle.metadata.editor.rightPanelMode ?? "preview";
  const rightPanelWidth = bundle.metadata.editor.rightPanelWidth ?? 420;
  const workspaceClassName = [
    "beast-workspace",
    showOutline ? "is-outline-visible" : "is-outline-hidden",
    showRightPanel ? "is-right-panel-visible" : "is-right-panel-hidden",
  ].join(" ");
  const workspaceStyle = {
    "--right-panel-width": `${rightPanelWidth}px`,
  } as CSSProperties;

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

  function handleSceneSelect(node: OutlineNode) {
    setScrollToPosition(node.position);
    window.setTimeout(() => setScrollToPosition(undefined), 0);
  }

  function handleCommandClick(command: EditorCommand) {
    setActiveCommand(command);
    window.setTimeout(() => setActiveCommand(null), 0);
  }

  function setOutlineVisible(visible: boolean) {
    updateBundle((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        editor: {
          ...current.metadata.editor,
          showOutline: visible,
        },
      },
    }));
  }

  function setRightPanelVisible(visible: boolean) {
    updateBundle((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        editor: {
          ...current.metadata.editor,
          showPreview: visible,
        },
      },
    }));
  }

  function setRightPanelMode(mode: RightPanelMode) {
    updateBundle((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        editor: {
          ...current.metadata.editor,
          rightPanelMode: mode,
          showPreview: true,
        },
      },
    }));
  }

  function setRightPanelWidth(width: number) {
    const clampedWidth = clampRightPanelWidth(width);

    updateBundle((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        editor: {
          ...current.metadata.editor,
          rightPanelWidth: clampedWidth,
        },
      },
    }));
  }

  function startRightPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    globalThis.document.body.classList.add("is-resizing-right-panel");

    const updateFromClientX = (clientX: number) => {
      setRightPanelWidth(window.innerWidth - clientX);
    };
    const handlePointerMove = (moveEvent: PointerEvent) => updateFromClientX(moveEvent.clientX);
    const handlePointerUp = () => {
      globalThis.document.body.classList.remove("is-resizing-right-panel");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    updateFromClientX(event.clientX);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function handleRightPanelResizeKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    setRightPanelWidth(rightPanelWidth + (event.key === "ArrowLeft" ? 24 : -24));
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

        <div className="beast-layout-actions" aria-label="Layout actions">
          <IconButton
            label={showOutline ? "Hide Outline" : "Show Outline"}
            icon={showOutline ? PanelLeftClose : PanelLeft}
            pressed={showOutline}
            onClick={() => setOutlineVisible(!showOutline)}
          />
          <IconButton
            label={showRightPanel ? "Hide Side Panel" : "Show Side Panel"}
            icon={showRightPanel ? PanelRightClose : PanelRight}
            pressed={showRightPanel}
            onClick={() => setRightPanelVisible(!showRightPanel)}
          />
        </div>

        <input
          className="beast-title-input"
          value={bundle.metadata.title}
          aria-label="Project title"
          onChange={(event) => handleTitleChange(event.currentTarget.value)}
        />

        <div className="beast-command-actions" aria-label="Format actions">
          {screenplayCommandButtons.map((button) => (
            <IconButton
              key={button.command}
              label={button.label}
              icon={button.icon}
              onClick={() => handleCommandClick(button.command)}
            />
          ))}
          <span className="beast-command-divider" aria-hidden="true" />
          {textCommandButtons.map((button) => (
            <IconButton
              key={button.command}
              label={button.label}
              icon={button.icon}
              onClick={() => handleCommandClick(button.command)}
            />
          ))}
        </div>
      </header>

      <section className={workspaceClassName} style={workspaceStyle}>
        {showOutline ? <OutlinePanel outline={document.outline} onNodeSelect={handleSceneSelect} /> : null}
        <section className="beast-editor-pane" aria-label="Fountain editor">
          <FountainEditor
            value={bundle.script}
            onChange={handleEditorChange}
            scrollToPosition={scrollToPosition}
            className="beast-editor"
          />
          <CommandRelay command={activeCommand} />
        </section>
        {showRightPanel ? (
          <RightPanel
            blocks={document.blocks}
            onResizeKeyDown={handleRightPanelResizeKey}
            onResizeStart={startRightPanelResize}
            mode={rightPanelMode}
            title={bundle.metadata.title}
            onModeChange={setRightPanelMode}
          />
        ) : null}
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

function OutlinePanel({ outline, onNodeSelect }: { outline: OutlineNode[]; onNodeSelect: (node: OutlineNode) => void }) {
  return (
    <aside className="beast-outline" aria-label="Outline">
      <div className="beast-pane-heading">
        <PanelLeft size={16} aria-hidden="true" />
        <span>Outline</span>
      </div>
      <div className="beast-outline-list">
        {outline.length === 0 ? (
          <div className="beast-empty">No scenes</div>
        ) : (
          outline.map((node) => (
            <button
              key={node.id}
              className={`beast-outline-item beast-outline-${node.type}`}
              style={{ "--outline-depth": String(Math.max(0, node.level - 1)) } as CSSProperties}
              type="button"
              onClick={() => onNodeSelect(node)}
            >
              <span>
                {node.type === "section" ? "# ".repeat(Math.min(node.level, 3)) : ""}
                {node.title}
              </span>
              <small>
                Line {node.line}
                {node.sceneNumber ? ` #${node.sceneNumber}#` : ""}
              </small>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function RightPanel({
  blocks,
  mode,
  onResizeKeyDown,
  onResizeStart,
  title,
  onModeChange,
}: {
  blocks: ScreenplayBlock[];
  mode: RightPanelMode;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  title: string;
  onModeChange: (mode: RightPanelMode) => void;
}) {
  const activeMode = rightPanelModes.find((panelMode) => panelMode.mode === mode) ?? rightPanelModes[0];
  const ActiveIcon = activeMode.icon;

  return (
    <aside className="beast-right-panel" aria-label={activeMode.label}>
      <div
        className="beast-right-panel-resizer"
        role="separator"
        tabIndex={0}
        aria-label="Resize side panel"
        aria-orientation="vertical"
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizeStart}
      />
      <div className="beast-pane-heading">
        <ActiveIcon size={16} aria-hidden="true" />
        <span>{activeMode.label}</span>
        <div className="beast-pane-actions" aria-label="Side panel actions">
          {rightPanelModes
            .filter((panelMode) => panelMode.enabled || panelMode.mode === mode)
            .map((panelMode) => (
              <IconButton
                key={panelMode.mode}
                label={panelMode.label}
                icon={panelMode.icon}
                pressed={panelMode.mode === mode}
                onClick={() => onModeChange(panelMode.mode)}
              />
            ))}
        </div>
      </div>
      <RightPanelContent blocks={blocks} mode={activeMode.mode} title={title} />
    </aside>
  );
}

function RightPanelContent({ blocks, mode, title }: { blocks: ScreenplayBlock[]; mode: RightPanelMode; title: string }) {
  switch (mode) {
    case "preview":
      return <PreviewPanel blocks={blocks} title={title} />;
    case "browser":
    case "notecards":
    case "images":
    case "research":
      return <PanelPlaceholder mode={mode} />;
    default:
      return <PreviewPanel blocks={blocks} title={title} />;
  }
}

function PreviewPanel({ blocks, title }: { blocks: ScreenplayBlock[]; title: string }) {
  return (
    <div className="beast-preview-page">
      <h1>{title}</h1>
      {blocks.map((block) => (
        <PreviewBlock key={`${block.startLine}-${block.startOffset}`} block={block} />
      ))}
    </div>
  );
}

function PanelPlaceholder({ mode }: { mode: Exclude<RightPanelMode, "preview"> }) {
  const panelMode = rightPanelModes.find((candidate) => candidate.mode === mode);
  const Icon = panelMode?.icon ?? PanelRight;

  return (
    <div className="beast-panel-placeholder">
      <Icon size={22} aria-hidden="true" />
      <span>{panelMode?.label ?? "Side Panel"}</span>
    </div>
  );
}

function PreviewBlock({ block }: { block: ScreenplayBlock }) {
  if (
    block.type === "title" ||
    block.type === "section" ||
    block.type === "synopsis" ||
    block.type === "note" ||
    block.type === "boneyard"
  ) {
    return null;
  }

  if (block.type === "blank") return <div className="preview-gap" />;

  if (block.type === "page-break") {
    return (
      <div className="preview-page-break">
        <ScrollText size={14} aria-hidden="true" />
      </div>
    );
  }

  return (
    <p className={`preview-block preview-${block.type}`}>
      {block.sceneNumber ? <span className="preview-scene-number">#{block.sceneNumber}# </span> : null}
      <InlineText spans={block.inline} />
    </p>
  );
}

function InlineText({ spans }: { spans: InlineSpan[] }) {
  return spans
    .filter((span) => !span.styles.includes("note"))
    .map((span, index) => {
      if (span.styles.length === 0) return <span key={index}>{span.text}</span>;

      return (
        <span key={index} className={span.styles.map((style) => `preview-inline-${style}`).join(" ")}>
          {span.text}
        </span>
      );
    });
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  pressed,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  pressed?: boolean;
}) {
  const tooltipId = useId();
  const showTimerRef = useRef<number | undefined>(undefined);
  const [tooltip, setTooltip] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    return () => {
      if (showTimerRef.current !== undefined) {
        window.clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  function showTooltip(button: HTMLButtonElement) {
    if (showTimerRef.current !== undefined) {
      window.clearTimeout(showTimerRef.current);
    }

    showTimerRef.current = window.setTimeout(() => {
      const rect = button.getBoundingClientRect();
      const left = Math.min(Math.max(rect.left + rect.width / 2, 56), window.innerWidth - 56);
      setTooltip({
        left,
        top: rect.bottom + 8,
      });
    }, 80);
  }

  function hideTooltip() {
    if (showTimerRef.current !== undefined) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = undefined;
    }

    setTooltip(null);
  }

  function handleClick() {
    hideTooltip();
    onClick();
  }

  return (
    <>
      <button
        className="beast-icon-button"
        type="button"
        aria-label={label}
        aria-describedby={tooltip ? tooltipId : undefined}
        aria-pressed={pressed}
        data-pressed={pressed ? "true" : undefined}
        onBlur={hideTooltip}
        onClick={handleClick}
        onFocus={(event) => showTooltip(event.currentTarget)}
        onMouseEnter={(event) => showTooltip(event.currentTarget)}
        onMouseLeave={hideTooltip}
      >
        <Icon size={17} aria-hidden="true" />
      </button>
      {tooltip
        ? createPortal(
            <div
              id={tooltipId}
              className="beast-tooltip"
              role="tooltip"
              style={{
                left: tooltip.left,
                top: tooltip.top,
              }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
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

function clampRightPanelWidth(width: number): number {
  const maxWidth = Math.max(320, Math.min(760, Math.round(window.innerWidth * 0.58)));
  return Math.min(Math.max(Math.round(width), 280), maxWidth);
}
