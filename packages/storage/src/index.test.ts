import { describe, expect, it, vi } from "vitest";
import {
  createPanelContextMetadata,
  createProjectBundle,
  createWebStorageAdapter,
  BROWSER_PANEL_FILE,
  CONTEXTS_DIR,
  PANEL_PREFERENCES_FILE,
  PROJECT_FILE,
  type ProjectBundle,
  SCRIPT_FILE,
  validateProjectBundle,
} from "./index";

describe("web storage adapter", () => {
  it("loads a folder bundle from selected files", async () => {
    const adapter = createWebStorageAdapter();
    const bundle = createProjectBundle({ title: "Loaded", script: "INT. ROOM - DAY" });
    const files = [
      new File([JSON.stringify(bundle.metadata)], PROJECT_FILE),
      new File([bundle.script], SCRIPT_FILE),
    ];

    const loaded = await adapter.loadProject({ kind: "files", files });

    expect(loaded.metadata.title).toBe("Loaded");
    expect(loaded.script).toBe("INT. ROOM - DAY");
  });

  it("rejects missing bundle files", async () => {
    const adapter = createWebStorageAdapter();

    await expect(adapter.loadProject({ kind: "files", files: [new File(["{}"], PROJECT_FILE)] })).rejects.toThrow(
      SCRIPT_FILE,
    );
  });

  it("persists local drafts", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    });

    const adapter = createWebStorageAdapter();
    const bundle = createProjectBundle({ title: "Draft" });
    await adapter.saveProject(bundle);

    const loaded = await adapter.loadProject({ kind: "local" });
    expect(loaded.metadata.title).toBe("Draft");
  });

  it("creates default right panel metadata", () => {
    const bundle = createProjectBundle({ title: "Panels" });

    expect(bundle.metadata.panels.browser).toEqual({
      currentUrl: "",
      history: [],
      historyIndex: -1,
    });
    expect(bundle.metadata.panels.preferences).toEqual({
      notecardsView: "stacked",
      researchView: "stacked",
    });
    expect(bundle.metadata.panels.contexts).toEqual({});
  });

  it("hydrates missing right panel metadata in older bundles", () => {
    const bundle = createProjectBundle({ title: "Legacy" });
    const legacy = {
      ...bundle,
      metadata: {
        ...bundle.metadata,
        panels: undefined,
      },
    } as unknown as ProjectBundle;

    const hydrated = validateProjectBundle(legacy);

    expect(hydrated.metadata.panels.browser.historyIndex).toBe(-1);
    expect(hydrated.metadata.panels.contexts).toEqual({});
  });

  it("round trips panel metadata through exported project files", async () => {
    const adapter = createWebStorageAdapter();
    const bundle = createProjectBundle({ title: "Round Trip" });
    const context = createPanelContextMetadata();
    context.notecards.push({
      id: "card-1",
      title: "Beat",
      body: "A useful note.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    bundle.metadata.panels.contexts["scene:int-room-day:1"] = context;
    bundle.metadata.panels.browser = {
      currentUrl: "https://example.com",
      history: ["https://example.com"],
      historyIndex: 0,
    };

    const files = adapter.exportProjectFiles(bundle).map((file) => new File([file.content], file.name));
    const loaded = await adapter.loadProject({ kind: "files", files });
    const projectJson = adapter.exportProjectFiles(bundle).find((file) => file.name === PROJECT_FILE);
    const browserJson = adapter.exportProjectFiles(bundle).find((file) => file.name === BROWSER_PANEL_FILE);
    const preferencesJson = adapter.exportProjectFiles(bundle).find((file) => file.name === PANEL_PREFERENCES_FILE);
    const contextJson = adapter.exportProjectFiles(bundle).find((file) => file.name.startsWith(`${CONTEXTS_DIR}/`));

    expect(projectJson?.content).not.toContain("\"panels\"");
    expect(browserJson?.content).toContain("https://example.com");
    expect(preferencesJson?.content).toContain("notecardsView");
    expect(contextJson?.content).toContain("scene:int-room-day:1");
    expect(loaded.metadata.panels.browser.currentUrl).toBe("https://example.com");
    expect(loaded.metadata.panels.contexts["scene:int-room-day:1"]?.notecards[0]?.title).toBe("Beat");
  });

  it("hydrates legacy string research assets as project files", () => {
    const bundle = createProjectBundle({ title: "Legacy Assets" });
    const context = createPanelContextMetadata();
    context.researchStacks.push({
      id: "stack-1",
      title: "Captures",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "research-item-1",
          type: "website",
          title: "Roswell",
          source: "https://example.com",
          note: "",
          assets: ["assets/research/chrome-capture.jpg"] as unknown as [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    bundle.metadata.panels.contexts.project = context;

    const hydrated = validateProjectBundle(bundle);
    const asset = hydrated.metadata.panels.contexts.project?.researchStacks[0]?.items[0]?.assets[0];

    expect(asset).toMatchObject({
      name: "chrome-capture.jpg",
      kind: "image",
      source: "assets/research/chrome-capture.jpg",
      storage: "project",
    });
  });

  it("round trips structured research assets through exported project files", async () => {
    const adapter = createWebStorageAdapter();
    const bundle = createProjectBundle({ title: "Structured Assets" });
    const context = createPanelContextMetadata();
    context.researchStacks.push({
      id: "stack-1",
      title: "Captures",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "research-item-1",
          type: "website",
          title: "Archive",
          source: "https://example.com",
          note: "",
          assets: [
            {
              id: "asset-1",
              name: "source.pdf",
              kind: "pdf",
              source: "assets/research/research-item-1/source.pdf",
              storage: "project",
              mimeType: "application/pdf",
              size: 1024,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    bundle.metadata.panels.contexts.project = context;

    const files = adapter.exportProjectFiles(bundle).map((file) => new File([file.content], file.name));
    const loaded = await adapter.loadProject({ kind: "files", files });
    const asset = loaded.metadata.panels.contexts.project?.researchStacks[0]?.items[0]?.assets[0];

    expect(asset).toMatchObject({
      id: "asset-1",
      name: "source.pdf",
      kind: "pdf",
      source: "assets/research/research-item-1/source.pdf",
      storage: "project",
      mimeType: "application/pdf",
      size: 1024,
    });
  });
});
