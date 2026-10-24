# Instrument workspace

A local React / Three.js viewer for the OBSBOT Tiny 2, Opentrons Flex, and OT-2 URDFs in `models/`. The interface follows Tinybench Workbench's dark panels, compact controls, and monospace labeling.

## Run

Requires Node.js 22.12+ (tested with Node 24).

```powershell
cd device-designer
npm ci
npm run dev
```

Open the local URL printed by Vite. `npm run build` type-checks and produces `dist/`, including the original URDFs and meshes. `npm run preview` serves that production build. Deploy the entire `dist/` directory to a static HTTP host; opening the HTML with `file://` is unsupported.

## Controls

- Select an instrument from its card, scene label, or geometry. Only the selected instrument's inspector is shown.
- Joint sliders and numeric inputs use the model's actual limits. Input values are millimeters or degrees; URDF values remain meters or radians. Numeric entries commit on Enter or blur.
- Placement changes the selected model's world X/Y/Z position and yaw independently. Coordinates are Z-up. The rendering coordinate conversion does not change the model's scale.
- Drag to orbit, right-drag to pan, scroll/pinch to zoom. **F** focuses the selected model; **A** fits visible models. Focus is useful for the much smaller Tiny 2.
- Hide individual models, isolate the selected model, toggle the 100 mm grid, or choose perspective/front/top views.
- **Remove … from workspace** removes the selected device from the scene and its active instrument list. Use **Add to workspace** to restore it with its pose preserved. Removing the last device leaves an empty workspace; source URDFs and meshes are never deleted.
- Reset restores only the selected instrument's placement and joints. Switching instruments preserves all other poses. Poses are session-only and reset on reload.

`npm test` checks isolation, reset behavior, limits, and unit conversions. Models are loaded from the existing asset directories without modifying their URDFs. STL materials come from URDF definitions; Flex OBJ materials come from its MTL file. A model is marked ready only after all its visual meshes have loaded.

This is a kinematic scene viewer, with no hardware connection, collision detection, or dynamics simulation. Flex and OT-2 are community models; Tiny 2 is a drawing-derived reconstruction with estimated internals. Existing source and licensing notices remain in the URDFs and are linked in the inspector. Flex assets carry CC BY-NC 4.0; the imported OT-2 source supplied no license.
