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
  | "centered"
  | "boneyard";

export type InlineStyle = "bold" | "italic" | "underline" | "note";

export interface InlineSpan {
  text: string;
  styles: InlineStyle[];
}

export interface InlineFormatRange {
  from: number;
  to: number;
  styles: InlineStyle[];
}

export interface ScreenplayBlock {
  id: string;
  type: BlockType;
  text: string;
  inline: InlineSpan[];
  rawText: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  forced: boolean;
  dual: boolean;
  escaped: boolean;
  omitted: boolean;
  level?: number;
  sceneNumber?: string;
}

export interface SceneNode {
  id: string;
  title: string;
  line: number;
  position: number;
  sceneNumber?: string;
}

export interface OutlineNode {
  id: string;
  type: "scene" | "section";
  title: string;
  line: number;
  position: number;
  level: number;
  sceneNumber?: string;
}

export interface ScreenplayDocument {
  text: string;
  blocks: ScreenplayBlock[];
  scenes: SceneNode[];
  outline: OutlineNode[];
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
  | "toggle-dual-dialogue"
  | "toggle-centered"
  | "toggle-lyrics"
  | "toggle-boneyard"
  | "toggle-bold"
  | "toggle-italic"
  | "toggle-underline"
  | "toggle-scene-number";

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

const SCENE_RE = /^((?:INT|EXT|EST|INT\.?\/\.?EXT|EXT\.?\/\.?INT|I\/E)(?:\.|\s).*)$/i;
const SCENE_NUMBER_RE = /\s+#([A-Za-z0-9.-]+)#\s*$/;
const TRANSITION_RE = /^(?:FADE(?:\s+IN|\s+OUT)?\.|CUT TO:|MATCH CUT TO:|SMASH CUT TO:|DISSOLVE TO:|BACK TO:|JUMP CUT TO:|END CREDITS\.|TO BLACK\.)$/;
const TITLE_KEY_RE = /^([A-Za-z][A-Za-z0-9 _-]*):\s*(.*)$/;
const CHARACTER_RE = /^[A-Z0-9][A-Z0-9 '\-.()/#]*\^?$/;
const ESCAPED_LINE_RE = /^\\./;

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
  const outline: OutlineNode[] = [];
  let inDialogue = false;
  let inBoneyard = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previous = previousNonBlank(lines, index);
    const next = nextNonBlank(lines, index);
    const startsBoneyard = line.text.includes("/*");
    const endsBoneyard = line.text.includes("*/");
    const omitted = inBoneyard || startsBoneyard;
    const type = omitted
      ? "boneyard"
      : titleLines.has(index)
      ? "title"
      : classifyLine(line.text, {
          inDialogue,
          previousText: previous?.text ?? "",
          nextText: next?.text ?? "",
          previousLineText: lines[index - 1]?.text ?? "",
          nextLineText: lines[index + 1]?.text ?? "",
        });
    const clean = displayTextForType(line.text, type);
    const inline = parseInlineFormatting(clean);
    const sceneNumber = type === "scene-heading" ? extractSceneNumber(stripSceneHeadingForce(line.text).trim()).sceneNumber : undefined;
    const level = type === "section" ? getSectionLevel(line.text) : undefined;
    const block: ScreenplayBlock = {
      id: `block-${index + 1}`,
      type,
      text: plainTextFromSpans(inline),
      inline,
      rawText: line.text,
      startLine: line.number,
      endLine: line.number,
      startOffset: line.start,
      endOffset: line.end,
      forced: isForced(line.text, type),
      dual: type === "character" && stripCharacterForce(line.text).trimEnd().endsWith("^"),
      escaped: isEscapedLine(line.text),
      omitted,
      level,
      sceneNumber,
    };

    blocks.push(block);

    if (type === "scene-heading") {
      const scene = {
        id: `scene-${scenes.length + 1}`,
        title: block.text,
        line: line.number,
        position: line.start,
        sceneNumber,
      };
      scenes.push(scene);
      outline.push({
        ...scene,
        id: `outline-${outline.length + 1}`,
        type: "scene",
        level: 1,
      });
    } else if (type === "section") {
      outline.push({
        id: `outline-${outline.length + 1}`,
        type: "section",
        title: block.text,
        line: line.number,
        position: line.start,
        level: level ?? 1,
      });
    }

    if (startsBoneyard && !endsBoneyard) {
      inBoneyard = true;
    } else if (endsBoneyard) {
      inBoneyard = false;
    }

    if (type === "blank" || type === "boneyard") {
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
    outline,
    titlePage: titlePage.values,
  };
}

export function serializeFountain(document: ScreenplayDocument): string {
  return document.text;
}

export function parseInlineFormatting(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let buffer = "";
  const stack: Array<{ token: string; styles: InlineStyle[] }> = [];
  let index = 0;

  const flush = () => {
    if (!buffer) return;
    spans.push({ text: buffer, styles: activeStylesFromStack(stack) });
    buffer = "";
  };

  const push = (token: string, nextStyles: InlineStyle[]) => {
    flush();
    stack.push({ token, styles: nextStyles });
  };

  const pop = () => {
    flush();
    stack.pop();
  };

  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (text.startsWith("[[", index)) {
      const close = findClosingDelimiter(text, index + 2, "]]");
      if (close !== -1) {
        flush();
        spans.push({
          text: unescapeInlineText(text.slice(index + 2, close)),
          styles: ["note"],
        });
        index = close + 2;
        continue;
      }
    }

    const delimiter = inlineDelimiterAt(text, index);
    if (delimiter && stack[stack.length - 1]?.token === delimiter.token) {
      pop();
      index += delimiter.token.length;
      continue;
    }

    if (delimiter && findClosingDelimiter(text, index + delimiter.token.length, delimiter.token) !== -1) {
      push(delimiter.token, delimiter.styles);
      index += delimiter.token.length;
      continue;
    }

    buffer += text[index];
    index += 1;
  }

