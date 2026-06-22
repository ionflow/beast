import { describe, expect, it } from "vitest";
import { applyCommand, classifyBlock, parseFountain } from "./index";

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
});
