import * as THREE from 'three';
import { maskBounds, objectMaskBounds } from './dataset-labels';

/** One shared object-ID pass for visibility, then an isolated silhouette per target.
 * Transparent labware counts as a whole object; enclosure acrylic does not occlude.
 * Runs synchronously inside the camera renderer's temporary visibility scope.
 */
export function captureObjectMasks(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, objects: THREE.Object3D[]) {
  const target = new THREE.WebGLRenderTarget(1280, 720, { depthBuffer: true });
  const black = new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const ids = objects.map((_, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(((i + 1) & 255) / 255, (((i + 1) >> 8) & 255) / 255, 0, THREE.LinearSRGBColorSpace), side: THREE.DoubleSide, fog: false, toneMapped: false }));
  const membership = new Map<THREE.Object3D, number>();
  objects.forEach((object, index) => object.traverse(child => membership.set(child, index)));
  const meshes: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; visible: boolean; acrylic: boolean }[] = [];
  scene.traverse(o => { if (o instanceof THREE.Mesh) meshes.push({ mesh: o, material: o.material, visible: o.visible, acrylic: (Array.isArray(o.material) ? o.material : [o.material]).every(m => m.name === 'polycarbonate') }); });
  // Imported instanced colors must not multiply the segmentation IDs.
  const instanceColors = meshes.filter(entry => entry.mesh instanceof THREE.InstancedMesh).map(entry => ({ mesh: entry.mesh as THREE.InstancedMesh, color: (entry.mesh as THREE.InstancedMesh).instanceColor }));
  const background = scene.background, fog = scene.fog, tone = renderer.toneMapping, oldTarget = renderer.getRenderTarget();
  const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
  const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  const pixels = new Uint8Array(1280 * 720 * 4);
  const read = () => { renderer.clear(); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 1280, 720, pixels); return maskBounds(pixels, 1280, 720); };
  try {
    instanceColors.forEach(entry => { entry.mesh.instanceColor = null; });
    scene.background = new THREE.Color(0); scene.fog = null; renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(target); renderer.setViewport(0, 0, 1280, 720); renderer.setScissorTest(false); renderer.setClearColor(0, 1);
    for (const { mesh, visible, acrylic } of meshes) {
      const index = membership.get(mesh);
      mesh.material = index === undefined ? black : ids[index];
      mesh.visible = visible && !acrylic;
    }
    renderer.clear(); renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 1280, 720, pixels);
    const masks = objectMaskBounds(pixels, 1280, 720, objects.length);
    return objects.map((_, index) => {
      const visible = masks[index];
      if (!visible.count) return { box: null, pixels: 0, visibility: 0, review: false };
      for (const entry of meshes) { entry.mesh.material = white; entry.mesh.visible = entry.visible && membership.get(entry.mesh) === index; }
      const isolated = read();
      return { box: visible.box, pixels: visible.count, visibility: isolated.count ? visible.count / isolated.count : 0, review: visible.count > 0 && (visible.count < 64 || visible.count / Math.max(1, isolated.count) < .25) };
    });
  } finally {
    instanceColors.forEach(entry => { entry.mesh.instanceColor = entry.color; });
    meshes.forEach(({ mesh, material, visible }) => { mesh.material = material; mesh.visible = visible; });
    scene.background = background; scene.fog = fog; renderer.toneMapping = tone;
    renderer.setRenderTarget(oldTarget); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest); renderer.setClearColor(clear, alpha);
    target.dispose(); black.dispose(); white.dispose(); ids.forEach(material => material.dispose());
  }
}
