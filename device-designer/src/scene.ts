import * as THREE from "three";
import { deckSlots } from "./classifier";
import { inferSlotState, type SlotState } from "./deck-state";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import { opticalViewQuaternion, verticalFov } from "./camera-view";
import { createLabBackdrop, createLabReflections } from "./lab-environment";
import { defaultLighting, type Lighting } from "./lighting-match";
import { captureObjectMasks } from "./dataset-masks";
import { zoomedFov, type Detection, type Annotation, type DatasetAsset, type Recipe } from "./dataset";
import { sceneOrientation, rotatedPose, surfaceMountedPose } from "./orientation";
import {
  clamp,
  instruments,
  jointLabels,
  translatedPose,
  type Pose,
  type InstrumentId,
  type JointSpec,
  type Workspace,
} from "./state";

export type ModelInfo = {
  joints: JointSpec[];
  links: number;
  dimensions: number[];
};
type Events = {
  mounted: (pose: Pose) => void;
  move: (id: InstrumentId, pose: Pose) => void;
  ready: (id: InstrumentId, info: ModelInfo) => void;
  error: (id: InstrumentId, message: string) => void;
  select: (id: InstrumentId) => void;
  progress: (id: InstrumentId, value: number) => void;
};
type Entry = {
  group: THREE.Group;
  robot?: URDFRobot;
  bounds?: THREE.Box3;
  label: HTMLButtonElement;
  footprint?: THREE.LineSegments;
};

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.DirectionalLight || child instanceof THREE.SpotLight) child.shadow.dispose();
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const material of materials) material.dispose();
    }
  });
}

