import {
  getWritingContext,
  parseFountain,
  type EditorCommand,
  type InlineSpan,
  type OutlineNode,
  type ScreenplayBlock,
  type TextSelection,
  type WritingContext,
} from "@beast/core";
import { FountainEditor } from "@beast/editor";
import {
  createPanelContextMetadata,
  createTauriStorageAdapter,
  createWebStorageAdapter,
  type ExportFile,
  type PanelContextMetadata,
  type ProjectBundle,
  type ProjectMetadata,
  type ResearchItem,
  type ResearchStack,
  type RightPanelMode,
  type StorageAdapter,
} from "@beast/storage";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Bold,
  AlignCenter,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FilePlus2,
  FolderOpen,
  GripVertical,
  Globe,
  Hash,
  Heading1,
  ImagePlus,
  Images,
  Italic,
  LayoutGrid,
  Link2,
  List,
  Music,
  MessageSquareText,
  NotebookTabs,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Parentheses,
  Plus,
  RotateCw,
  Save,
  ScrollText,
  Send,
  StickyNote,
  Text,
  Trash2,
  Type,
  Underline,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
  { mode: "browser", label: "Research Browser", icon: Globe, enabled: true },
  { mode: "notecards", label: "Notecards", icon: NotebookTabs, enabled: true },
  { mode: "images", label: "Images", icon: Images, enabled: true },
  { mode: "research", label: "Research Notes", icon: Bot, enabled: true },
];

