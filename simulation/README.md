# Isaac Sim renderer

Experimental backend for the existing Lab Sentry dataset workflow. The browser
remains the scene editor and computes the existing geometry-based labels. A
separate Isaac process renders RGB from the same frozen scene and camera.
The detection REST API and CPU inference installation are unchanged.

## Start

Install NVIDIA Isaac Sim separately. This integration targets the local 5.1
distribution. It uses Isaac's bundled Python, never the inference environment.
Explicitly setting `ISAAC_SIM_PATH` selects another installation.

On Windows, run `Start-Isaac.cmd` from the repository root. It uses
`C:\isaacsim\python.bat` by default. For another installation:

```bat
set ISAAC_SIM_PATH=D:\Applications\isaacsim
Start-Isaac.cmd
```

Wait for `Isaac ready at http://127.0.0.1:5103`. Start the normal app with
`Start.cmd`. In Generate dataset, expand Generation settings:

- **Preview Isaac** renders the selected recipe (or an empty deck) without
  adding images to the dataset or invoking the copilot.
- For a new run, select **Isaac Sim - experimental**, then Generate.
- Images arrive in the existing preview and gallery. Camera effects and YOLO
  export work as before. Each run records its renderer; existing runs cannot
  switch renderers midway.

The worker binds only to loopback and the app proxies `/isaac-api`. It must not
be exposed as the public detection API. The initial renderer is synchronous,
one frame at a time, with a 128 MB scene limit and a 180 second client timeout.

## Validate

```bat
Start-Isaac.cmd --smoke .runtime\isaac-smoke.png
python -m unittest discover -s simulation -p "test_*.py"
npm test --prefix device-designer -- isaac-renderer.test.ts
```

The smoke render must produce a blue triangle at 1280 x 720. A process exiting
successfully is not sufficient: some native Isaac crashes return exit code 0.
Direct3D 12 with a single GPU is the default on Windows. This passed the smoke
render on an RTX 5080 Laptop with driver 610.62, where Vulkan crashed in
`rtx.scenedb`. First startup needed about a minute. Try `--graphics vulkan`
when appropriate for your driver. RTX startup errors must be resolved before
generating data.

## Transfer contract and current limits

`isaac-renderer.ts` exports visible triangle meshes, instance transforms,
normals, base-color PNG textures, material groups, a world-space camera matrix,
and scene lights. Units are meters, Y is up, cameras face -Z. Matrix arrays are
Three column-major, equivalent to USD row-vector matrix rows. Mesh vertices
remain local to their exported world transform.

Materials currently use USD Preview Surface. Hemisphere lights become dome
lights, and directional lights become distant lights. Light intensity mapping
is an initial approximation, not physical calibration. Browser environment
reflections are not yet reproduced. Glass uses opacity/IOR; physically accurate
plastic transmission and thickness still need MDL material authoring. Unsupported
normal/roughness/metalness/alpha maps and skinned meshes fail explicitly.

Labels retain the existing browser policy: solid labware silhouettes, acrylic
ignored for occlusion, all twelve observed slot states, and uncertain frames
held for review. These are not Replicator-generated ground-truth masks yet.
Refraction does not alter those label silhouettes. Verify alignment on rendered
images before using this backend for training.

The worker currently reconstructs the USD scene per request. Persistent asset
caching, material calibration, and native Replicator annotations are follow-up
work; no generation throughput or model-accuracy improvement is claimed yet.
The first Flex check transferred 1,647 meshes / 107,797 triangles. Two successful
renders took 12.70 and 11.86 seconds on the RTX 5080 Laptop, excluding browser
scene export and effects. This is a correctness baseline, not the fast-batch target.

For a fair comparison, replay identical recipes and camera settings in both
renderers, keep entire related runs in the same data split, and evaluate trained
models on separately labeled real images. Do not train on comparison test images.

References: [Isaac installation](https://docs.isaacsim.omniverse.nvidia.com/5.1.0/installation/index.html),
[Replicator](https://docs.omniverse.nvidia.com/extensions/latest/ext_replicator.html).
