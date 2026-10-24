import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import {
  clamp,
  instruments,
  jointLabels,
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
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
  private controls: OrbitControls;
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
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D instrument workspace. Drag to orbit, right-drag to pan, scroll to zoom.",
    );
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xdce8ff, 0x75849c, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(-2, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xb4cdff, 1.2);
    fill.position.set(3, 2, -2);
    this.scene.add(fill);
    this.grid = new THREE.GridHelper(8, 80, 0x3b4b60, 0x253140);
    this.grid.position.y = -0.002;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.45;
    this.scene.add(this.grid);
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
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.onPointerDown,
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
            const geometry = await new STLLoader(manager).loadAsync(path);
            const color = (material as THREE.MeshPhongMaterial).color;
            object = new THREE.Mesh(
              geometry,
              new THREE.MeshStandardMaterial({
                color,
                roughness: 0.57,
                metalness: 0.15,
                transparent: material.transparent,
                opacity: material.opacity,
              }),
            );
          } else if (/\.obj$/i.test(path)) {
            const mtlPath = new URL("materials.mtl", path).href;
            if (!materials.has(mtlPath))
              materials.set(mtlPath, new MTLLoader(manager).loadAsync(mtlPath));
            const creator = await materials.get(mtlPath)!;
            object = await new OBJLoader(manager)
              .setMaterials(creator)
              .loadAsync(path);
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
      entry.group.rotation.set(-Math.PI / 2, 0, 0);
      entry.group.rotateZ(THREE.MathUtils.degToRad(state.pose.yaw));
      if (entry.robot) entry.robot.setJointValues(state.joints);
      if (entry.footprint) entry.footprint.visible = id === selected;
      entry.label.classList.toggle("selected", id === selected);
    }
  }

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

  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private onPointerDown = (event: PointerEvent) => {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };
  private onPointerUp = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      Math.hypot(
        event.clientX - this.pointerStart.x,
        event.clientY - this.pointerStart.y,
      ) > 4
    )
      return;
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
    const hit = ray.intersectObjects(candidates, true)[0];
    if (hit) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !instruments.some((i) => i.id === object!.name))
        object = object.parent;
      if (object) this.events.select(object.name as InstrumentId);
    }
  };
  private onDoubleClick = () => this.focus(this.selected);

  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    if (this.goal) {
      this.camera.position.lerp(this.goal.position, 0.14);
      this.controls.target.lerp(this.goal.target, 0.14);
      if (this.camera.position.distanceTo(this.goal.position) < 0.0001)
        this.goal = undefined;
    }
    this.controls.update();
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
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.onPointerDown,
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
    for (const entry of this.entries.values()) entry.label.remove();
  }
}
