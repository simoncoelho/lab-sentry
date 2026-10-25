import { describe, expect, it } from "vitest";
import { classifierIssues, createClassifier, createLabwareClassifier } from "./classifier";
import { createWorkspace } from "./state";
import { matchesSaved, parseWorkspace, snapshot } from "./workspace-file";

const view = { acrylicVisible: true, grid: false };
describe("classifier design", () => {
  it("allows saving an incomplete draft without making it ready for generation", () => {
    const draft = createClassifier();
    expect(classifierIssues(draft).length).toBeGreaterThan(0);
    const saved = snapshot("Lab", createWorkspace(), view, draft);
    expect(parseWorkspace(JSON.stringify(saved)).classifier).toEqual(draft);
  });
  it("provides an editable, valid occupancy starter with unique stable labels", () => {
    const design = createLabwareClassifier();
    expect(classifierIssues(design)).toEqual([]);
    expect(design.unit).toBe("deck_slot");
    expect(design.slots).toHaveLength(12);
    expect(new Set(design.classes.map(c => c.id)).size).toBe(design.classes.length);
    expect(design.classes.some(c => c.name === "Empty slot")).toBe(true);
  });
  it("blocks duplicate labels, missing slots and invalid sampling plans", () => {
    const design = createLabwareClassifier();
    design.classes[1].name = ` ${design.classes[0].name.toUpperCase()} `;
    design.slots = []; design.examplesPerClass = 0; design.testPercent = 80;
    expect(classifierIssues(design)).toHaveLength(4);
  });
  it("round-trips the design, detects edits, and keeps saved drafts independent", () => {
    const workspace = createWorkspace(), design = createLabwareClassifier();
    const saved = snapshot("Lab", workspace, view, design);
    expect(matchesSaved(saved, "Lab", workspace, view, design)).toBe(true);
    design.classes[0].description = "Updated rule";
    expect(matchesSaved(saved, "Lab", workspace, view, design)).toBe(false);
    expect(saved.classifier?.classes[0].description).not.toBe("Updated rule");
    expect(parseWorkspace(JSON.stringify(saved))).toEqual(saved);
  });
  it("keeps older workspaces valid and rejects corrupt classifier definitions", () => {
    const old = snapshot("Lab", createWorkspace(), view);
    expect(parseWorkspace(JSON.stringify(old)).classifier).toBeUndefined();
    for (const classifier of [null, {}, { ...createClassifier(), classes: [null] }, { ...createClassifier(), slots: ["Z99"] }]) {
      expect(() => parseWorkspace(JSON.stringify({ ...old, classifier }))).toThrow("classifier");
    }
  });
});
