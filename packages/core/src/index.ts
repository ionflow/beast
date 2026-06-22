export type BlockType =
  | "blank"
  | "title"
  | "scene-heading"
  | "action"
  | "character"
  | "dialogue"
  | "parenthetical"
  | "transition"
  | "section"
  | "synopsis"
  | "note"
  | "page-break"
  | "lyrics"
  | "centered";

export interface ScreenplayBlock {
  id: string;
  type: BlockType;
  text: string;
  rawText: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  forced: boolean;
  dual: boolean;
}

export interface SceneNode {
  id: string;
  title: string;
  line: number;
  position: number;
}

export interface ScreenplayDocument {
  text: string;
  blocks: ScreenplayBlock[];
  scenes: SceneNode[];
  titlePage: Record<string, string[]>;
}

export interface TextSelection {
  from: number;
  to: number;
}

export type EditorCommand =
  | "force-scene-heading"
  | "force-action"
  | "force-character"
  | "force-dialogue"
  | "force-parenthetical"
  | "force-transition"
  | "smart-enter"
  | "cycle-block-type"
  | "toggle-note"
  | "toggle-section"
  | "toggle-synopsis"
  | "toggle-page-break"
  | "toggle-dual-dialogue";

export interface CommandResult {
  text: string;
  selection: TextSelection;
  document: ScreenplayDocument;
  handled: boolean;
}

interface LineInfo {
  number: number;
  text: string;
  start: number;
  end: number;
}

interface LineRange {
  start: number;
  end: number;
  text: string;
  lineNumber: number;
}

const SCENE_RE = /^((?:INT|EXT|EST|INT\/EXT|EXT\/INT|I\/E|INT\.\/EXT|EXT\.\/INT)[. ].*)$/i;
const TRANSITION_RE = /^(?:FADE(?:\s+IN|\s+OUT)?\.|CUT TO:|MATCH CUT TO:|SMASH CUT TO:|DISSOLVE TO:|BACK TO:|JUMP CUT TO:|END CREDITS\.|TO BLACK\.)$/;
const TITLE_KEY_RE = /^(title|credit|author|authors|source|draft date|date|contact|copyright):\s*(.*)$/i;
const CHARACTER_RE = /^[A-Z0-9][A-Z0-9 '\-.()/#]*\^?$/;

export function parseFountain(text: string): ScreenplayDocument {
  const normalized = normalizeNewlines(text);
  const lines = getLines(normalized);
  const titlePage = parseTitlePage(lines);
  const titleLines = new Set<number>();
  let consumedTitle = titlePage.lineCount;

  for (let index = 0; index < consumedTitle; index += 1) {
    if (lines[index]?.text.trim()) {
      titleLines.add(index);
    }
  }

  const blocks: ScreenplayBlock[] = [];
  const scenes: SceneNode[] = [];
  let inDialogue = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previous = previousNonBlank(lines, index);
    const next = nextNonBlank(lines, index);
    const type = titleLines.has(index)
      ? "title"
      : classifyLine(line.text, {
          inDialogue,
          previousText: previous?.text ?? "",
          nextText: next?.text ?? "",
        });
    const clean = displayTextForType(line.text, type);
    const block: ScreenplayBlock = {
      id: `block-${index + 1}`,
      type,
      text: clean,
      rawText: line.text,
      startLine: line.number,
      endLine: line.number,
      startOffset: line.start,
      endOffset: line.end,
      forced: isForced(line.text, type),
      dual: type === "character" && stripCharacterForce(line.text).trimEnd().endsWith("^"),
    };

    blocks.push(block);

    if (type === "scene-heading") {
      scenes.push({
        id: `scene-${scenes.length + 1}`,
        title: clean,
        line: line.number,
        position: line.start,
      });
    }

    if (type === "blank") {
      inDialogue = false;
    } else if (type === "character" || type === "dialogue" || type === "parenthetical" || type === "lyrics") {
      inDialogue = true;
    } else if (type !== "note") {
      inDialogue = false;
    }
  }

  return {
    text: normalized,
    blocks,
    scenes,
    titlePage: titlePage.values,
  };
}

export function serializeFountain(document: ScreenplayDocument): string {
  return document.text;
}

