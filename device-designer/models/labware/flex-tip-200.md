# Flex 200 µL filter tip

`opentrons-flex-200ul-filter-tip.glb` is a self-contained visual reconstruction in metres, with its outlet at the origin and mouth along +Z. It contains separate polypropylene and filter meshes. The simulation uses the same geometry builder, instanced across the rack for two draw calls.

Source: [Opentrons April 2024 technical drawing, SKU 991-00102](https://insights.opentrons.com/hubfs/Products/Consumables%20and%20Reagents/Tech%20Data%20Sheet_200%20%CE%BCL%20Tips.pdf). Overall length 58.35 mm, collar begins 52.35 mm from outlet, maximum diameter 7.80 mm, outlet outer diameter 0.96 mm. Intermediate profile dimensions are traced estimates. The drawing is for the unfiltered tip; the filter variant and rack appearance use the supplied October 24 photos (particularly Photos 1, 6 and 7).

Wall thickness, outlet bore, twelve collar ribs, filter placement/size and optical properties are estimates, not manufacturing specifications. This is not manufacturer CAD or a fabrication model. Clear polypropylene uses a transmissive physical material; the Isaac USD Preview Surface exporter currently approximates transmission with opacity.

Regenerate from `device-designer`: `node scripts/export-flex-tip.mjs` (Node 24). Geometry source: `src/flex-tip-200.ts`. The 200 µL rack retains manufacturer well centres and overall envelope. Other tip sizes are unchanged.
