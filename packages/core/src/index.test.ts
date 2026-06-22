import { describe, expect, it } from "vitest";
import { applyCommand, classifyBlock, findInlineFormattingRanges, parseFountain, parseInlineFormatting } from "./index";

describe("parseFountain", () => {
  it("classifies common screenplay blocks", () => {
    const doc = parseFountain(`Title: The Example
Author: Beast

INT. DINER - NIGHT

Sarah watches the door.

SARAH
(quietly)
We should leave.

JAMES^
Not yet.

> CUT TO:

# Act One
= A short synopsis
[[check this beat]]
===
`);

    expect(doc.titlePage.title).toEqual(["The Example"]);
    expect(doc.scenes).toHaveLength(1);
    expect(doc.scenes[0]?.title).toBe("INT. DINER - NIGHT");
    expect(doc.blocks.map((block) => block.type)).toContain("scene-heading");
    expect(doc.blocks.map((block) => block.type)).toContain("parenthetical");
    expect(doc.blocks.map((block) => block.type)).toContain("dialogue");
    expect(doc.blocks.map((block) => block.type)).toContain("transition");
    expect(doc.blocks.map((block) => block.type)).toContain("section");
    expect(doc.blocks.map((block) => block.type)).toContain("synopsis");
    expect(doc.blocks.map((block) => block.type)).toContain("note");
    expect(doc.blocks.map((block) => block.type)).toContain("page-break");
    expect(doc.blocks.find((block) => block.rawText === "JAMES^")?.dual).toBe(true);
  });

  it("supports forced Fountain elements", () => {
    const doc = parseFountain(`.the room
!INT. is just text
@Narrator
This cue keeps mixed case.
> Smash cut to:
`);

    expect(doc.blocks[0]?.type).toBe("scene-heading");
    expect(doc.blocks[0]?.text).toBe("the room");
    expect(doc.blocks[1]?.type).toBe("action");
    expect(doc.blocks[2]?.type).toBe("character");
    expect(doc.blocks[4]?.type).toBe("transition");
  });

  it("supports scene numbers, sections, arbitrary title keys, and omitted boneyard text", () => {
    const doc = parseFountain(`Title: Numbered
Revision: Blue

# Act One
## Sequence A

INT./EXT. CAR - NIGHT #A-1#

Visible action.

/*
EXT. OMITTED - DAY
This does not print.
*/

\\INT. THIS IS ACTION
`);

    expect(doc.titlePage.revision).toEqual(["Blue"]);
    expect(doc.outline.map((node) => node.type)).toEqual(["section", "section", "scene"]);
    expect(doc.outline[1]?.level).toBe(2);
    expect(doc.scenes[0]?.title).toBe("INT./EXT. CAR - NIGHT");
    expect(doc.scenes[0]?.sceneNumber).toBe("A-1");
    expect(doc.blocks.find((block) => block.rawText === "EXT. OMITTED - DAY")?.type).toBe("boneyard");
    expect(doc.blocks.find((block) => block.rawText === "\\INT. THIS IS ACTION")?.type).toBe("action");
    expect(doc.blocks.find((block) => block.rawText === "\\INT. THIS IS ACTION")?.text).toBe("INT. THIS IS ACTION");
  });

  it("supports centered text, lyrics, and inline notes without printing notes", () => {
    const doc = parseFountain(`> THE END <
~Amazing grace
Action with **bold**, *italic*, _underlined_, and [[private note]].
`);

    expect(doc.blocks[0]?.type).toBe("centered");
    expect(doc.blocks[0]?.text).toBe("THE END");
    expect(doc.blocks[1]?.type).toBe("lyrics");
    expect(doc.blocks[1]?.text).toBe("Amazing grace");
    expect(doc.blocks[2]?.text).toBe("Action with bold, italic, underlined, and .");
    expect(doc.blocks[2]?.inline.some((span) => span.styles.includes("note"))).toBe(true);
  });
});

describe("classifyBlock", () => {
  it("uses neighboring lines for ambiguous uppercase character cues", () => {
    const lines = ["", "MARA", "Hello.", ""];
    expect(classifyBlock(lines, 1)).toBe("character");
    expect(classifyBlock(lines, 2)).toBe("dialogue");
  });
});

describe("applyCommand", () => {
  it("forces character names to uppercase and preserves cursor", () => {
    const result = applyCommand("sarah", { from: 5, to: 5 }, "force-character");

    expect(result.text).toBe("@SARAH");
    expect(result.selection.from).toBe(6);
    expect(result.document.blocks[0]?.type).toBe("character");
  });

  it("creates valid dialogue context when forcing dialogue from action", () => {
    const result = applyCommand("We should leave.", { from: 3, to: 3 }, "force-dialogue");

    expect(result.text).toBe("CHARACTER\nWe should leave.");
    expect(result.document.blocks[0]?.type).toBe("character");
    expect(result.document.blocks[1]?.type).toBe("dialogue");
  });

  it("toggles notes without touching surrounding text", () => {
    const result = applyCommand("one\ntwo\nthree", { from: 5, to: 5 }, "toggle-note");

    expect(result.text).toBe("one\n[[two]]\nthree");
  });

  it("inserts smart screenplay line breaks", () => {
    const result = applyCommand("SARAH\nHello.", { from: 12, to: 12 }, "smart-enter");

    expect(result.text).toBe("SARAH\nHello.\n\n");
  });

  it("toggles Fountain-specific line commands", () => {
    expect(applyCommand("The End", { from: 0, to: 7 }, "toggle-centered").text).toBe("> The End <");
    expect(applyCommand("Amazing grace", { from: 0, to: 13 }, "toggle-lyrics").text).toBe("~Amazing grace");
    expect(applyCommand("INT. ROOM - DAY", { from: 0, to: 15 }, "toggle-scene-number").text).toBe("INT. ROOM - DAY #1#");
  });

  it("toggles inline emphasis around selections", () => {
    const bold = applyCommand("Make this bold", { from: 10, to: 14 }, "toggle-bold");
    expect(bold.text).toBe("Make this **bold**");
    expect(bold.selection).toEqual({ from: 12, to: 16 });

    const italic = applyCommand("word", { from: 0, to: 4 }, "toggle-italic");
    expect(italic.text).toBe("*word*");
  });

  it("wraps selected lines in boneyard omission markers", () => {
    const result = applyCommand("one\ntwo\nthree", { from: 4, to: 7 }, "toggle-boneyard");

    expect(result.text).toBe("one\n/*\ntwo\n*/\nthree");
    expect(result.document.blocks.find((block) => block.rawText === "two")?.type).toBe("boneyard");
  });
});

describe("inline Fountain markup", () => {
  it("parses bold, italic, underline, notes, and escaped markers", () => {
    expect(parseInlineFormatting("**bold** *italic* _under_ [[note]] \\*literal\\*")).toEqual([
      { text: "bold", styles: ["bold"] },
      { text: " ", styles: [] },
      { text: "italic", styles: ["italic"] },
      { text: " ", styles: [] },
      { text: "under", styles: ["underline"] },
      { text: " ", styles: [] },
      { text: "note", styles: ["note"] },
      { text: " *literal*", styles: [] },
    ]);
  });

  it("returns ranges for editor decoration", () => {
    expect(findInlineFormattingRanges("A **bold** move")).toEqual([{ from: 4, to: 8, styles: ["bold"] }]);
  });
});
