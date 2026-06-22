import { describe, expect, it, vi } from "vitest";
import { createProjectBundle, createWebStorageAdapter, PROJECT_FILE, SCRIPT_FILE } from "./index";

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
});
