import {
  applyCommand,
  findInlineFormattingRanges,
  type EditorCommand,
  parseFountain,
  type ScreenplayDocument,
  type TextSelection,
} from "@beast/core";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { Decoration, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";

export interface FountainEditorProps {
  value: string;
  onChange: (value: string, document: ScreenplayDocument) => void;
  onSelectionChange?: (selection: TextSelection) => void;
  className?: string;
  scrollToPosition?: number;
}

export const editorCommands: Record<string, EditorCommand> = {
  "Mod-1": "force-scene-heading",
  "Mod-2": "force-action",
  "Mod-3": "force-character",
  "Mod-4": "force-dialogue",
  "Mod-5": "force-parenthetical",
  "Mod-6": "force-transition",
  Enter: "smart-enter",
  Tab: "cycle-block-type",
  "Mod-/": "toggle-note",
  "Mod-Alt-1": "toggle-section",
  "Mod-Alt-2": "toggle-synopsis",
  "Mod-Alt-3": "toggle-page-break",
  "Mod-Alt-D": "toggle-dual-dialogue",
  "Mod-Alt-C": "toggle-centered",
  "Mod-Alt-L": "toggle-lyrics",
  "Mod-Alt-B": "toggle-boneyard",
  "Mod-Alt-N": "toggle-scene-number",
  "Mod-B": "toggle-bold",
  "Mod-I": "toggle-italic",
  "Mod-U": "toggle-underline",
};

export function FountainEditor({ value, onChange, onSelectionChange, className, scrollToPosition }: FountainEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;

  const extensions = useMemo(
    () =>
      createFountainExtensions({
        onChange: (nextValue, document) => onChangeRef.current(nextValue, document),
        onSelectionChange: (selection) => onSelectionChangeRef.current?.(selection),
      }),
    [],
  );

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return undefined;

    const view = new EditorView({
      doc: value,
      extensions,
      parent: hostRef.current,
    });

    viewRef.current = view;
    onSelectionChangeRef.current?.({ from: view.state.selection.main.from, to: view.state.selection.main.to });

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || scrollToPosition == null) return;

    const position = Math.max(0, Math.min(scrollToPosition, view.state.doc.length));
    view.dispatch({
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
    view.focus();
  }, [scrollToPosition]);

  useEffect(() => {
    const handler = (event: Event) => {
      const command = (event as CustomEvent<EditorCommand>).detail;
      const view = viewRef.current;

      if (view && isEditorCommand(command)) {
        runEditorCommand(view, command);
        view.focus();
      }
    };

    window.addEventListener("beast:editor-command", handler);
    return () => window.removeEventListener("beast:editor-command", handler);
  }, []);

  return <div ref={hostRef} className={className} />;
}

export function createFountainExtensions(options: {
  onChange?: (value: string, document: ScreenplayDocument) => void;
  onSelectionChange?: (selection: TextSelection) => void;
} = {}): Extension[] {
  return [
    basicSetup,
    EditorView.lineWrapping,
    fountainTheme,
    fountainDecorations,
    Prec.highest(keymap.of([
      ...Object.entries(editorCommands).map(([key, command]) => ({
        key,
        run: (view: EditorView) => runEditorCommand(view, command),
        preventDefault: true,
      })),
      ...historyKeymap,
      ...defaultKeymap,
    ])),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const value = update.state.doc.toString();
        options.onChange?.(value, parseFountain(value));
      }

      if (update.docChanged || update.selectionSet) {
        const selection = update.state.selection.main;
        options.onSelectionChange?.({ from: selection.from, to: selection.to });
      }
    }),
  ];
}

export function runEditorCommand(view: EditorView, command: EditorCommand): boolean {
  const text = view.state.doc.toString();
  const selection = view.state.selection.main;
  const result = applyCommand(text, { from: selection.from, to: selection.to }, command);

  if (!result.handled) return false;

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.text },
    selection: { anchor: result.selection.from, head: result.selection.to },
    userEvent: "input",
  });

  return true;
}

function isEditorCommand(command: unknown): command is EditorCommand {
  return typeof command === "string" && Object.values(editorCommands).includes(command as EditorCommand);
}

const fountainDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const document = parseFountain(view.state.doc.toString());

  for (const block of document.blocks) {
    if (block.type === "blank") continue;

    const line = view.state.doc.lineAt(Math.min(block.startOffset, view.state.doc.length));
    const classes = [`cm-fountain-${block.type}`];
    if (block.forced) classes.push("cm-fountain-forced");
    if (block.dual) classes.push("cm-fountain-dual");
    if (block.omitted) classes.push("cm-fountain-omitted");
    if (block.escaped) classes.push("cm-fountain-escaped");
    builder.add(line.from, line.from, Decoration.line({ class: classes.join(" ") }));

    for (const range of findInlineFormattingRanges(block.rawText)) {
      const from = line.from + range.from;
      const to = line.from + range.to;
      if (from < to && to <= line.to) {
        builder.add(
          from,
          to,
          Decoration.mark({
            class: range.styles.map((style) => `cm-fountain-inline-${style}`).join(" "),
          }),
        );
      }
    }
  }

  return builder.finish();
}

const fountainTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--beast-editor-font-size, 16px)",
    background: "var(--beast-editor-bg)",
    color: "var(--beast-ink)",
  },
  ".cm-scroller": {
    fontFamily: '"Courier Prime", "Courier New", monospace',
    lineHeight: "1.45",
  },
  ".cm-content": {
    maxWidth: "78ch",
    margin: "0 auto",
    padding: "32px 32px 44vh",
    minHeight: "100%",
  },
  ".cm-line": {
    padding: "0 2px",
  },
  ".cm-fountain-title": {
    color: "var(--beast-muted)",
  },
  ".cm-fountain-scene-heading": {
    fontWeight: "700",
    textTransform: "uppercase",
    color: "var(--beast-scene)",
  },
  ".cm-fountain-character": {
    paddingLeft: "24ch",
    textTransform: "uppercase",
  },
  ".cm-fountain-dialogue": {
    paddingLeft: "14ch",
    maxWidth: "48ch",
  },
  ".cm-fountain-parenthetical": {
    paddingLeft: "18ch",
    color: "var(--beast-muted)",
  },
  ".cm-fountain-transition": {
    textAlign: "right",
    textTransform: "uppercase",
    color: "var(--beast-accent)",
  },
  ".cm-fountain-section": {
    marginTop: "12px",
    fontWeight: "700",
    color: "var(--beast-section)",
  },
  ".cm-fountain-synopsis": {
    color: "var(--beast-synopsis)",
    fontStyle: "italic",
  },
  ".cm-fountain-note": {
    color: "var(--beast-note)",
    background: "var(--beast-note-bg)",
  },
  ".cm-fountain-boneyard": {
    color: "var(--beast-muted)",
    background: "rgba(111, 106, 100, 0.12)",
    textDecoration: "line-through",
  },
  ".cm-fountain-page-break": {
    color: "var(--beast-muted)",
    textAlign: "center",
    letterSpacing: "0",
  },
  ".cm-fountain-centered": {
    textAlign: "center",
  },
  ".cm-fountain-lyrics": {
    fontStyle: "italic",
  },
  ".cm-fountain-inline-bold": {
    fontWeight: "700",
  },
  ".cm-fountain-inline-italic": {
    fontStyle: "italic",
  },
  ".cm-fountain-inline-underline": {
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-fountain-inline-note": {
    color: "var(--beast-note)",
    background: "var(--beast-note-bg)",
  },
});