export function BeastApp() {
  const storage = useMemo(createRuntimeStorage, []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [bundle, setBundle] = useState<ProjectBundle>(() => storage.createProject({ title: "Untitled" }));
  const [status, setStatus] = useState("Ready");
  const [scrollToPosition, setScrollToPosition] = useState<number | undefined>();
  const [activeCommand, setActiveCommand] = useState<EditorCommand | null>(null);
  const [editorSelection, setEditorSelection] = useState<TextSelection>({ from: 0, to: 0 });
  const document = useMemo(() => parseFountain(bundle.script), [bundle.script]);
  const activeContext = useMemo(() => getWritingContext(document, editorSelection.from), [document, editorSelection.from]);
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

  function updateMetadata(updater: (current: ProjectMetadata) => ProjectMetadata) {
    updateBundle((current) => ({
      ...current,
      metadata: updater(current.metadata),
    }));
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
            onSelectionChange={setEditorSelection}
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
            metadata={bundle.metadata}
            activeContext={activeContext}
            onMetadataChange={updateMetadata}
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
  metadata,
  activeContext,
  onMetadataChange,
  onModeChange,
}: {
  blocks: ScreenplayBlock[];
  mode: RightPanelMode;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  title: string;
  metadata: ProjectMetadata;
  activeContext: WritingContext;
  onMetadataChange: (updater: (current: ProjectMetadata) => ProjectMetadata) => void;
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
      <RightPanelContent
        activeContext={activeContext}
        blocks={blocks}
        metadata={metadata}
        mode={activeMode.mode}
        onMetadataChange={onMetadataChange}
        title={title}
      />
    </aside>
  );
}

function RightPanelContent({
  activeContext,
  blocks,
  metadata,
  mode,
  onMetadataChange,
  title,
}: {
  activeContext: WritingContext;
  blocks: ScreenplayBlock[];
  metadata: ProjectMetadata;
  mode: RightPanelMode;
  onMetadataChange: (updater: (current: ProjectMetadata) => ProjectMetadata) => void;
  title: string;
}) {
  switch (mode) {
    case "preview":
      return <PreviewPanel blocks={blocks} title={title} />;
    case "browser":
      return <BrowserPanel metadata={metadata} onMetadataChange={onMetadataChange} />;
    case "notecards":
      return <NotecardsPanel activeContext={activeContext} metadata={metadata} onMetadataChange={onMetadataChange} projectTitle={title} />;
    case "images":
      return <ImagesPanel activeContext={activeContext} metadata={metadata} onMetadataChange={onMetadataChange} />;
    case "research":
      return <ResearchPanel activeContext={activeContext} metadata={metadata} onMetadataChange={onMetadataChange} projectTitle={title} />;
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

function BrowserPanel({
  metadata,
  onMetadataChange,
}: {
  metadata: ProjectMetadata;
  onMetadataChange: (updater: (current: ProjectMetadata) => ProjectMetadata) => void;
}) {
  const browser = metadata.panels.browser;
  const [address, setAddress] = useState(browser.currentUrl);
  const [frameReloadKey, setFrameReloadKey] = useState(0);
  const canGoBack = browser.historyIndex > 0;
  const canGoForward = browser.historyIndex >= 0 && browser.historyIndex < browser.history.length - 1;
  const frameUrl = getEmbeddableBrowserUrl(browser.currentUrl);

  useEffect(() => {
    setAddress(browser.currentUrl);
  }, [browser.currentUrl]);

  function updateBrowser(nextBrowser: ProjectMetadata["panels"]["browser"]) {
    onMetadataChange((current) => ({
      ...current,
      panels: {
        ...current.panels,
        browser: nextBrowser,
      },
    }));
  }

  function handleNavigate(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = normalizeBrowserUrl(address);
    if (!url) return;

    const previousHistory = browser.historyIndex >= 0 ? browser.history.slice(0, browser.historyIndex + 1) : [];
    const history = [...previousHistory, url];
    updateBrowser({
      currentUrl: url,
      history,
      historyIndex: history.length - 1,
    });
  }

  function goToHistory(historyIndex: number) {
    const nextUrl = browser.history[historyIndex];
    if (!nextUrl) return;

    updateBrowser({
      currentUrl: nextUrl,
      history: browser.history,
      historyIndex,
    });
  }

  return (
    <div className="beast-panel-body beast-browser-panel">
      <form className="beast-browser-bar" onSubmit={handleNavigate}>
        <IconButton label="Back" icon={ArrowLeft} disabled={!canGoBack} onClick={() => goToHistory(browser.historyIndex - 1)} />
        <IconButton label="Forward" icon={ArrowRight} disabled={!canGoForward} onClick={() => goToHistory(browser.historyIndex + 1)} />
        <IconButton label="Reload" icon={RotateCw} disabled={!browser.currentUrl} onClick={() => setFrameReloadKey((current) => current + 1)} />
        <input
          className="beast-panel-input"
          value={address}
          aria-label="Browser address"
          placeholder="Search or enter a URL"
          onChange={(event) => setAddress(event.currentTarget.value)}
        />
        <button className="beast-panel-icon-submit" type="submit" aria-label="Go">
          <Send size={16} aria-hidden="true" />
        </button>
      </form>

      {browser.currentUrl ? (
        <>
          <div className="beast-browser-fallback">
            <a href={browser.currentUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden="true" />
              Open externally
            </a>
          </div>
          {frameUrl ? (
            <iframe
              key={`${frameUrl}-${frameReloadKey}`}
              className="beast-browser-frame"
              src={frameUrl}
              title="Research browser"
              sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
            />
          ) : (
            <div className="beast-panel-empty">
              <Globe size={22} aria-hidden="true" />
              <span>This site blocks embedded browsing. Open it externally.</span>
            </div>
          )}
        </>
      ) : (
        <div className="beast-panel-empty">
          <Globe size={22} aria-hidden="true" />
          <span>Enter a URL or search term.</span>
        </div>
      )}
    </div>
  );
}

function NotecardsPanel({
  activeContext,
  metadata,
  onMetadataChange,
  projectTitle,
}: {
  activeContext: WritingContext;
  metadata: ProjectMetadata;
  onMetadataChange: (updater: (current: ProjectMetadata) => ProjectMetadata) => void;
  projectTitle: string;
}) {
  const context = getPanelContext(metadata, activeContext.key);
  const viewMode = metadata.panels.preferences.notecardsView;
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);

  function updateContext(updater: (current: PanelContextMetadata) => PanelContextMetadata) {
    onMetadataChange((current) => updatePanelContext(current, activeContext.key, updater));
  }

  function addCard() {
    const now = new Date().toISOString();
    updateContext((current) => ({
      ...current,
      notecards: [
        ...current.notecards,
        {
          id: createId("card"),
          title: "Untitled Card",
          body: "",
          createdAt: now,
          updatedAt: now,
        },
      ],
    }));
  }

  function setViewMode(nextViewMode: "stacked" | "grid") {
    onMetadataChange((current) => ({
      ...current,
      panels: {
        ...current.panels,
        preferences: {
          ...current.panels.preferences,
          notecardsView: nextViewMode,
        },
      },
    }));
  }

  function updateCard(id: string, field: "title" | "body", value: string) {
    updateContext((current) => ({
      ...current,
      notecards: current.notecards.map((card) =>
        card.id === id
          ? {
              ...card,
              [field]: value,
              updatedAt: new Date().toISOString(),
            }
          : card,
      ),
    }));
  }

  function deleteCard(id: string) {
    updateContext((current) => ({
      ...current,
      notecards: current.notecards.filter((card) => card.id !== id),
    }));
  }

  function startCardDrag(event: ReactDragEvent<HTMLButtonElement>, cardId: string) {
    setDraggingCardId(cardId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", cardId);
  }

  function startCardMouseDrag(event: ReactMouseEvent<HTMLButtonElement>, cardId: string) {
    event.preventDefault();
    setDraggingCardId(cardId);
  }

  function dropCard(event: ReactDragEvent<HTMLElement>, targetCardId: string) {
    event.preventDefault();
    const draggedCardId = event.dataTransfer.getData("text/plain") || draggingCardId;
    if (!draggedCardId || draggedCardId === targetCardId) return;

    moveCard(draggedCardId, targetCardId);
    setDraggingCardId(null);
  }

  function moveCard(draggedCardId: string, targetCardId: string) {
    updateContext((current) => ({
      ...current,
      notecards: reorderById(current.notecards, draggedCardId, targetCardId),
    }));
  }

  function moveDraggedCard(targetCardId: string) {
    if (!draggingCardId || draggingCardId === targetCardId) return;
    moveCard(draggingCardId, targetCardId);
  }

  useEffect(() => {
    if (!draggingCardId) return undefined;

    const moveAtPoint = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      const target = element instanceof HTMLElement ? element.closest<HTMLElement>("[data-card-id]") : null;
      const targetCardId = target?.dataset.cardId;
      if (targetCardId && targetCardId !== draggingCardId) {
        moveCard(draggingCardId, targetCardId);
      }
    };
    const handlePointerMove = (event: PointerEvent) => moveAtPoint(event.clientX, event.clientY);
    const handleMouseMove = (event: MouseEvent) => moveAtPoint(event.clientX, event.clientY);
    const endDrag = () => setDraggingCardId(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("pointerup", endDrag, { once: true });
    window.addEventListener("mouseup", endDrag, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("mouseup", endDrag);
    };
  }, [draggingCardId]);

  return (
    <div className="beast-panel-body">
      <ContextHeader context={activeContext} projectTitle={projectTitle}>
        <ViewModeToggle mode={viewMode} onModeChange={setViewMode} />
      </ContextHeader>
      <div className="beast-panel-row">
        <button className="beast-panel-button" type="button" onClick={addCard}>
          <Plus size={15} aria-hidden="true" />
          New Card
        </button>
      </div>
      {context.notecards.length === 0 ? (
        <div className="beast-panel-empty">
          <NotebookTabs size={22} aria-hidden="true" />
          <span>No notecards in this context.</span>
        </div>
      ) : (
        <div className={viewMode === "grid" ? "beast-notecard-grid" : "beast-panel-list"}>
          {context.notecards.map((card) => (
            <article
              className={`${viewMode === "grid" ? "beast-grid-card beast-notecard-tile" : "beast-panel-card"} ${
                draggingCardId === card.id ? "is-dragging" : ""
              }`}
              data-card-id={card.id}
              key={card.id}
              onDragEnter={() => moveDraggedCard(card.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropCard(event, card.id)}
              onPointerEnter={() => moveDraggedCard(card.id)}
              onPointerUp={() => setDraggingCardId(null)}
            >
              <div className="beast-card-heading">
                <button
                  className="beast-drag-handle"
                  type="button"
                  aria-label="Drag Card"
                  draggable
                  onPointerDown={() => setDraggingCardId(card.id)}
                  onMouseDown={(event) => startCardMouseDrag(event, card.id)}
                  onDragEnd={() => setDraggingCardId(null)}
                  onDragStart={(event) => startCardDrag(event, card.id)}
                >
                  <GripVertical size={15} aria-hidden="true" />
                </button>
                {viewMode === "grid" ? (
                  <h3>{card.title || "Untitled Card"}</h3>
                ) : (
                  <input
                    className="beast-panel-input"
                    value={card.title}
                    aria-label="Notecard title"
                    onChange={(event) => updateCard(card.id, "title", event.currentTarget.value)}
                  />
                )}
                <IconButton label="Delete Card" icon={Trash2} onClick={() => deleteCard(card.id)} />
              </div>
              {viewMode === "grid" ? (
                <p>{card.body || "No description yet."}</p>
              ) : (
                <textarea
                  className="beast-panel-textarea"
                  value={card.body}
                  aria-label="Notecard body"
                  placeholder="Add a beat, question, or scene note."
                  rows={4}
                  onChange={(event) => updateCard(card.id, "body", event.currentTarget.value)}
                />
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ImagesPanel({
  activeContext,
  metadata,
  onMetadataChange,
}: {
  activeContext: WritingContext;
  metadata: ProjectMetadata;
  onMetadataChange: (updater: (current: ProjectMetadata) => ProjectMetadata) => void;
}) {
  const context = getPanelContext(metadata, activeContext.key);
  const [prompt, setPrompt] = useState("");

  function updateContext(updater: (current: PanelContextMetadata) => PanelContextMetadata) {
    onMetadataChange((current) => updatePanelContext(current, activeContext.key, updater));
  }

  function handleSubmit(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;

    updateContext((current) => ({
      ...current,
      imagePrompts: [
        {
          id: createId("image-prompt"),
          prompt: trimmed,
          createdAt: new Date().toISOString(),
        },
        ...current.imagePrompts,
      ],
    }));
    setPrompt("");
  }

  function deletePrompt(id: string) {
    updateContext((current) => ({
      ...current,
      imagePrompts: current.imagePrompts.filter((entry) => entry.id !== id),
    }));
  }

  return (
    <div className="beast-panel-body">
      <ContextBadge context={activeContext} />
      <form className="beast-panel-form" onSubmit={handleSubmit}>
        <textarea
          className="beast-panel-textarea"
          value={prompt}
          aria-label="Image prompt"
          placeholder="Describe a cinematic frame for this moment."
          rows={4}
          onChange={(event) => setPrompt(event.currentTarget.value)}
        />
        <button className="beast-panel-button" type="submit">
          <Send size={15} aria-hidden="true" />
          Send
        </button>
      </form>
      {context.imagePrompts.length === 0 ? (
        <div className="beast-panel-empty">
          <ImagePlus size={22} aria-hidden="true" />
          <span>No image prompts in this context.</span>
        </div>
      ) : (
        <div className="beast-panel-list">
          {context.imagePrompts.map((entry) => (
            <article className="beast-panel-card" key={entry.id}>
              <div className="beast-card-heading">
                <span className="beast-card-kicker">{formatTimestamp(entry.createdAt)}</span>
                <IconButton label="Delete Prompt" icon={Trash2} onClick={() => deletePrompt(entry.id)} />
              </div>
              <p className="beast-prompt-text">{entry.prompt}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ResearchPanel({
  activeContext,
  metadata,
  onMetadataChange,
  projectTitle,
}: {
  activeContext: WritingContext;
  metadata: ProjectMetadata;
  onMetadataChange: (updater: (current: ProjectMetadata) => ProjectMetadata) => void;
  projectTitle: string;
}) {
  const context = getPanelContext(metadata, activeContext.key);
  const viewMode = metadata.panels.preferences.researchView;
  const [draggingStackId, setDraggingStackId] = useState<string | null>(null);

  function updateContext(updater: (current: PanelContextMetadata) => PanelContextMetadata) {
    onMetadataChange((current) => updatePanelContext(current, activeContext.key, updater));
  }

  function addStack() {
    const now = new Date().toISOString();
    updateContext((current) => ({
      ...current,
      researchStacks: [
        ...current.researchStacks,
        {
          id: createId("stack"),
          title: "Research Stack",
          items: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    }));
  }

  function setViewMode(nextViewMode: "stacked" | "grid") {
    onMetadataChange((current) => ({
      ...current,
      panels: {
        ...current.panels,
        preferences: {
          ...current.panels.preferences,
          researchView: nextViewMode,
        },
      },
    }));
  }

  function updateStackTitle(stackId: string, title: string) {
    updateContext((current) => ({
      ...current,
      researchStacks: current.researchStacks.map((stack) =>
        stack.id === stackId
          ? {
              ...stack,
              title,
              updatedAt: new Date().toISOString(),
            }
          : stack,
      ),
    }));
  }

  function deleteStack(stackId: string) {
    updateContext((current) => ({
      ...current,
      researchStacks: current.researchStacks.filter((stack) => stack.id !== stackId),
    }));
  }

  function startStackDrag(event: ReactDragEvent<HTMLButtonElement>, stackId: string) {
    setDraggingStackId(stackId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", stackId);
  }

  function startStackMouseDrag(event: ReactMouseEvent<HTMLButtonElement>, stackId: string) {
    event.preventDefault();
    setDraggingStackId(stackId);
  }

  function dropStack(event: ReactDragEvent<HTMLElement>, targetStackId: string) {
    event.preventDefault();
    const draggedStackId = event.dataTransfer.getData("text/plain") || draggingStackId;
    if (!draggedStackId || draggedStackId === targetStackId) return;

    moveStack(draggedStackId, targetStackId);
    setDraggingStackId(null);
  }

  function moveStack(draggedStackId: string, targetStackId: string) {
    updateContext((current) => ({
      ...current,
      researchStacks: reorderById(current.researchStacks, draggedStackId, targetStackId),
    }));
  }

  function moveDraggedStack(targetStackId: string) {
    if (!draggingStackId || draggingStackId === targetStackId) return;
    moveStack(draggingStackId, targetStackId);
  }

  useEffect(() => {
    if (!draggingStackId) return undefined;

    const moveAtPoint = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      const target = element instanceof HTMLElement ? element.closest<HTMLElement>("[data-stack-id]") : null;
      const targetStackId = target?.dataset.stackId;
      if (targetStackId && targetStackId !== draggingStackId) {
        moveStack(draggingStackId, targetStackId);
      }
    };
    const handlePointerMove = (event: PointerEvent) => moveAtPoint(event.clientX, event.clientY);
    const handleMouseMove = (event: MouseEvent) => moveAtPoint(event.clientX, event.clientY);
    const endDrag = () => setDraggingStackId(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("pointerup", endDrag, { once: true });
    window.addEventListener("mouseup", endDrag, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("mouseup", endDrag);
    };
  }, [draggingStackId]);

  function addItem(stackId: string, type: "website" | "file") {
    const now = new Date().toISOString();
    updateContext((current) => ({
      ...current,
      researchStacks: current.researchStacks.map((stack) =>
        stack.id === stackId
          ? {
              ...stack,
              updatedAt: now,
              items: [
                ...stack.items,
                {
                  id: createId("research-item"),
                  type,
                  title: type === "website" ? "Website" : "Local File",
                  source: "",
                  note: "",
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            }
          : stack,
      ),
    }));
  }

  function updateItem(stackId: string, itemId: string, field: "title" | "source" | "note", value: string) {
    updateContext((current) => ({
      ...current,
      researchStacks: current.researchStacks.map((stack) =>
        stack.id === stackId
          ? {
              ...stack,
              updatedAt: new Date().toISOString(),
              items: stack.items.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      [field]: value,
                      updatedAt: new Date().toISOString(),
                    }
                  : item,
              ),
            }
          : stack,
      ),
    }));
  }

  function deleteItem(stackId: string, itemId: string) {
    updateContext((current) => ({
      ...current,
      researchStacks: current.researchStacks.map((stack) =>
        stack.id === stackId
          ? {
              ...stack,
              updatedAt: new Date().toISOString(),
              items: stack.items.filter((item) => item.id !== itemId),
            }
          : stack,
      ),
    }));
  }

  return (
    <div className="beast-panel-body">
      <ContextHeader context={activeContext} projectTitle={projectTitle}>
        <ViewModeToggle mode={viewMode} onModeChange={setViewMode} />
      </ContextHeader>
      <div className="beast-panel-row">
        <button className="beast-panel-button" type="button" onClick={addStack}>
          <Plus size={15} aria-hidden="true" />
          New Stack
        </button>
      </div>
      {context.researchStacks.length === 0 ? (
        <div className="beast-panel-empty">
          <Bot size={22} aria-hidden="true" />
          <span>No research stacks in this context.</span>
        </div>
      ) : (
        <div className={viewMode === "grid" ? "beast-stack-grid" : "beast-panel-list"}>
          {context.researchStacks.map((stack) => (
            <section
              className={`${viewMode === "grid" ? "beast-grid-card beast-stack-tile" : "beast-panel-card beast-research-stack"} ${
                draggingStackId === stack.id ? "is-dragging" : ""
              }`}
              data-stack-id={stack.id}
              key={stack.id}
              onDragEnter={() => moveDraggedStack(stack.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropStack(event, stack.id)}
              onPointerEnter={() => moveDraggedStack(stack.id)}
              onPointerUp={() => setDraggingStackId(null)}
            >
              <div className="beast-card-heading">
                <button
                  className="beast-drag-handle"
                  type="button"
                  aria-label="Drag Stack"
                  draggable
                  onPointerDown={() => setDraggingStackId(stack.id)}
                  onMouseDown={(event) => startStackMouseDrag(event, stack.id)}
                  onDragEnd={() => setDraggingStackId(null)}
                  onDragStart={(event) => startStackDrag(event, stack.id)}
                >
                  <GripVertical size={15} aria-hidden="true" />
                </button>
                {viewMode === "grid" ? (
                  <h3>{stack.title || "Research Stack"}</h3>
                ) : (
                  <input
                    className="beast-panel-input"
                    value={stack.title}
                    aria-label="Research stack title"
                    onChange={(event) => updateStackTitle(stack.id, event.currentTarget.value)}
                  />
                )}
                <IconButton label="Delete Stack" icon={Trash2} onClick={() => deleteStack(stack.id)} />
              </div>
              {viewMode === "grid" ? (
                <ResearchStackSummary stack={stack} />
              ) : (
                <>
                  <div className="beast-card-actions">
                    <button className="beast-panel-button" type="button" onClick={() => addItem(stack.id, "website")}>
                      <Link2 size={14} aria-hidden="true" />
                      Website
                    </button>
                    <button className="beast-panel-button" type="button" onClick={() => addItem(stack.id, "file")}>
                      <FileText size={14} aria-hidden="true" />
                      Local File
                    </button>
                  </div>
                  {stack.items.length === 0 ? (
                    <div className="beast-subtle-empty">No sources yet.</div>
                  ) : (
                    <div className="beast-research-items">
                      {stack.items.map((item) => (
                        <article className="beast-research-item" key={item.id}>
                          <div className="beast-card-heading">
                            <span className="beast-source-type">{item.type === "website" ? "Website" : "File"}</span>
                            <IconButton label="Delete Source" icon={Trash2} onClick={() => deleteItem(stack.id, item.id)} />
                          </div>
                          <input
                            className="beast-panel-input"
                            value={item.title}
                            aria-label="Research source title"
                            placeholder="Title"
                            onChange={(event) => updateItem(stack.id, item.id, "title", event.currentTarget.value)}
                          />
                          <input
                            className="beast-panel-input"
                            value={item.source}
                            aria-label="Research source path or URL"
                            placeholder={item.type === "website" ? "https://example.com" : "/Users/name/file.pdf"}
                            onChange={(event) => updateItem(stack.id, item.id, "source", event.currentTarget.value)}
                          />
                          <textarea
                            className="beast-panel-textarea"
                            value={item.note}
                            aria-label="Research source note"
                            placeholder="Why this belongs with the current page or scene."
                            rows={3}
                            onChange={(event) => updateItem(stack.id, item.id, "note", event.currentTarget.value)}
                          />
                          {item.source.trim() ? (
                            <a className="beast-source-link" href={researchItemHref(item)} target="_blank" rel="noreferrer">
                              <ExternalLink size={13} aria-hidden="true" />
                              Open source
                            </a>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ContextBadge({ context }: { context: WritingContext }) {
  return (
    <div className="beast-context-strip">
      <span>{context.kind === "scene" ? "Scene" : "Project"}</span>
      <strong>{context.label}</strong>
      {context.sceneNumber ? <em>#{context.sceneNumber}#</em> : null}
    </div>
  );
}

function ContextHeader({
  children,
  context,
  projectTitle,
}: {
  children?: ReactNode;
  context: WritingContext;
  projectTitle: string;
}) {
  const label = context.kind === "scene" ? "Scene" : "Project";
  const title = context.kind === "scene" ? context.label : projectTitle || "Untitled";

  return (
    <div className="beast-context-strip">
      <span>{label}</span>
      <strong>{title}</strong>
      {context.sceneNumber ? <em>#{context.sceneNumber}#</em> : null}
      {children ? <div className="beast-context-actions">{children}</div> : null}
    </div>
  );
}

function ViewModeToggle({
  mode,
  onModeChange,
}: {
  mode: "stacked" | "grid";
  onModeChange: (mode: "stacked" | "grid") => void;
}) {
  return (
    <div className="beast-view-toggle" aria-label="View mode">
      <IconButton label="Stacked View" icon={List} pressed={mode === "stacked"} onClick={() => onModeChange("stacked")} />
      <IconButton label="Grid View" icon={LayoutGrid} pressed={mode === "grid"} onClick={() => onModeChange("grid")} />
    </div>
  );
}

function ResearchStackSummary({ stack }: { stack: ResearchStack }) {
  if (stack.items.length === 0) return <p>No sources yet.</p>;

  return (
    <ul className="beast-stack-summary">
      {stack.items.slice(0, 4).map((item) => (
        <li key={item.id}>
          <span>{item.title || item.source || (item.type === "website" ? "Website" : "Local File")}</span>
        </li>
      ))}
      {stack.items.length > 4 ? <li>{stack.items.length - 4} more</li> : null}
    </ul>
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
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
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
    if (disabled) return;

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
    if (disabled) return;

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
        disabled={disabled}
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

function getPanelContext(metadata: ProjectMetadata, contextKey: string): PanelContextMetadata {
  return metadata.panels.contexts[contextKey] ?? createPanelContextMetadata();
}

function updatePanelContext(
  metadata: ProjectMetadata,
  contextKey: string,
  updater: (current: PanelContextMetadata) => PanelContextMetadata,
): ProjectMetadata {
  const context = metadata.panels.contexts[contextKey] ?? createPanelContextMetadata();

  return {
    ...metadata,
    panels: {
      ...metadata.panels,
      contexts: {
        ...metadata.panels.contexts,
        [contextKey]: updater(context),
      },
    },
  };
}

function normalizeBrowserUrl(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (/^(?:https?:|file:|about:)/i.test(value)) return value;
  if (/^[^\s/]+\.[^\s]+$/.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function getEmbeddableBrowserUrl(url: string): string {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const blockedHosts = new Set(["google.com", "bing.com", "duckduckgo.com", "x.com", "twitter.com"]);
    if (blockedHosts.has(hostname)) return "";
  } catch {
    return "";
  }

  return url;
}

function researchItemHref(item: ResearchItem): string {
  const source = item.source.trim();
  if (item.type === "website") return normalizeBrowserUrl(source);
  if (/^file:\/\//i.test(source)) return source;
  if (source.startsWith("/")) return `file://${source}`;
  return source;
}

function reorderById<T extends { id: string }>(items: T[], draggedId: string, targetId: string): T[] {
  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return items;

  const nextItems = [...items];
  const [dragged] = nextItems.splice(draggedIndex, 1);
  if (!dragged) return items;

  nextItems.splice(targetIndex, 0, dragged);
  return nextItems;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Prompt";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
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