  flush();
  return spans;
}

export function findInlineFormattingRanges(text: string): InlineFormatRange[] {
  const ranges: InlineFormatRange[] = [];
  const stack: Array<{ token: string; styles: InlineStyle[]; from: number }> = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length) {
      index += 2;
      continue;
    }

    if (text.startsWith("[[", index)) {
      const close = findClosingDelimiter(text, index + 2, "]]");
      if (close !== -1) {
        ranges.push({ from: index + 2, to: close, styles: ["note"] });
        index = close + 2;
        continue;
      }
    }

    const delimiter = inlineDelimiterAt(text, index);
    if (!delimiter) {
      index += 1;
      continue;
    }

    const top = stack[stack.length - 1];
    if (top?.token === delimiter.token) {
      stack.pop();
      if (top.from < index) {
        ranges.push({ from: top.from, to: index, styles: top.styles });
      }
      index += delimiter.token.length;
      continue;
    }

    if (findClosingDelimiter(text, index + delimiter.token.length, delimiter.token) !== -1) {
      stack.push({
        token: delimiter.token,
        styles: delimiter.styles,
        from: index + delimiter.token.length,
      });
      index += delimiter.token.length;
      continue;
    }

    index += 1;
  }

  return ranges;
}

export function classifyBlock(lines: string[], cursor: number | { line: number }): BlockType {
  const line = typeof cursor === "number" ? cursor : cursor.line;
  const text = lines[line] ?? "";
  const previous = findPreviousText(lines, line);
  const next = findNextText(lines, line);
  const inDialogue = previous ? isCharacterLine(previous) || isParentheticalLine(previous) : false;
  return classifyLine(text, {
    inDialogue,
    previousText: previous,
    nextText: next,
    previousLineText: lines[line - 1] ?? "",
    nextLineText: lines[line + 1] ?? "",
  });
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
    case "toggle-centered":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, toggleCentered(range.text));
      break;
    case "toggle-lyrics":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, toggleLyrics(range.text));
      break;
    case "toggle-boneyard":
      [nextText, nextSelection] = toggleBoneyard(normalized, safeSelection);
      break;
    case "toggle-bold":
      [nextText, nextSelection] = toggleInlineMarkup(normalized, safeSelection, "**");
      break;
    case "toggle-italic":
      [nextText, nextSelection] = toggleInlineMarkup(normalized, safeSelection, "*");
      break;
    case "toggle-underline":
      [nextText, nextSelection] = toggleInlineMarkup(normalized, safeSelection, "_");
      break;
    case "toggle-scene-number":
      [nextText, nextSelection] = replaceCurrentLine(normalized, range, toggleSceneNumber(range.text));
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