export function classifyBlock(lines: string[], cursor: number | { line: number }): BlockType {
  const line = typeof cursor === "number" ? cursor : cursor.line;
  const text = lines[line] ?? "";
  const previous = findPreviousText(lines, line);
  const next = findNextText(lines, line);
  const inDialogue = previous ? isCharacterLine(previous) || isParentheticalLine(previous) : false;
  return classifyLine(text, { inDialogue, previousText: previous, nextText: next });
}

export function applyCommand(text: string, selection: TextSelection, command: EditorCommand): CommandResult {
  const normalized = normalizeNewlines(text);
  const safeSelection = clampSelection(selection, normalized.length);
  const range = getLineRange(normalized, safeSelection.from);
  const document = parseFountain(normalized);
  const block = blockAt(document, safeSelection.from);

  let nextText = normalized;
  let nextSelection = safeSelection;

  switch (command) {
    case "force-scene-heading":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, forceSceneHeading(range.text));
      break;
    case "force-action":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, forceAction(range.text));
      break;
    case "force-character":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, forceCharacter(range.text));
      break;
    case "force-dialogue":
      [nextText, nextSelection] = forceDialogue(normalized, range);
      break;
    case "force-parenthetical":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, forceParenthetical(range.text));
      break;
    case "force-transition":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, forceTransition(range.text));
      break;
    case "smart-enter":
      [nextText, nextSelection] = smartEnter(normalized, safeSelection, block?.type ?? "action");
      break;
    case "cycle-block-type":
      return applyCommand(normalized, safeSelection, nextCycleCommand(block?.type ?? "action"));
    case "toggle-note":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, toggleNote(range.text));
      break;
    case "toggle-section":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, toggleSection(range.text));
      break;
    case "toggle-synopsis":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, toggleSynopsis(range.text));
      break;
    case "toggle-page-break":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, range.text.trim() === "===" ? "" : "===");
      break;
    case "toggle-dual-dialogue":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, toggleDualDialogue(range.text));
      break;
    default:
      return {
        text: normalized,
        selection: safeSelection,
        document,
        handled: false,
      };
  }

  return {
    text: nextText,
    selection: nextSelection,
    document: parseFountain(nextText),
    handled: true,
  };
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function getLines(text: string): LineInfo[] {
  const parts = text.split("\n");
  const lines: LineInfo[] = [];
  let offset = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    lines.push({
      number: index + 1,
      text: part,
      start: offset,
      end: offset + part.length,
    });
    offset += part.length + 1;
  }

  return lines;
}

function parseTitlePage(lines: LineInfo[]): { values: Record<string, string[]>; lineCount: number } {
  const values: Record<string, string[]> = {};
  let activeKey = "";
  let index = 0;

  for (; index < lines.length; index += 1) {
    const raw = lines[index]?.text ?? "";
    const trimmed = raw.trim();

    if (!trimmed) {
      if (Object.keys(values).length > 0) {
        index += 1;
      }
      break;
    }

    const match = raw.match(TITLE_KEY_RE);
    if (match) {
      activeKey = normalizeTitleKey(match[1] ?? "");
      values[activeKey] = [match[2]?.trim() ?? ""].filter(Boolean);
      continue;
    }

    if (/^\s+/.test(raw) && activeKey) {
      values[activeKey]?.push(trimmed);
      continue;
    }

    return { values: {}, lineCount: 0 };
  }

  return { values, lineCount: Object.keys(values).length > 0 ? index : 0 };
}

function normalizeTitleKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function classifyLine(
  raw: string,
  context: { inDialogue: boolean; previousText: string; nextText: string },
): BlockType {
  const text = raw.trim();

  if (!text) return "blank";
  if (isNoteLine(text)) return "note";
  if (/^={3,}$/.test(text)) return "page-break";
  if (/^#{1,6}(?:\s|$)/.test(text)) return "section";
  if (/^=(?:\s|$)/.test(text)) return "synopsis";
  if (/^>.*<$/.test(text)) return "centered";
  if (text.startsWith("~")) return "lyrics";
  if (isSceneHeadingLine(text)) return "scene-heading";
  if (isTransitionLine(text)) return "transition";
  if (context.inDialogue && isParentheticalLine(text)) return "parenthetical";
  if (text.startsWith("@")) return "character";
  if (isCharacterLine(text) && canBeCharacterCue(context.nextText)) return "character";
  if (context.inDialogue) return "dialogue";
  if (text.startsWith("!")) return "action";
  return "action";
}

function previousNonBlank(lines: LineInfo[], index: number): LineInfo | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (lines[cursor]?.text.trim()) return lines[cursor];
  }
  return undefined;
}

