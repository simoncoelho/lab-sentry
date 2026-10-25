export type ClassDefinition = { id: string; name: string; description: string; exclude: string; color: string };
export type ClassifierDesign = {
  name: string; objective: string; unit: "frame" | "deck_slot"; mode: "single" | "multiple";
  classes: ClassDefinition[]; slots: string[];
  examplesPerClass: number; validationPercent: number; testPercent: number;
  variations: string[];
};
export const deckSlots = ["A", "B", "C", "D"].flatMap(row => [1, 2, 3].map(col => `${row}${col}`));
export const variationOptions = ["Lighting", "Camera angle", "Object position", "Occlusion", "Background"];
const palette = ["#90baff", "#76d4ba", "#edc77d", "#c6a3ed", "#ee9caa", "#83cbdc"];
export function newClass(index: number): ClassDefinition {
  return { id: crypto.randomUUID(), name: "", description: "", exclude: "", color: palette[index % palette.length] };
}
export function createClassifier(): ClassifierDesign {
  return { name: "Instrument classifier", objective: "", unit: "frame", mode: "single", classes: [], slots: [...deckSlots], examplesPerClass: 250, validationPercent: 15, testPercent: 15, variations: ["Lighting", "Object position", "Occlusion"] };
}
export function createLabwareClassifier(): ClassifierDesign {
  return {
    ...createClassifier(), name: "Labware & deck occupancy", unit: "deck_slot",
    objective: "Identify the labware occupying each visible Flex deck slot, including empty slots.",
    classes: [
      ["Empty slot", "The slot footprint is visible and contains no labware.", "Occluded slots, clear labware, and fixtures hiding the footprint."],
      ["Tip rack", "A pipette tip rack occupies the slot, with or without tips.", "Tube racks and microplates; tip count is not part of this class."],
      ["Microplate", "A well plate occupies the slot, including PCR or deep-well plates.", "Tip racks, reservoirs and ambiguous stacked labware."],
      ["Reservoir", "A reagent reservoir occupies the slot.", "Microplates, waste containers and empty slots."],
      ["Tube rack", "A rack for individual tubes occupies the slot.", "Pipette tip racks and well plates."],
      ["Other labware", "Clearly visible labware occupies the slot but does not fit another defined class.", "Unclear images, blocked views or hardware modules. Send those to review."],
    ].map(([name, description, exclude], i) => ({ ...newClass(i), name, description, exclude })),
  };
}
export function classifierIssues(design: ClassifierDesign): string[] {
  const issues: string[] = [];
  if (!design.name.trim()) issues.push("Name the classifier.");
  if (!design.objective.trim()) issues.push("Describe what it should identify.");
  if (design.classes.length < 2) issues.push("Define at least two classes.");
  if (design.classes.some(c => !c.name.trim() || !c.description.trim())) issues.push("Give each class a name and labeling rule.");
  const names = design.classes.map(c => c.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) issues.push("Use distinct class names.");
  if (design.unit === "deck_slot" && !design.slots.length) issues.push("Select at least one deck slot.");
  if (!Number.isInteger(design.examplesPerClass) || design.examplesPerClass < 1 || design.examplesPerClass > 100000) issues.push("Set 1–100,000 examples per class.");
  if (![design.validationPercent, design.testPercent].every(v => Number.isInteger(v) && v >= 1 && v <= 40) || design.validationPercent + design.testPercent >= 100) issues.push("Use valid validation and test splits (1–40% each).");
  return issues;
}

// Structural validation permits incomplete drafts while rejecting malformed imports.
export function isClassifierDesign(value: unknown): value is ClassifierDesign {
  if (!value || typeof value !== "object") return false;
  const d = value as ClassifierDesign;
  return typeof d.name === "string" && typeof d.objective === "string" && ["frame", "deck_slot"].includes(d.unit) && ["single", "multiple"].includes(d.mode)
    && Array.isArray(d.classes) && d.classes.length <= 100 && d.classes.every(c => c && [c.id, c.name, c.description, c.exclude].every(v => typeof v === "string") && !!c.id && /^#[0-9a-f]{6}$/i.test(c.color))
    && new Set(d.classes.map(c => c.id)).size === d.classes.length
    && Array.isArray(d.slots) && d.slots.every(s => deckSlots.includes(s)) && new Set(d.slots).size === d.slots.length
    && [d.examplesPerClass, d.validationPercent, d.testPercent].every(v => typeof v === "number" && Number.isFinite(v))
    && Array.isArray(d.variations) && d.variations.every(v => variationOptions.includes(v));
}
