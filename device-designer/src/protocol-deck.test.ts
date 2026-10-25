import { describe, expect, it } from "vitest";
import { flexSlotCenter, labwareBox, parseAnalysis } from "./protocol-deck";

const definition = (name: string, category: string, z: number) => ({
  metadata: { displayName: name, displayCategory: category },
  dimensions: { xDimension: 127.76, yDimension: 85.48, zDimension: z },
  cornerOffsetFromSlot: { x: 0, y: 0, z: 0 },
});
const load = (id: string, loadName: string, location: unknown, def: object) => ({
  commandType: "loadLabware", params: { loadName, location }, result: { labwareId: id, definition: def },
});
const analysis = {
  robotType: "OT-3 Standard", result: "ok", errors: [], metadata: { protocolName: "Serial dilution" },
  commands: [
    { commandType: "loadPipette", params: {}, result: {} },
    load("tips", "opentrons_flex_96_filtertiprack_200ul", { slotName: "C1" }, definition("Tips 200", "tipRack", 99)),
    load("adapter", "opentrons_96_flat_bottom_adapter", { slotName: "D3" }, definition("Adapter", "adapter", 10)),
    load("plate", "nest_96_wellplate_200ul_flat", { labwareId: "adapter" }, definition("Plate", "wellPlate", 14.3)),
    { commandType: "loadModule", params: { model: "temperatureModuleV2", location: { slotName: "B1" } }, result: { moduleId: "temp" } },
    load("block", "opentrons_96_well_aluminum_block", { moduleId: "temp" }, definition("Block", "aluminumBlock", 18)),
    load("spare", "nest_12_reservoir_15ml", "offDeck", definition("Spare", "reservoir", 31)),
  ],
};

describe("protocol deck", () => {
  it("places Flex slots on the URDF deck grid", () => {
    expect(flexSlotCenter("D1")).toEqual([-0.177, -0.206, 0.169]);
    expect(flexSlotCenter("A3")![0]).toBeCloseTo(0.151);
    expect(flexSlotCenter("A3")![1]).toBeCloseTo(0.115);
    expect(flexSlotCenter("E1")).toBeNull();
    expect(flexSlotCenter("trashBinAdapter")).toBeNull();
  });

  it("reads the initial labware layout from an analysis", () => {
    const deck = parseAnalysis(analysis);
    expect(deck.protocolName).toBe("Serial dilution");
    expect(deck.ok).toBe(true);
    expect(deck.labware.map(l => [l.slot, l.loadName])).toEqual([
      ["C1", "opentrons_flex_96_filtertiprack_200ul"],
      ["D3", "opentrons_96_flat_bottom_adapter"],
      ["D3", "nest_96_wellplate_200ul_flat"],
      ["B1", "opentrons_96_well_aluminum_block"],
    ]);
    expect(deck.modules).toEqual([{ id: "temp", model: "temperatureModuleV2", slot: "B1" }]);
    expect(deck.warnings.some(w => w.includes("off-deck"))).toBe(true);
    expect(deck.warnings.some(w => w.includes("module height"))).toBe(true);
  });

  it("builds boxes in meters, stacking labware on adapters", () => {
    const deck = parseAnalysis(analysis);
    const tips = labwareBox(deck.labware[0], deck)!;
    expect(tips.size[2]).toBeCloseTo(0.099);
    expect(tips.center[0]).toBeCloseTo(-0.177);
    expect(tips.center[2]).toBeCloseTo(0.169 + 0.0495);
    const plate = labwareBox(deck.labware[2], deck)!;
    expect(plate.center[2]).toBeCloseTo(0.169 + 0.010 + 0.00715);
  });

  it("flags non-Flex robots and failed analyses", () => {
    const deck = parseAnalysis({ ...analysis, robotType: "OT-2 Standard", result: "not-ok" });
    expect(deck.ok).toBe(false);
    expect(deck.warnings[0]).toContain("not a Flex");
  });

  it("rejects files that are not analyses", () => {
    expect(() => parseAnalysis({ hello: "world" })).toThrow();
  });
});