function nextNonBlank(lines: LineInfo[], index: number): LineInfo | undefined {
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor]?.text.trim()) return lines[cursor];
  }
  return undefined;
}

function findPreviousText(lines: string[], index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (lines[cursor]?.trim()) return lines[cursor] ?? "";
  }
  return "";
}

function findNextText(lines: string[], index: number): string {
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor]?.trim()) return lines[cursor] ?? "";
  }
  return "";
}

function isNoteLine(text: string): boolean {
  return text.startsWith("[[") && text.endsWith("]]");
}

function isSceneHeadingLine(text: string): boolean {
  return text.startsWith(".") || SCENE_RE.test(text);
}

function isTransitionLine(text: string): boolean {
  if (text.startsWith(">") && !text.endsWith("<")) return true;
  return text === text.toUpperCase() && TRANSITION_RE.test(text);
}

function isParentheticalLine(text: string): boolean {
  return text.startsWith("(") && text.endsWith(")");
}

function isCharacterLine(text: string): boolean {
  const stripped = stripCharacterForce(text).trim();
  if (!stripped) return false;
  if (text.startsWith("@")) return true;
  if (stripped.length > 42) return false;
  if (isSceneHeadingLine(stripped) || isTransitionLine(stripped)) return false;
  return stripped === stripped.toUpperCase() && CHARACTER_RE.test(stripped);
}

function canBeCharacterCue(nextText: string): boolean {
  const next = nextText.trim();
  if (!next) return false;
  if (isSceneHeadingLine(next) || isTransitionLine(next) || /^#{1,6}(?:\s|$)/.test(next) || /^={1,}$/.test(next)) {
    return false;
  }
  return true;
}

