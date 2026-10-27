import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { DatasetAsset } from './dataset';
import { createFlexTip200Array } from './flex-tip-200';

export function disposeAsset(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { materials.add(m); for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v); } } });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}
export async function loadDatasetAsset(asset: DatasetAsset): Promise<THREE.Group> {
  if (!Number.isFinite(asset.widthMm) || asset.widthMm < 10 || asset.widthMm > 140) throw new Error(`${asset.name}: width must be 10–140 mm.`);
  const root = new THREE.Group();
  if (asset.file || asset.modelUrl) {
    const response = asset.file ? null : await fetch(asset.modelUrl!);
    if (response && !response.ok) throw new Error(`Could not load ${asset.name}.`);
    const buffer = asset.file ? await asset.file.arrayBuffer() : await response!.arrayBuffer();
    if (asset.kind === 'stl') root.add(new THREE.Mesh(new STLLoader().parse(buffer), new THREE.MeshStandardMaterial({ color: '#cbd4dc', roughness: .48 })));
    else {
      // A GLB must be self-contained: no surprise requests for external textures or buffers.
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(url => { if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('Use a self-contained GLB with embedded textures.'); return url; });
      const gltf = await new GLTFLoader(manager).parseAsync(buffer, '');
      gltf.scene.traverse(o => { if (o instanceof THREE.Light || o instanceof THREE.Camera) o.visible = false; });
      root.add(gltf.scene);
    }
    if (asset.up === 'Y') root.rotation.x = Math.PI / 2;
  } else if (asset.definitionUrl) {
    const response = await fetch(asset.definitionUrl);
    if (!response.ok) throw new Error(`Could not load ${asset.name} definition.`);
    const def = await response.json();
    const { xDimension: w, yDimension: d, zDimension: h } = def.dimensions;
    const box = (x: number, y: number, z: number, px: number, py: number, pz: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material); mesh.position.set(px, py, pz); root.add(mesh);
    };
    const dark = new THREE.MeshStandardMaterial({ color: '#292d30', roughness: .6 });
    const plastic = new THREE.MeshStandardMaterial({ color: asset.id === 'library-flex-filter-1000' ? '#2bb2d4' : asset.id === 'library-flex-filter-50' ? '#a734cc' : asset.id.includes('flex') ? '#efce22' : '#dce4e5', roughness: .36 });
    const clear = new THREE.MeshStandardMaterial({ color: '#e3edef', transparent: true, opacity: .38, roughness: .18, depthWrite: false });
    if (asset.id === 'library-nest-deep-96' || asset.id === 'library-nest-12') {
      clear.color.set(asset.id === 'library-nest-12' ? '#eee8cb' : '#f0efdf');
      clear.opacity = .68; clear.roughness = .38;
    }
    if (def.parameters.isTiprack) {
      const detailed200 = def.parameters.loadName === 'opentrons_flex_96_filtertiprack_200ul';
      const length = def.parameters.tipLength, top = h, rackTop = detailed200 ? top - 6.2 : h - length * .38;
      box(w, d, 3, w / 2, d / 2, 1.5, dark);
      for (const x of [1.5, w - 1.5]) box(3, d, rackTop - 3, x, d / 2, rackTop / 2, dark);
      for (const y of [1.5, d - 1.5]) box(w, 3, rackTop - 3, w / 2, y, rackTop / 2, dark);
      // The photographed racks have a colored upper skirt over the black base.
      const skirtHeight = Math.min(22, rackTop * .5);
      for (const x of [1.4, w - 1.4]) box(3.2, d, skirtHeight, x, d / 2, rackTop - skirtHeight / 2, plastic);
      for (const y of [1.4, d - 1.4]) box(w, 3.2, skirtHeight, w / 2, y, rackTop - skirtHeight / 2, plastic);
      clear.opacity = .65; clear.roughness = .28;
      // Inset open lattice preserves holes; dimensions and tip centers come from the manufacturer.
      const wells = Object.values(def.wells) as { x: number; y: number; diameter: number }[];
      const xs = [...new Set(wells.map(a => a.x))].sort((a,b) => a-b), ys = [...new Set(wells.map(a => a.y))].sort((a,b) => a-b);
      for (const x of [1.5, ...xs.slice(1).map((v,i) => (v + xs[i]) / 2), w - 1.5]) box(2.8, d, 3, x, d / 2, rackTop, plastic);
      for (const y of [1.5, ...ys.slice(1).map((v,i) => (v + ys[i]) / 2), d - 1.5]) box(w, 2.8, 3, w / 2, y, rackTop, plastic);
      if(detailed200) {
        root.add(createFlexTip200Array(wells.map(well=>({x:well.x,y:well.y,z:top-length}))));
      } else {
      const geometry = new THREE.CylinderGeometry(wells[0].diameter / 2, .35, length, 16, 1, true); geometry.rotateX(Math.PI / 2);
      const tips = new THREE.InstancedMesh(geometry, clear, wells.length);
      const rimGeometry = new THREE.TorusGeometry(wells[0].diameter / 2, .22, 6, 16);
      const rims = new THREE.InstancedMesh(rimGeometry, clear, wells.length), matrix = new THREE.Matrix4();
      wells.forEach((well, i) => { tips.setMatrixAt(i, matrix.makeTranslation(well.x, well.y, top - length / 2)); rims.setMatrixAt(i, matrix.makeTranslation(well.x, well.y, top - .22)); });
      root.add(tips, rims);
      }
    } else {
      box(w, d, 3, w / 2, d / 2, 1.5, clear);
      for (const x of [1, w - 1]) box(2, d, h, x, d / 2, h / 2, clear);
      for (const y of [1, d - 1]) box(w, 2, h, w / 2, y, h / 2, clear);
      if (asset.kind === 'reservoir' && Object.keys(def.wells).length === 12) {
        const xs = (Object.values(def.wells) as { x: number }[]).map(v => v.x).sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) box(1, d - 4, h - 3, (xs[i-1] + xs[i]) / 2, d / 2, (h + 3) / 2, clear);
      }
      if (asset.kind === 'plate') {
        const wells = Object.values(def.wells) as { x: number; y: number; z: number; depth: number; diameter: number; shape: string; xDimension?: number; yDimension?: number }[];
        const well = wells[0];
        const rectangular = well.shape === 'rectangular';
        let geometry: THREE.BufferGeometry, rimGeometry: THREE.BufferGeometry;
        if (rectangular) {
          const x = well.xDimension! / 2, y = well.yDimension! / 2;
          const outline = new THREE.Shape(); outline.moveTo(-x-.35,-y-.35); outline.lineTo(x+.35,-y-.35); outline.lineTo(x+.35,y+.35); outline.lineTo(-x-.35,y+.35); outline.closePath();
          const hole = new THREE.Path(); hole.moveTo(-x,-y); hole.lineTo(-x,y); hole.lineTo(x,y); hole.lineTo(x,-y); hole.closePath(); outline.holes.push(hole);
          geometry = new THREE.ExtrudeGeometry(outline, { depth: well.depth, bevelEnabled: false }); geometry.translate(0,0,-well.depth/2);
          rimGeometry = new THREE.ExtrudeGeometry(outline, { depth: .4, bevelEnabled: false });
        } else {
          geometry = new THREE.CylinderGeometry(well.diameter / 2, well.diameter / 2, well.depth, 20, 1, true); geometry.rotateX(Math.PI / 2);
          rimGeometry = new THREE.TorusGeometry(well.diameter / 2, .25, 6, 20);
        }
        const tubes = new THREE.InstancedMesh(geometry, clear, wells.length);
        const rims = new THREE.InstancedMesh(rimGeometry, clear, wells.length);
        const matrix = new THREE.Matrix4();
        wells.forEach((v, i) => { tubes.setMatrixAt(i, matrix.makeTranslation(v.x, v.y, v.z + v.depth / 2)); rims.setMatrixAt(i, matrix.makeTranslation(v.x, v.y, v.z + v.depth)); });
        root.add(tubes, rims);
      }
    }
  } else {
    const plastic = new THREE.MeshStandardMaterial({ color: asset.kind === 'tiprack' ? '#f1c928' : '#d3e0e7', roughness: .4 });
    const dark = new THREE.MeshStandardMaterial({ color: '#242b30', roughness: .55 });
    const clear = new THREE.MeshStandardMaterial({ color: '#c9dde0', transparent: true, opacity: .38, roughness: .16, metalness: .05, depthWrite: false });
    const box = (x: number, y: number, z: number, px: number, py: number, pz: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material); mesh.position.set(px, py, pz); root.add(mesh);
    };
    const w = .12776, d = .08548;
    box(w, d, .004, 0, 0, .002, asset.kind === 'tiprack' ? dark : plastic);
    const h = asset.kind === 'tiprack' ? .045 : asset.kind === 'tuberack' ? .04 : .018;
    for (const x of [-1, 1]) box(.002, d, h, x * (w / 2 - .001), 0, h / 2, plastic);
    for (const y of [-1, 1]) box(w, .002, h, 0, y * (d / 2 - .001), h / 2, plastic);
    if (asset.kind === 'reservoir') {
      for (let i = 1; i < 4; i++) box(.002, d, h, -w / 2 + w * i / 4, 0, h / 2, plastic);
    } else {
      const cols = asset.kind === 'tuberack' ? 6 : 12, rows = asset.kind === 'tuberack' ? 4 : 8;
      const radius = asset.kind === 'tuberack' ? .0065 : .003;
      const well = new THREE.CylinderGeometry(radius, radius * .75, h * .9, 12, 1, true);
      well.rotateX(Math.PI / 2);
      const rim = new THREE.TorusGeometry(radius, .00065, 5, 12);
      const wells = new THREE.InstancedMesh(well, asset.kind === 'tiprack' ? clear : plastic, cols * rows);
      const rims = new THREE.InstancedMesh(rim, plastic, cols * rows);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x = (i - (cols - 1) / 2) * (cols === 12 ? .009 : .018), y = (j - (rows - 1) / 2) * (rows === 8 ? .009 : .018);
        wells.setMatrixAt(i * rows + j, matrix.makeTranslation(x, y, h / 2 + .004));
        rims.setMatrixAt(i * rows + j, matrix.makeTranslation(x, y, h + .004));
      }
      root.add(wells, rims);
    }
  }
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.x) || size.x <= 0 || size.y <= 0 || size.z <= 0) { disposeAsset(root); throw new Error(`${asset.name}: no usable mesh geometry.`); }
  const scale = asset.widthMm / 1000 / size.x;
  if (size.y * scale > .092 || size.z * scale > .18 || asset.widthMm > 140 || asset.widthMm < 10) { disposeAsset(root); throw new Error(`${asset.name}: set a width that fits a deck slot (depth ≤92 mm, height ≤180 mm).`); }
  const container = new THREE.Group(); container.add(root); container.scale.setScalar(scale);
  root.position.sub(new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, bounds.min.z));
  container.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return container;
}
