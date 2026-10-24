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
- **Move** frames the selected device and opens Placement with scene drag handles. Drag the red X, green Y, or blue Z arrow, or a square plane handle, to reposition it. Numeric fields track the drag; joint positions and yaw are preserved. Switch to Joints or click Move again to hide the handles. Movement follows the same ±3000 mm horizontal and 0–3000 mm elevation limits as numeric entry.
- **Rotate** exposes local-axis rotation rings around the device's URDF origin. Use the rings or enter roll (X), pitch (Y), and yaw (Z) in degrees. This rotates the whole instrument independently of its joints, preserving position. Orientation uses URDF roll/pitch/yaw conventions (`Rz × Ry × Rx`); ring drags may display an equivalent Euler-angle representation near ±90° pitch. Move handles continue to follow workspace axes after rotation.
- Drag to orbit, right-drag to pan, scroll/pinch to zoom. **F** focuses the selected model; **A** fits visible models. Focus is useful for the much smaller Tiny 2.
- Hide individual models, isolate the selected model, toggle the 100 mm grid, or choose perspective/front/top views.
- **Remove … from workspace** removes the selected device from the scene and its active instrument list. Use **Add to workspace** to restore it with its pose preserved. Removing the last device leaves an empty workspace; source URDFs and meshes are never deleted.
- Reset restores only the selected instrument's placement and joints. Switching instruments preserves all other poses. Poses are session-only and reset on reload.

`npm test` checks isolation, reset behavior, limits, and unit conversions. Models are loaded from the existing asset directories without modifying their URDFs. STL materials come from URDF definitions; Flex OBJ materials come from its MTL file. A model is marked ready only after all its visual meshes have loaded.

This is a kinematic scene viewer, with no hardware connection, collision detection, or dynamics simulation. Tiny 2 is a drawing-derived reconstruction with estimated internals; the imported OT-2 source supplied no license.

Flex now uses the supplied `flex-model.glb` STEP-derived assembly (SHA-256 `b3280f704c6f28663ba9252d310747a512ca6a8e8504e33dd16676b0b15078fe`), replacing the ChemLab meshes. Source authorship and reuse license were not supplied. Its original scale is preserved: approximately 873 × 691 × 840 mm. Geometry is converted to portable OBJ/MTL in meters and separated into chassis, windows, gantry, carriage, and the two folding door panels. The window omitted from the source is mirrored from its opposite side. Eight working deck inserts and the 1000 µL eight-channel pipette exterior are reconstructed using the reference photographs; the working slot pitch follows Opentrons' 164 × 107 mm deck definition. The latest details follow user-supplied Photo 1–7 (2026-10-24), particularly the overhead deck in Photo 6, nozzle close-up in Photo 2, and gripper in Photos 3–5. Earlier photos remain under `models/opentrons_flex/reference_photos`.

Flex has three gantry/pipette translation controls, an independent **Gripper Z**, plus **Door lift** and **Door fold**. The optional staging pads in the source CAD are omitted to match the photographed machine. The gripper fingers are fixed at their photographed spacing. The simulated Z control moves the pipette downward. Hinge positions, travel limits, reconstructed pipette/gripper dimensions and collision boxes are estimates; no calibrated mechanical tolerances or inertial properties are claimed. The supplied CAD tessellation is retained, including its simplified details. See the URDF comment for provenance and the official deck-definition link.

Tiny 2's October 2026 refinement follows OBSBOT's official appearance and specifications: darker housing/lens materials, a beveled optical barrel, curved lens surface, and concentric lens-surround detail. The viewer applies separate finish hints and crease-preserving normals. Its five conservative convex collision meshes contain 5,684 triangles (previously 325,612); all 31 STL meshes were checked for watertightness and consistent winding, and visual-vertex collision coverage was verified. The model retains its 95.6 g mass, joint frames, and controllable limits. These remain approximate exterior and collision models, not manufacturer CAD or calibrated inertial data.

### Mounting Tiny 2 on a Flex surface

Select Flex or Tiny 2 and choose **Mount Tiny 2 on Flex**. Hover over the Flex to see a base-size target ring, then click a surface. The camera moves to the hit point and rotates so its underside is flush with that face; its pan/tilt settings are preserved. Drag to orbit while choosing a spot, or press Escape / Cancel to exit without moving it. Both models must be present and loaded; hidden models are shown when mounting starts.

This places an independent camera pose, not a persistent attachment: subsequent Flex motion does not carry the camera along. The alignment uses the local face plane; it does not check the full base footprint for edge overhang or surrounding collisions.

## Workspace phases

1. **Workspace setup**: name the setup, arrange instruments, adjust joints, and mount the camera. **Save workspace** writes a versioned snapshot to browser local storage. **Save & continue** saves successfully before entering calibration. Unsaved edits disable the direct calibration tab. At least one loaded instrument is required to save, and Tiny 2 must be present to continue.
2. **Camera calibration**: review the saved setup with placement and joint controls locked. Add a PNG/JPEG/WebP reference image (up to 20 MB) for the next stage. Reference images stay in memory for this session; no live camera connection or calibration solver is implemented yet. Editing and re-saving a changed setup clears its previous reference image.

Reload restores the last explicitly saved setup, including camera pose, joint positions, device presence/visibility, grid, and acrylic visibility. Export/Open file provides portable `.workspace.json` snapshots. Browser saves are local to this origin and browser profile; a storage error leaves the current setup editable and does not advance the phase. The saved format is version 1 and uses the existing meter/degree pose conventions (joint values remain native URDF radians/meters).