function displayTextForType(raw: string, type: BlockType): string {
  const text = raw.trim();

  switch (type) {
    case "scene-heading":
      return text.startsWith(".") ? text.slice(1).trim() : text;
    case "action":
      return text.startsWith("!") ? text.slice(1).trim() : raw;
    case "character":
      return stripCharacterForce(text).replace(/\^$/, "").trim();
    case "transition":
      return text.startsWith(">") ? text.slice(1).trim() : text;
    case "section":
      return text.replace(/^#{1,6}\s*/, "");
    case "synopsis":
      return text.replace(/^=\s*/, "");
    case "note":
      return text.replace(/^\[\[/, "").replace(/\]\]$/, "");
    case "centered":
      return text.replace(/^>\s*/, "").replace(/\s*<$/, "");
    case "lyrics":
      return text.replace(/^~\s*/, "");
    default:
      return raw;
  }
}

function isForced(raw: string, type: BlockType): boolean {
  const text = raw.trim();
  return (
    (type === "scene-heading" && text.startsWith(".")) ||
    (type === "action" && text.startsWith("!")) ||
    (type === "character" && text.startsWith("@")) ||
    (type === "transition" && text.startsWith(">") && !text.endsWith("<"))
  );
}

function stripCharacterForce(text: string): string {
  return text.startsWith("@") ? text.slice(1) : text;
}

function clampSelection(selection: TextSelection, length: number): TextSelection {
  const from = Math.max(0, Math.min(selection.from, length));
  const to = Math.max(0, Math.min(selection.to, length));
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

function getLineRange(text: string, position: number): LineRange {
  const start = text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const nextBreak = text.indexOf("\n", position);
  const end = nextBreak === -1 ? text.length : nextBreak;
  const lineNumber = text.slice(0, start).split("\n").length;

  return {
    start,
    end,
    text: text.slice(start, end),
    lineNumber,
  };
}

function blockAt(document: ScreenplayDocument, position: number): ScreenplayBlock | undefined {
  return document.blocks.find((block) => position >= block.startOffset && position <= block.endOffset);
}

function replaceCurrentLine(text: string, range: LineRange, replacement: string): [string, TextSelection] {
  const nextText = `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;
  const nextPosition = range.start + replacement.length;
  return [nextText, { from: nextPosition, to: nextPosition }];
}

function cleanLine(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^\[\[/, "").replace(/\]\]$/, "");
  text = text.replace(/^#{1,6}\s*/, "");
  text = text.replace(/^=\s*/, "");
  text = text.replace(/^[.!@>]\s*/, "");
  text = text.replace(/\^$/, "");
  return text.trim();
}

function forceSceneHeading(raw: string): string {
  const text = cleanLine(raw);
  if (!text) return ".INT. LOCATION - DAY";
  return isSceneHeadingLine(text) ? text.toUpperCase() : `.${text.toUpperCase()}`;
}

function forceAction(raw: string): string {
  const text = cleanLine(raw);
  return text ? `!${text}` : "!";
}

function forceCharacter(raw: string): string {
  const text = cleanLine(raw);
  return text ? `@${text.toUpperCase()}` : "@CHARACTER";
}

function forceDialogue(text: string, range: LineRange): [string, TextSelection] {
  const before = text.slice(0, range.start);
  const previousRange = getPreviousLineRange(text, range.start);
  const previousText = previousRange?.text.trim() ?? "";
  const current = cleanLine(range.text) || "Dialogue";

  if (isCharacterLine(previousText) || isParentheticalLine(previousText)) {
    return replaceCurrentLine(text, range, current);
  }

  const insertion = `CHARACTER\n${current}`;
  const nextText = `${before}${insertion}${text.slice(range.end)}`;
  const nextPosition = range.start + insertion.length;
  return [nextText, { from: nextPosition, to: nextPosition }];
}

function getPreviousLineRange(text: string, lineStart: number): LineRange | undefined {
  if (lineStart <= 0) return undefined;
  const previousEnd = lineStart - 1;
  const previousStart = text.lastIndexOf("\n", previousEnd - 1) + 1;
  return {
    start: previousStart,
    end: previousEnd,
    text: text.slice(previousStart, previousEnd),
    lineNumber: text.slice(0, previousStart).split("\n").length,
  };
}

function forceParenthetical(raw: string): string {
  const text = cleanLine(raw).replace(/^\(|\)$/g, "").trim();
  return text ? `(${text})` : "(beat)";
}

function forceTransition(raw: string): string {
  const text = cleanLine(raw).replace(/:$/, "").trim();
  if (!text) return "> CUT TO:";
  if (text.endsWith(".")) return `> ${text.toUpperCase()}`;
  return `> ${text.toUpperCase()}:`;
}

function smartEnter(text: string, selection: TextSelection, type: BlockType): [string, TextSelection] {
  const insertAt = selection.to;
  const insert = type === "dialogue" || type === "transition" ? "\n\n" : "\n";
  const nextText = `${text.slice(0, insertAt)}${insert}${text.slice(insertAt)}`;
  const nextPosition = insertAt + insert.length;
  return [nextText, { from: nextPosition, to: nextPosition }];
}

function nextCycleCommand(type: BlockType): EditorCommand {
  switch (type) {
    case "action":
      return "force-scene-heading";
    case "scene-heading":
      return "force-character";
    case "character":
      return "force-parenthetical";
    case "parenthetical":
      return "force-transition";
    default:
      return "force-action";
  }
}

function toggleNote(raw: string): string {
  const text = raw.trim();
  if (isNoteLine(text)) return text.replace(/^\[\[/, "").replace(/\]\]$/, "");
  return `[[${cleanLine(raw) || "Note"}]]`;
}

function toggleSection(raw: string): string {
  const text = raw.trim();
  if (/^#{1,6}(?:\s|$)/.test(text)) return text.replace(/^#{1,6}\s*/, "");
  return `# ${cleanLine(raw) || "Section"}`;
}

function toggleSynopsis(raw: string): string {
  const text = raw.trim();
  if (/^=(?:\s|$)/.test(text) && !/^={3,}$/.test(text)) return text.replace(/^=\s*/, "");
  return `= ${cleanLine(raw) || "Synopsis"}`;
}

function toggleDualDialogue(raw: string): string {
  const text = forceCharacter(raw);
  if (text.endsWith("^")) return text.slice(0, -1);
  return `${text}^`;
}