function plainTextFromSpans(spans: InlineSpan[]): string {
  return spans
    .filter((span) => !span.styles.includes("note"))
    .map((span) => span.text)
    .join("");
}

function uniqueStyles(styles: InlineStyle[]): InlineStyle[] {
  return Array.from(new Set(styles)).sort();
}

function activeStylesFromStack(stack: Array<{ styles: InlineStyle[] }>): InlineStyle[] {
  return uniqueStyles(stack.flatMap((entry) => entry.styles));
}

function inlineDelimiterAt(text: string, index: number): { token: string; styles: InlineStyle[] } | undefined {
  if (text.startsWith("***", index)) return { token: "***", styles: ["bold", "italic"] };
  if (text.startsWith("**", index)) return { token: "**", styles: ["bold"] };
  if (text[index] === "*") return { token: "*", styles: ["italic"] };
  if (text[index] === "_") return { token: "_", styles: ["underline"] };
  return undefined;
}

function findClosingDelimiter(text: string, from: number, delimiter: string): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }

    if (text.startsWith(delimiter, index)) return index;
  }

  return -1;
}

function unescapeInlineText(text: string): string {
  return text.replace(/\\([\\*_()[\]])/g, "$1");
}

function classifyLine(
  raw: string,
  context: { inDialogue: boolean; previousText: string; nextText: string; previousLineText: string; nextLineText: string },
): BlockType {
  const text = raw.trim();

  if (!text) return "blank";
  if (isEscapedLine(text)) return "action";
  if (isNoteLine(text)) return "note";
  if (/^={3,}$/.test(text)) return "page-break";
  if (/^#{1,6}(?:\s|$)/.test(text)) return "section";
  if (/^=(?:\s|$)/.test(text)) return "synopsis";
  if (/^>.*<$/.test(text)) return "centered";
  if (text.startsWith("~")) return "lyrics";
  if (isSceneHeadingLine(text)) return "scene-heading";
  if (isTransitionLine(text, context)) return "transition";
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

function isTransitionLine(
  text: string,
  context: { previousLineText?: string; nextLineText?: string } = {},
): boolean {
  if (text.startsWith(">") && !text.endsWith("<")) return true;
  const hasTransitionShape = text === text.toUpperCase() && (TRANSITION_RE.test(text) || /TO:$/.test(text));
  if (!hasTransitionShape) return false;

  const previousIsBlank = context.previousLineText == null || context.previousLineText.trim() === "";
  const nextIsBlank = context.nextLineText == null || context.nextLineText.trim() === "";
  return previousIsBlank && nextIsBlank;
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
  const escaped = isEscapedLine(raw);
  const text = escaped ? raw.trim().slice(1) : raw.trim();

  switch (type) {
    case "scene-heading":
      return extractSceneNumber(stripSceneHeadingForce(text).trim()).text;
    case "action":
      if (escaped) return text;
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
    case "boneyard":
      return text.replace(/\/\*/g, "").replace(/\*\//g, "").trim();
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

function stripSceneHeadingForce(text: string): string {
  return text.startsWith(".") ? text.slice(1) : text;
}

function isEscapedLine(raw: string): boolean {
  return ESCAPED_LINE_RE.test(raw.trimStart());
}

function extractSceneNumber(text: string): { text: string; sceneNumber?: string } {
  const match = text.match(SCENE_NUMBER_RE);
  if (!match) return { text };

  return {
    text: text.slice(0, match.index).trimEnd(),
    sceneNumber: match[1],
  };
}

function getSectionLevel(raw: string): number {
  return raw.trim().match(/^#+/)?.[0].length ?? 1;
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
  text = text.replace(/^\/\*/, "").replace(/\*\/$/, "");
  text = text.replace(/^#{1,6}\s*/, "");
  text = text.replace(/^=\s*/, "");
  text = text.replace(/^~\s*/, "");
  text = text.replace(/^>\s*/, "").replace(/\s*<$/, "");
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

function toggleCentered(raw: string): string {
  const text = raw.trim();
  if (/^>.*<$/.test(text)) return text.replace(/^>\s*/, "").replace(/\s*<$/, "");
  return `> ${cleanLine(raw) || "Centered"} <`;
}

function toggleLyrics(raw: string): string {
  const text = raw.trim();
  if (text.startsWith("~")) return text.replace(/^~\s*/, "");
  return `~${cleanLine(raw) || "Lyric"}`;
}

function toggleSceneNumber(raw: string): string {
  const text = raw.trimEnd();
  const scene = extractSceneNumber(text);
  if (scene.sceneNumber) return scene.text;
  return `${text} #1#`;
}

function toggleBoneyard(text: string, selection: TextSelection): [string, TextSelection] {
  const expanded = expandSelectionToLines(text, selection);
  const selected = text.slice(expanded.from, expanded.to);
  const trimmed = selected.trim();

  if (trimmed.startsWith("/*") && trimmed.endsWith("*/")) {
    const uncommented = selected
      .replace(/^\s*\/\*\s*\n?/, "")
      .replace(/\n?\s*\*\/\s*$/, "");
    const nextText = `${text.slice(0, expanded.from)}${uncommented}${text.slice(expanded.to)}`;
    const nextPosition = expanded.from + uncommented.length;
    return [nextText, { from: nextPosition, to: nextPosition }];
  }

  const suffix = selected.endsWith("\n") ? "*/" : "\n*/";
  const commented = `/*\n${selected}${suffix}`;
  const nextText = `${text.slice(0, expanded.from)}${commented}${text.slice(expanded.to)}`;
  const nextPosition = expanded.from + commented.length;
  return [nextText, { from: nextPosition, to: nextPosition }];
}

function expandSelectionToLines(text: string, selection: TextSelection): TextSelection {
  const fromRange = getLineRange(text, selection.from);
  const toRange = getLineRange(text, selection.to);
  return { from: fromRange.start, to: toRange.end };
}

function toggleInlineMarkup(text: string, selection: TextSelection, marker: "*" | "**" | "_"): [string, TextSelection] {
  if (selection.from === selection.to) {
    const insertion = `${marker}${marker}`;
    const nextText = `${text.slice(0, selection.from)}${insertion}${text.slice(selection.to)}`;
    const nextPosition = selection.from + marker.length;
    return [nextText, { from: nextPosition, to: nextPosition }];
  }

  const selected = text.slice(selection.from, selection.to);
  const before = text.slice(selection.from - marker.length, selection.from);
  const after = text.slice(selection.to, selection.to + marker.length);

  if (before === marker && after === marker) {
    const nextText = `${text.slice(0, selection.from - marker.length)}${selected}${text.slice(selection.to + marker.length)}`;
    return [
      nextText,
      {
        from: selection.from - marker.length,
        to: selection.to - marker.length,
      },
    ];
  }

  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
    const unwrapped = selected.slice(marker.length, selected.length - marker.length);
    const nextText = `${text.slice(0, selection.from)}${unwrapped}${text.slice(selection.to)}`;
    return [nextText, { from: selection.from, to: selection.from + unwrapped.length }];
  }

  const wrapped = `${marker}${selected}${marker}`;
  const nextText = `${text.slice(0, selection.from)}${wrapped}${text.slice(selection.to)}`;
  return [
    nextText,
    {
      from: selection.from + marker.length,
      to: selection.to + marker.length,
    },
  ];
}
