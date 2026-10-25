// Expected deck layout from an Opentrons protocol analysis (the JSON the
// Opentrons App writes after analyzing a protocol). Only the initial setup is
// read: loadLabware / loadModule commands, not later move_labware steps.

export type ExpectedLabware = {
  id: string;
  loadName: string;
  displayName: string;
  category: string;
  slot: string;
  /** Labware this one sits on (adapter or stacking), if any. */
  onLabware?: string;
  /** Module this one sits on, if any. */
  onModule?: string;
  /** Outer size in millimeters. */
  size: { x: number; y: number; z: number };
  /** Bottom-left-front corner relative to the slot's corner, in millimeters. */
  cornerOffset: { x: number; y: number; z: number };
};

export type ExpectedModule = { id: string; model: string; slot: string };

/** Deck fixtures a protocol uses without loading them as labware (trash bin, waste chute). */
export type ExpectedFixture = { kind: "trashBin" | "wasteChute"; slot: string };

export type ExpectedDeck = {
  protocolName: string;
  robotType: string;
  ok: boolean;
  labware: ExpectedLabware[];
  modules: ExpectedModule[];
  fixtures: ExpectedFixture[];
  warnings: string[];
};

type Json = Record<string, any>;

// Flex deck: 164 mm column pitch, 107 mm row pitch, slot footprint 127.76 x 85.48 mm.
// Slot centers match the opentrons_flex URDF slot joints (meters, URDF frame).
export const FLEX_SLOT = { pitchX: 0.164, pitchY: 0.107, width: 0.12776, depth: 0.08548, deckZ: 0.169 };
const FLEX_COLUMN_1_X = -0.177;
const FLEX_ROW_D_Y = -0.206;

/** Center of a Flex deck slot (A1–D3, plus staging column A4–D4) in the Flex URDF frame, meters. */
export function flexSlotCenter(slot: string): [number, number, number] | null {
  const match = /^([A-D])([1-4])$/.exec(slot);
  if (!match) return null;
  const row = "DCBA".indexOf(match[1]);
  const column = Number(match[2]) - 1;
  return [FLEX_COLUMN_1_X + column * FLEX_SLOT.pitchX, FLEX_ROW_D_Y + row * FLEX_SLOT.pitchY, FLEX_SLOT.deckZ];
}

const vec = (value: Json | undefined) => ({ x: Number(value?.x) || 0, y: Number(value?.y) || 0, z: Number(value?.z) || 0 });

export function parseAnalysis(raw: unknown): ExpectedDeck {
  if (!raw || typeof raw !== "object") throw new Error("Not an Opentrons analysis file.");
  const analysis = raw as Json;
  if (!Array.isArray(analysis.commands)) throw new Error("Not an Opentrons analysis file (no commands).");
  const warnings: string[] = [];
  const robotType = String(analysis.robotType ?? "unknown");
  if (robotType !== "OT-3 Standard") warnings.push(`Robot type "${robotType}" is not a Flex; slot positions assume a Flex deck.`);
  const ok = analysis.result === "ok" && !(analysis.errors?.length);
  if (!ok) warnings.push("The Opentrons App reported errors for this analysis; the layout may be incomplete.");

  const modules: ExpectedModule[] = [];
  const fixtures: ExpectedFixture[] = [];
  const addFixture = (fixture: ExpectedFixture) => { if (!fixtures.some(f => f.slot === fixture.slot)) fixtures.push(fixture); };
  const labware: ExpectedLabware[] = [];
  const slotOf = new Map<string, string>();

  for (const command of analysis.commands as Json[]) {
    // Trash bins and the waste chute only show up as addressable areas, e.g. "movableTrashA3".
    const area = String(command.params?.addressableAreaName ?? "");
    const trash = /^movableTrash([A-D][1-3])$/.exec(area);
    if (trash) addFixture({ kind: "trashBin", slot: trash[1] });
    else if (/WasteChute/i.test(area)) addFixture({ kind: "wasteChute", slot: "D3" });
    if (command.commandType === "loadModule") {
      const id = command.result?.moduleId, slot = command.params?.location?.slotName;
      if (!id || !slot) continue;
      modules.push({ id, model: String(command.params?.model ?? command.result?.model ?? "module"), slot });
      slotOf.set(id, slot);
    }
    if (command.commandType !== "loadLabware") continue;
    const id = command.result?.labwareId, definition = command.result?.definition, location = command.params?.location;
    if (!id || !definition) continue;
    const name = definition.metadata?.displayName ?? command.params?.loadName ?? "Labware";
    let slot: string | undefined, onLabware: string | undefined, onModule: string | undefined;
    if (location === "offDeck" || location === "systemLocation") {
      warnings.push(`${name} starts off-deck and is not shown.`);
      continue;
    } else if (location?.slotName) slot = location.slotName;
    else if (location?.addressableAreaName) slot = location.addressableAreaName;
    else if (location?.moduleId) { onModule = location.moduleId; slot = slotOf.get(location.moduleId); }
    else if (location?.labwareId) { onLabware = location.labwareId; slot = slotOf.get(location.labwareId); }
    if (!slot || !flexSlotCenter(slot)) {
      warnings.push(`${name}: location ${JSON.stringify(location)} is not a deck slot this viewer knows.`);
      continue;
    }
    if (onModule) warnings.push(`${name} sits on a module in ${slot}; module height is not modeled yet.`);
    slotOf.set(id, slot);
    const dims = definition.dimensions ?? {};
    labware.push({
      id, slot, onLabware, onModule,
      loadName: String(command.params?.loadName ?? definition.parameters?.loadName ?? ""),
      displayName: String(name),
      category: String(definition.metadata?.displayCategory ?? "other"),
      size: { x: Number(dims.xDimension) || 127.76, y: Number(dims.yDimension) || 85.48, z: Number(dims.zDimension) || 10 },
      cornerOffset: vec(definition.cornerOffsetFromSlot),
    });
  }
  return { protocolName: String(analysis.metadata?.protocolName ?? "Untitled protocol"), robotType, ok, labware, modules, fixtures, warnings };
}

/**
 * Box for one labware in the Flex URDF frame (meters): center and size.
 * Stacked labware starts on top of the labware below it.
 */
export function labwareBox(item: ExpectedLabware, deck: ExpectedDeck): { center: [number, number, number]; size: [number, number, number] } | null {
  const slot = flexSlotCenter(item.slot);
  if (!slot) return null;
  let base = 0;
  for (let below = item.onLabware; below; ) {
    const parent = deck.labware.find(l => l.id === below);
    if (!parent) break;
    base += parent.size.z / 1000;
    below = parent.onLabware;
  }
  const size: [number, number, number] = [item.size.x / 1000, item.size.y / 1000, item.size.z / 1000];
  const left = slot[0] - FLEX_SLOT.width / 2 + item.cornerOffset.x / 1000;
  const front = slot[1] - FLEX_SLOT.depth / 2 + item.cornerOffset.y / 1000;
  const bottom = slot[2] + base + item.cornerOffset.z / 1000;
  return { center: [left + size[0] / 2, front + size[1] / 2, bottom + size[2] / 2], size };
}