export class InstrumentScene {
  private scene = new THREE.Scene();
  private labBackdrop = createLabBackdrop();
  private reflections: THREE.WebGLRenderTarget;
  private lighting: Lighting = defaultLighting;
  private renderer: THREE.WebGLRenderer;
  private expected?: { renderer: THREE.WebGLRenderer; host: HTMLDivElement; camera: THREE.PerspectiveCamera; horizontalFov: number; aspect: number };
  private camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
  private controls: OrbitControls;
  private transform: TransformControls;
  private moveAnchor = new THREE.Object3D();
  private placementEnabled = false;
  private surfaceMount = false;
  private acrylicVisible = true;
  private mountMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.019, 0.0235, 48),
    new THREE.MeshBasicMaterial({ color: 0x8ec5ff, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  private gizmoPointer = false;
  private entries = new Map<InstrumentId, Entry>();
  private grid: THREE.GridHelper;
  private observer: ResizeObserver;
  private disposed = false;
  private frame = 0;
  private selected: InstrumentId = "flex";
  private workspace?: Workspace;
  private isolated = false;
  private goal?: { position: THREE.Vector3; target: THREE.Vector3 };
  private pointerStart = { x: 0, y: 0 };

  constructor(
    private host: HTMLDivElement,
    private events: Events,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.reflections = createLabReflections(this.renderer);
    this.scene.environment = this.reflections.texture;
    this.scene.environmentIntensity = .9;
    this.labBackdrop.visible = false;
    this.scene.add(this.labBackdrop);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D instrument workspace. Drag to orbit, right-drag to pan, scroll to zoom.",
    );
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    // Broad room and enclosure lighting in the live deck reference produces
    // gentle shading, not a strong sun-like gantry shadow across the plates.
    this.scene.add(new THREE.HemisphereLight(0xf1f0e9, 0x78634b, 1.2));
    const key = new THREE.DirectionalLight(0xfff9ed, .35);
    key.position.set(-1.5, 2.8, 1.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: .1, far: 8 });
    key.shadow.bias = -.0004; key.shadow.normalBias = .0015; key.shadow.radius = 3;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xf0f6f3, .45);
    fill.position.set(1, 1.5, -.4);
    this.scene.add(fill);
    this.grid = new THREE.GridHelper(8, 80, 0x3b4b60, 0x253140);
    this.grid.position.y = -0.002;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.45;
    this.scene.add(this.grid);
    this.mountMarker.visible = false;
    this.mountMarker.renderOrder = 100;
    this.scene.add(this.mountMarker);
    this.renderer.domElement.addEventListener("pointermove", this.onMountHover);
    this.renderer.domElement.addEventListener("pointerleave", this.onMountLeave);
    const axes = new THREE.AxesHelper(0.2);
    axes.rotation.x = -Math.PI / 2;
    axes.position.set(-1.25, 0.001, 0.7);
    this.scene.add(axes);
    this.camera.position.set(2.25, 1.8, 2.9);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.3, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 0.025;
    this.controls.maxDistance = 15;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener("start", () => {
      this.goal = undefined;
    });
    this.moveAnchor.rotation.x = -Math.PI / 2;
    this.scene.add(this.moveAnchor);
    this.transform = new TransformControls(
      this.camera,
      this.renderer.domElement,
    );
    this.transform.setMode("translate");
    this.transform.setSpace("local");
    this.transform.setSize(0.85);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener("dragging-changed", (event) => {
      this.controls.enabled = !event.value;
      if (event.value) this.goal = undefined;
    });
    this.transform.addEventListener("axis-changed", () => {
      this.controls.enabled =
        !this.transform.dragging && this.transform.axis === null;
    });
    this.transform.addEventListener("objectChange", () => {
      if (!this.workspace || !this.transform.dragging) return;
      const state = this.workspace[this.selected];
      if (!state.present || !state.visible) return;
      const pose =
        this.transform.mode === "rotate"
          ? rotatedPose(state.pose, this.moveAnchor.quaternion)
          : translatedPose(state.pose, this.moveAnchor.position);
      this.moveAnchor.position.set(pose.x, pose.z, -pose.y);
      this.events.move(this.selected, pose);
    });
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.onPointerDown,
      true,
    );
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener("dblclick", this.onDoubleClick);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    for (const instrument of instruments) {
      const group = new THREE.Group();
      group.name = instrument.id;
      // URDF: X forward, Y left, Z up. Display: Y up. No rescaling.
      group.rotation.x = -Math.PI / 2;
      this.scene.add(group);
      const label = document.createElement("button");
      label.className = "scene-label";
      label.textContent = instrument.name;
      label.setAttribute("aria-label", `Select ${instrument.name} in scene`);
      label.onclick = () => events.select(instrument.id);
      label.hidden = true;
      host.appendChild(label);
      this.entries.set(instrument.id, { group, label });
      void this.load(instrument.id);
    }
    this.animate();
  }

  private async load(id: InstrumentId) {
    const entry = this.entries.get(id)!;
    const instrument = instruments.find((i) => i.id === id)!;
    const url = new URL(`models/${instrument.path}`, document.baseURI).href;
    let robot: URDFRobot | undefined;
    try {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`URDF request failed (${response.status})`);
      const xml = await response.text();
      if (this.disposed) return;
      const loader = new URDFLoader();
      loader.workingPath = new URL(".", url).href;
      loader.parseCollision = false;
      const pending: Promise<void>[] = [];
      const materials = new Map<string, Promise<MTLLoader.MaterialCreator>>();
      let completed = 0;
      loader.loadMeshCb = (path, manager, material, done) => {
        const promise = (async () => {
          let object: THREE.Object3D;
          if (/\.stl$/i.test(path)) {
            const rawGeometry = await new STLLoader(manager).loadAsync(path);
            // The normal utility hashes positions at 0.01-unit precision.
            // Work in millimeters so a centimeter-scale URDF does not collapse
            // thousands of vertices into the same hash bucket.
            if (id === "tiny2") rawGeometry.scale(1000, 1000, 1000);
            const geometry =
              id === "tiny2"
                ? toCreasedNormals(rawGeometry, Math.PI / 4)
                : rawGeometry;
            if (geometry !== rawGeometry) rawGeometry.dispose();
            if (id === "tiny2") geometry.scale(0.001, 0.001, 0.001);
            const color = (material as THREE.MeshPhongMaterial).color;
            // URDF supplies the colors; these finish hints distinguish the
            // Tiny 2's optical glass, anodized surfaces, and rubber in preview.
            const finishes: Record<
              string,
              THREE.MeshPhysicalMaterialParameters
            > = {
              shell: { metalness: 0.35, roughness: 0.4 },
              metal: { metalness: 0.55, roughness: 0.34 },
              lens_metal: { metalness: 0.65, roughness: 0.3 },
              glass: {
                metalness: 0.05,
                roughness: 0.09,
                clearcoat: 1,
                clearcoatRoughness: 0.06,
              },
              rubber: { metalness: 0, roughness: 0.85 },
              black: { metalness: 0.05, roughness: 0.4 },
            };
            object = new THREE.Mesh(
              geometry,
              new THREE.MeshPhysicalMaterial({
                color,
                roughness: 0.57,
                metalness: 0.15,
                transparent: material.transparent,
                opacity: material.opacity,
                ...(id === "tiny2" ? finishes[material.name] : {}),
              }),
            );
          } else if (/\.obj$/i.test(path)) {
            const mtlPath = new URL(id === "flex" ? "cad_materials.mtl" : "materials.mtl", path).href;
            if (!materials.has(mtlPath))
              materials.set(mtlPath, new MTLLoader(manager).loadAsync(mtlPath));
            const creator = await materials.get(mtlPath)!;
            object = await new OBJLoader(manager)
              .setMaterials(creator)
              .loadAsync(path);
            if (id === "flex") {
              object.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                const finish = (source: THREE.MeshPhongMaterial) => {
                  const glass = source.transparent;
                  return new THREE.MeshPhysicalMaterial({
                    name: source.name,
                    color: /aluminium|deck_surface/.test(source.name) ? new THREE.Color(0xb4b5af) : glass ? source.color.clone().lerp(new THREE.Color(0xffffff), source.name === "clip_blue" ? .08 : .55) : source.color,
                    metalness: /aluminium|deck_surface/.test(source.name) ? .65 : 0,
                    roughness: glass ? .14 : /aluminium|deck_surface/.test(source.name) ? .42 : source.name === "waste_black" ? .28 : .58,
                    envMapIntensity: glass ? 1.1 : 1,
                    clearcoat: glass ? .8 : 0,
                    clearcoatRoughness: .12,
                    transparent: glass,
                    opacity: source.opacity,
                    depthWrite: !glass,
                    side: THREE.DoubleSide,
                  });
                };
                child.material = Array.isArray(child.material)
                  ? child.material.map(finish)
                  : finish(child.material);
                child.castShadow = true;
                child.receiveShadow = true;
                if (Array.isArray(child.material)
                  ? child.material.some((material) => material.transparent)
                  : child.material.transparent) child.castShadow = false;
              });
            }
          } else throw new Error(`Unsupported mesh: ${path.split("/").pop()}`);
          done(object);
          completed++;
          if (!this.disposed)
            this.events.progress(
              id,
              Math.round((completed / pending.length) * 100),
            );
        })();
        pending.push(promise);
      };
      robot = loader.parse(xml);
      // Wait for all resources, including failures, before disposing partial models.
      const results = await Promise.allSettled(pending);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (this.disposed) {
        disposeObject(robot);
        return;
      }
      const joints: JointSpec[] = Object.entries(robot.joints)
        .filter(([, joint]) =>
          ["revolute", "continuous", "prismatic"].includes(joint.jointType),
        )
        .map(([name, joint]) => {
          const lower =
            joint.jointType === "continuous" ? -Math.PI : joint.limit.lower;
          const upper =
            joint.jointType === "continuous" ? Math.PI : joint.limit.upper;
          return {
            name,
            label: jointLabels[name] || name,
            type: joint.jointType,
            lower,
            upper,
            initial: clamp(0, lower, upper),
          };
        });
      for (const joint of joints)
        robot.setJointValue(joint.name, joint.initial);
      entry.robot = robot;
      if (id === "flex") this.setAcrylicVisible(this.acrylicVisible);
      // Bounds in the native robot frame are also used for anchored labels.
      entry.bounds = new THREE.Box3().setFromObject(robot);
      entry.group.add(robot);
      const size = entry.bounds.getSize(new THREE.Vector3());
      const footprintGeometry = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          Math.max(size.x + 0.04, 0.1),
          Math.max(size.y + 0.04, 0.1),
          0.001,
        ),
      );
      const footprint = new THREE.LineSegments(
        footprintGeometry,
        new THREE.LineBasicMaterial({
          color: 0x83b3ff,
          transparent: true,
          opacity: 0.8,
        }),
      );
      const center = entry.bounds.getCenter(new THREE.Vector3());
      footprint.position.set(center.x, center.y, -0.001);
      entry.footprint = footprint;
      entry.group.add(footprint);
      this.events.ready(id, {
        joints,
        links: Object.keys(robot.links).length,
        dimensions: size.toArray(),
      });
      if (this.workspace)
        this.update(this.workspace, this.selected, this.isolated);
    } catch (error) {
      if (robot) disposeObject(robot);
      if (!this.disposed)
        this.events.error(
          id,
          error instanceof Error ? error.message : "Unable to load model",
        );
    }
  }

  update(workspace: Workspace, selected: InstrumentId, isolated: boolean) {
    this.workspace = workspace;
    this.selected = selected;
    this.isolated = isolated;
    for (const [id, entry] of this.entries) {
      const state = workspace[id];
      if (state.present && !entry.group.parent) this.scene.add(entry.group);
      if (!state.present && entry.group.parent) this.scene.remove(entry.group);
      entry.group.visible =
        state.present && state.visible && (!isolated || id === selected);
      entry.group.position.set(state.pose.x, state.pose.z, -state.pose.y);
      entry.group.quaternion.copy(sceneOrientation(state.pose));
      if (entry.robot) {
        // Render measured Tiny SE angles even beyond reconstructed Tiny 2 limits.
        if (id === "tiny2") for (const joint of Object.values(entry.robot.joints)) joint.ignoreLimits = true;
        entry.robot.setJointValues(state.joints);
      }
      if (entry.footprint) entry.footprint.visible = id === selected;
      entry.label.classList.toggle("selected", id === selected);
    }
    this.syncPlacementHandle();
  }

  setPlacementEnabled(
    enabled: boolean,
    mode: "translate" | "rotate" = "translate",
  ) {
    this.placementEnabled = enabled;
    this.transform.setMode(mode);
    this.syncPlacementHandle();
  }

  private syncPlacementHandle() {
    const entry = this.entries.get(this.selected);
    if (this.surfaceMount || !this.placementEnabled || !entry?.robot || !entry.group.visible) {
      this.transform.detach();
      this.controls.enabled = true;
      return;
    }
    if (!this.transform.dragging) {
      this.moveAnchor.position.copy(entry.group.position);
      if (this.transform.mode === "rotate")
        this.moveAnchor.quaternion.copy(entry.group.quaternion);
      else this.moveAnchor.rotation.set(-Math.PI / 2, 0, 0);
    }
    if (this.transform.object !== this.moveAnchor)
      this.transform.attach(this.moveAnchor);
  }

  setSurfaceMount(enabled: boolean) {
    this.surfaceMount = enabled;
    this.mountMarker.visible = false;
    this.renderer.domElement.style.cursor = enabled ? "crosshair" : "";
    this.syncPlacementHandle();
  }

  setAcrylicVisible(visible: boolean) {
    this.acrylicVisible = visible;
    this.mountMarker.visible = false;
    this.entries.get("flex")?.robot?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.every(material => material.name === "polycarbonate")) {
        object.visible = visible;
      }
    });
  }

  private isVisibleHit(hit: THREE.Intersection) {
    let object: THREE.Object3D | null = hit.object;
    while (object) {
      if (!object.visible) return false;
      object = object.parent;
    }
    return true;
  }

  private mountHit(event: PointerEvent) {
    const flex = this.entries.get("flex");
    if (!flex?.robot || !flex.group.visible) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1,
    ), this.camera);
    flex.group.updateWorldMatrix(true, true);
    // Target only Flex visual meshes: grid, labels, and the Tiny 2 never intercept.
    const hit = ray.intersectObject(flex.robot, true).find(hit => this.isVisibleHit(hit));
    if (!hit?.face) return;
    const normal = hit.face.normal.clone().applyNormalMatrix(
      new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld),
    ).normalize();
    // Double-sided panels mount on the side the user clicked.
    if (normal.dot(ray.ray.direction) > 0) normal.negate();
    return { point: hit.point, normal };
  }

  private onMountLeave = () => { this.mountMarker.visible = false; };
  private onMountHover = (event: PointerEvent) => {
    if (!this.surfaceMount) return;
    const hit = this.mountHit(event);
    this.mountMarker.visible = !!hit;
    if (hit) {
      this.mountMarker.position.copy(hit.point).addScaledVector(hit.normal, 0.0002);
      this.mountMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
    }
  };

  setGrid(visible: boolean) {
    this.grid.visible = visible;
  }

  focus(
    id?: InstrumentId,
    preset: "perspective" | "front" | "top" = "perspective",
  ) {
    const bounds = new THREE.Box3();
    for (const [entryId, entry] of this.entries) {
      if (entry.robot && entry.group.visible && (!id || entryId === id)) {
        entry.group.updateWorldMatrix(true, true);
        bounds.union(new THREE.Box3().setFromObject(entry.robot));
      }
    }
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.025);
    const halfFov = Math.min(
      THREE.MathUtils.degToRad(this.camera.fov / 2),
      Math.atan(
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) *
          this.camera.aspect,
      ),
    );
    const distance = (radius / Math.sin(halfFov)) * 1.12;
    const direction =
      preset === "top"
        ? new THREE.Vector3(0, 1, 0.001)
        : preset === "front"
          ? new THREE.Vector3(0, 0.08, 1)
          : new THREE.Vector3(1, 0.75, 1.3).normalize();
    const position = center.clone().addScaledVector(direction, distance);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.camera.position.copy(position);
      this.controls.target.copy(center);
      this.goal = undefined;
    } else this.goal = { target: center, position };
  }

  attachExpectedView(host: HTMLDivElement) {
    this.detachExpectedView();
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = this.renderer.outputColorSpace;
    renderer.toneMapping = this.renderer.toneMapping;
    renderer.toneMappingExposure = this.renderer.toneMappingExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x101722);
    renderer.domElement.setAttribute("aria-label", "Expected image from the modeled Tiny 2 optical frame");
    host.appendChild(renderer.domElement);
    this.expected = { renderer, host, camera: new THREE.PerspectiveCamera(45, 16 / 9, .001, 100), horizontalFov: 70, aspect: 16 / 9 };
  }
  setExpectedLens(horizontalFov: number, aspect: number) {
    if (this.expected) { this.expected.horizontalFov = horizontalFov; this.expected.aspect = aspect; }
  }
  setLighting(lighting: Lighting) {
    this.renderer.toneMappingExposure = lighting.exposure;
    if (this.expected) this.expected.renderer.toneMappingExposure = lighting.exposure;
    if (lighting.tint.some((value, i) => value !== this.lighting.tint[i])) {
      const previous = this.reflections;
      this.reflections = createLabReflections(this.renderer, lighting.tint);
      this.scene.environment = this.reflections.texture;
      previous.dispose();
      this.scene.traverse(object => {
        if (!(object instanceof THREE.Light)) return;
        object.userData.originalColor ??= object.color.clone();
        object.color.copy(object.userData.originalColor).multiply(new THREE.Color(...lighting.tint));
      });
    }
    this.lighting = { exposure: lighting.exposure, tint: [...lighting.tint] };
  }
  captureAlignment() {
    this.renderExpectedView();
    const view = this.expected, tiny = this.entries.get("tiny2"), flex = this.entries.get("flex");
    if (!view || !tiny?.robot || !flex?.robot || !this.workspace) throw new Error("Load Flex and Tiny 2 first.");
    view.camera.updateMatrixWorld(true);
    const camera = view.camera.clone(), initial = camera.matrixWorld.clone();
    const cameraToBase = initial.clone().invert().multiply(tiny.group.matrixWorld);
    const oldPose = { ...this.workspace.tiny2.pose };
    const source = view.renderer.domElement, canvas = document.createElement("canvas");
    canvas.width = 1280; canvas.height = Math.round(1280 / view.aspect);
    const width = Math.min(source.width, source.height * view.aspect), height = width / view.aspect;
    canvas.getContext("2d")!.drawImage(source, (source.width - width) / 2, (source.height - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
    const meshes: THREE.Object3D[] = [];
    flex.robot.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some(m => m.name === "polycarbonate")) return;
      for (let parent: THREE.Object3D | null = object; parent && parent !== flex.group; parent = parent.parent) if (!parent.visible) return;
      meshes.push(object);
    });
    return {
      canvas, initial,
      pick: (x: number, y: number): [number, number, number] | null => {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
        const hit = ray.intersectObjects(meshes, false)[0];
        return hit ? hit.point.toArray() : null;
      },
      pose: (fitted: THREE.Matrix4) => {
        const base = fitted.clone().multiply(cameraToBase), position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
        base.decompose(position, quaternion, new THREE.Vector3());
        return rotatedPose({ ...oldPose, x: position.x, y: -position.z, z: position.y }, quaternion);
      },
    };
  }
  detachExpectedView() {
    if (!this.expected) return;
    this.expected.renderer.dispose(); this.expected.renderer.domElement.remove(); this.expected = undefined;
  }
  async captureDataset(recipe: Recipe, assets: DatasetAsset[], templates: Map<string, THREE.Group>, slots: string[], emptyClass: string) {
    const flex = this.entries.get('flex')?.robot;
    if (!flex || !this.expected) throw new Error('Load Flex and the camera view first.');
    const placed: THREE.Object3D[] = [], previousLighting = this.lighting;
    const tiny = this.entries.get('tiny2')?.robot;
    const oldPan = tiny?.joints.obsbot_pan_joint.jointValue[0], oldTilt = tiny?.joints.obsbot_tilt_joint.jointValue[0];
    const oldFov = this.expected.horizontalFov;
    const gantryJoints = ['carriage_x_joint', 'gantry_y_joint', 'carriage_z_joint'] as const;
    const oldGantry = gantryJoints.map(name => flex.joints[name]?.jointValue[0]);
    try {
      if (recipe.gantry) {
        gantryJoints.forEach((name, i) => flex.setJointValue(name, [recipe.gantry!.x, recipe.gantry!.y, recipe.gantry!.z][i]));
      }
      if (recipe.camera && tiny) {
        tiny.setJointValue('obsbot_pan_joint', THREE.MathUtils.degToRad(recipe.camera.pan));
        tiny.setJointValue('obsbot_tilt_joint', THREE.MathUtils.degToRad(recipe.camera.tilt));
        this.expected.horizontalFov = zoomedFov(oldFov, recipe.camera.zoom);
      }
      for (const placement of recipe.placements) {
        const slot = flex.links[`slot_${placement.slot.toLowerCase()}`], template = templates.get(placement.assetId);
        if (!slot || !template) throw new Error('A scene asset or slot is unavailable.');
        const object = template.clone(true);
        object.position.set(placement.offsetX / 1000, placement.offsetY / 1000, .003);
        object.rotation.z = THREE.MathUtils.degToRad(placement.yaw);
        object.updateMatrixWorld(true);
        const footprint = new THREE.Box3().setFromObject(object);
        if (footprint.min.x < -.079 || footprint.max.x > .079 || footprint.min.y < -.051 || footprint.max.y > .051) throw new Error('The proposed rotation or offset puts an asset outside its slot. Ask Codex for smaller rotations and centered placement.');
        slot.add(object); placed.push(object);
      }
      this.setLighting({ exposure: previousLighting.exposure * recipe.exposure, tint: previousLighting.tint.map((v, i) => v * (1 + recipe.warmth * (i === 0 ? 1 : i === 2 ? -1 : 0))) as [number, number, number] });
      let detections: Detection[] = [];
      let wasteRecognized = false;
      this.renderExpectedView([1280, 720], () => {
        const masks = captureObjectMasks(this.expected!.renderer, this.scene, this.expected!.camera, [...placed, flex.links.waste_bin]);
        const waste = masks.at(-1)!; wasteRecognized = waste.pixels >= 64 && !waste.review;
        detections = masks.slice(0, placed.length).map((mask, i) => ({ ...mask, slot: recipe.placements[i].slot, assetId: recipe.placements[i].assetId, classId: assets.find(a => a.id === recipe.placements[i].assetId)!.classId }));
      });
      const view = this.expected, canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 720;
      canvas.getContext('2d')!.drawImage(view.renderer.domElement, 0, 0, 1280, 720);
      view.camera.updateMatrixWorld(true);
      const candidates: THREE.Object3D[] = [];
      flex.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        if ((Array.isArray(o.material) ? o.material : [o.material]).some(m => m.name === 'polycarbonate')) return;
        for (let p: THREE.Object3D | null = o; p && p !== flex; p = p.parent) if (!p.visible) return;
        candidates.push(o);
      });
      const slotStates: SlotState[] = [];
      const annotations: Annotation[] = deckSlots.map(name => {
        const slot = flex.links[`slot_${name.toLowerCase()}`];
        const projection = (x: number, y: number) => slot.localToWorld(new THREE.Vector3(x, y, 0)).project(view.camera);
        const corners = [[-.064, -.043], [.064, -.043], [.064, .043], [-.064, .043]].map(([x, y]) => projection(x, y));
        let visible = 0;
        const ownObject = name === "A3" ? flex.links.waste_bin : placed[recipe.placements.findIndex(p => p.slot === name)];
        for (const x of [-.05, 0, .05]) for (const y of [-.03, 0, .03]) {
          const p = projection(x, y);
          if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z < -1 || p.z > 1) continue;
          const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(p.x, p.y), view.camera);
          const hit = ray.intersectObjects(candidates, false)[0];
          if (hit) {
            const point = slot.localToWorld(new THREE.Vector3(x, y, 0));
            let own = false;
            for (let parent: THREE.Object3D | null = hit.object; parent; parent = parent.parent) if (parent === ownObject || parent === slot) own = true;
            if (own || Math.abs(hit.distance - ray.ray.origin.distanceTo(point)) < .008) visible++;
          }
        }
        const placement = recipe.placements.find(p => p.slot === name), asset = assets.find(a => a.id === placement?.assetId);
        const fullyInFrame = corners.every(p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= -1 && p.z <= 1);
        const front = corners.every(p => p.z >= -1 && p.z <= 1);
        const polygon = front ? corners.map(p => [(p.x + 1) * 640, (1 - p.y) * 360]) : null;
        const detection = detections.find(d => d.slot === name);
        slotStates.push(inferSlotState({ slot: name, inFrame: fullyInFrame, visibility: visible / 9, occupied: !!placement || name === 'A3', recognized: name === 'A3' ? wasteRecognized : !!detection && !detection.review && detection.pixels >= 64, classId: name === 'A3' ? 'fixed-waste-bin' : asset?.classId ?? null, assetId: name === 'A3' ? 'fixed-waste-bin' : asset?.id ?? null, polygon }));
        return { slot: name, classId: asset?.classId || emptyClass || null, assetId: asset?.id || null, polygon: corners.map(p => [(p.x + 1) * 640, (1 - p.y) * 360]), visibility: visible / 9, review: !fullyInFrame || visible < 7 || !(asset?.classId || emptyClass) };
      });
      const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the rendered image.')), 'image/png'));
      return { image, annotations: annotations.filter(a => slots.includes(a.slot)), slotStates, slotStateVersion: 1 as const, detections, cameraMatrix: view.camera.matrixWorld.toArray() };
    } finally {
      placed.forEach(o => o.removeFromParent());
      gantryJoints.forEach((name, i) => { if (oldGantry[i] !== undefined) flex.setJointValue(name, oldGantry[i]!); });
      if (tiny && oldPan !== undefined && oldTilt !== undefined) { tiny.setJointValue('obsbot_pan_joint', oldPan); tiny.setJointValue('obsbot_tilt_joint', oldTilt); }
      if (this.expected) this.expected.horizontalFov = oldFov;
      this.setLighting(previousLighting);
    }
  }
  private renderExpectedView(outputSize?: [number, number], captureMasks?: () => void) {
    const view = this.expected;
    const optical = this.entries.get("tiny2")?.robot?.links.obsbot_camera_optical_frame;
    if (!view || !optical || !this.workspace?.tiny2.present) return;
    this.scene.updateMatrixWorld(true);
    optical.getWorldPosition(view.camera.position);
    view.camera.quaternion.copy(opticalViewQuaternion(optical.getWorldQuaternion(new THREE.Quaternion())));
    view.camera.aspect = view.aspect;
    view.camera.fov = verticalFov(view.horizontalFov, view.aspect);
    view.camera.updateProjectionMatrix();
    const width = outputSize?.[0] ?? Math.max(1, view.host.clientWidth), height = outputSize?.[1] ?? Math.max(1, view.host.clientHeight);
    const size = view.renderer.getSize(new THREE.Vector2());
    if (size.x !== width || size.y !== height) view.renderer.setSize(width, height);
    // Letterbox the modeled image just like the live video, including when
    // the comparison fills a viewport with a different aspect ratio.
    const imageWidth = Math.min(width, height * view.aspect);
    const imageHeight = imageWidth / view.aspect;
    const left = (width - imageWidth) / 2, bottom = (height - imageHeight) / 2;
    view.renderer.setScissorTest(false);
    view.renderer.clear();
    view.renderer.setViewport(left, bottom, imageWidth, imageHeight);
    view.renderer.setScissor(left, bottom, imageWidth, imageHeight);
    view.renderer.setScissorTest(true);
    // Scene visibility is an editing aid. The expected camera sees all present
    // instruments and acrylic, with no gizmos, grid, footprint or self geometry.
    const restore: [THREE.Object3D, boolean][] = [];
    const visible = (object: THREE.Object3D, value: boolean) => { restore.push([object, object.visible]); object.visible = value; };
    const flex = this.entries.get("flex");
    if (flex) {
      this.labBackdrop.position.copy(flex.group.position);
      this.labBackdrop.quaternion.copy(flex.group.quaternion);
    }
    visible(this.labBackdrop, !!this.workspace.flex.present);
    for (const [id, entry] of this.entries) {
      visible(entry.group, id !== "tiny2" && !!this.workspace[id].present);
      if (entry.footprint) visible(entry.footprint, false);
    }
    visible(this.grid, false); visible(this.mountMarker, false); visible(this.transform.getHelper(), false);
    this.scene.traverse(object => {
      if (object instanceof THREE.AxesHelper) visible(object, false);
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.every(material => material.name === "polycarbonate")) visible(object, true);
      }
    });
    try { captureMasks?.(); view.renderer.render(this.scene, view.camera); }
    finally { for (const [object, previous] of restore.reverse()) object.visible = previous; }
  }

  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private onPointerDown = (event: PointerEvent) => {
    this.gizmoPointer = this.transform.axis !== null && !!this.transform.object;
    if (this.gizmoPointer) {
      this.controls.enabled = false;
      this.goal = undefined;
    }
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };
  private onPointerUp = (event: PointerEvent) => {
    if (
      this.gizmoPointer ||
      event.button !== 0 ||
      Math.hypot(
        event.clientX - this.pointerStart.x,
        event.clientY - this.pointerStart.y,
      ) > 4
    )
      return;
    if (this.surfaceMount) {
      const hit = this.mountHit(event);
      const tiny = this.entries.get("tiny2");
      if (hit && tiny?.bounds && this.workspace?.tiny2.present) {
        const pose = surfaceMountedPose(this.workspace.tiny2.pose, hit.point, hit.normal, tiny.bounds.min.z);
        this.setSurfaceMount(false);
        this.events.mounted(pose);
      }
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const candidates = [...this.entries.values()]
      .filter((e) => e.group.visible && e.robot)
      .map((e) => e.robot!);
    const hit = ray.intersectObjects(candidates, true).find(hit => this.isVisibleHit(hit));
    if (hit) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !instruments.some((i) => i.id === object!.name))
        object = object.parent;
      if (object) this.events.select(object.name as InstrumentId);
    }
  };
  private onDoubleClick = () => { if (!this.surfaceMount) this.focus(this.selected); };

  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    if (this.goal) {
      this.camera.position.lerp(this.goal.position, 0.14);
      this.controls.target.lerp(this.goal.target, 0.14);
      if (this.camera.position.distanceTo(this.goal.position) < 0.0001)
        this.goal = undefined;
    }
    if (!this.transform.dragging) this.controls.update();
    for (const entry of this.entries.values()) {
      if (!entry.bounds || !entry.group.visible) {
        entry.label.hidden = true;
        continue;
      }
      const point = entry.bounds.getCenter(new THREE.Vector3());
      point.z = entry.bounds.max.z + Math.max(0.02, entry.bounds.max.z * 0.04);
      entry.group.localToWorld(point);
      point.project(this.camera);
      entry.label.hidden =
        point.z > 1 ||
        point.z < -1 ||
        Math.abs(point.x) > 0.95 ||
        Math.abs(point.y) > 0.95;
      entry.label.style.left = `${((point.x + 1) / 2) * this.host.clientWidth}px`;
      entry.label.style.top = `${((-point.y + 1) / 2) * this.host.clientHeight}px`;
    }
    this.renderer.render(this.scene, this.camera);
    this.renderExpectedView();
  };

  dispose() {
    this.disposed = true;
    this.detachExpectedView();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("pointermove", this.onMountHover);
    this.renderer.domElement.removeEventListener("pointerleave", this.onMountLeave);
    this.transform.detach();
    this.scene.remove(this.transform.getHelper());
    this.transform.dispose();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.onPointerDown,
      true,
    );
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.removeEventListener(
      "dblclick",
      this.onDoubleClick,
    );
    for (const entry of this.entries.values()) {
      if (!entry.group.parent) disposeObject(entry.group);
    }
    disposeObject(this.scene);
    this.reflections.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    for (const entry of this.entries.values()) entry.label.remove();
  }
}
