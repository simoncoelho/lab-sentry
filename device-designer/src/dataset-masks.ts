import * as THREE from 'three';
import { maskBounds } from './dataset-labels';

/** Render the same scene twice per target: visible silhouette and isolated silhouette.
 * Transparent labware counts as a whole object; enclosure acrylic does not occlude.
 * Runs synchronously inside the camera renderer's temporary visibility scope.
 */
export function captureObjectMasks(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, objects: THREE.Object3D[]) {
  const target = new THREE.WebGLRenderTarget(1280, 720, { depthBuffer: true });
  const black = new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const meshes: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; visible: boolean; acrylic: boolean }[] = [];
  scene.traverse(o => { if (o instanceof THREE.Mesh) meshes.push({ mesh: o, material: o.material, visible: o.visible, acrylic: (Array.isArray(o.material) ? o.material : [o.material]).every(m => m.name === 'polycarbonate') }); });
  const background = scene.background, fog = scene.fog, tone = renderer.toneMapping, oldTarget = renderer.getRenderTarget();
  const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
  const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  const pixels = new Uint8Array(1280 * 720 * 4);
  const read = () => { renderer.clear(); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 1280, 720, pixels); return maskBounds(pixels, 1280, 720); };
  try {
    scene.background = new THREE.Color(0); scene.fog = null; renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(target); renderer.setViewport(0, 0, 1280, 720); renderer.setScissorTest(false); renderer.setClearColor(0, 1);
    return objects.map(object => {
      const members = new Set<THREE.Object3D>(); object.traverse(o => members.add(o));
      for (const { mesh, visible, acrylic } of meshes) { mesh.material = members.has(mesh) ? white : black; mesh.visible = visible && !acrylic; }
      const visible = read();
      for (const entry of meshes) entry.mesh.visible = entry.visible && members.has(entry.mesh);
      const isolated = read();
      return { box: visible.box, pixels: visible.count, visibility: isolated.count ? visible.count / isolated.count : 0, review: visible.count > 0 && (visible.count < 64 || visible.count / Math.max(1, isolated.count) < .25) };
    });
  } finally {
    meshes.forEach(({ mesh, material, visible }) => { mesh.material = material; mesh.visible = visible; });
    scene.background = background; scene.fog = fog; renderer.toneMapping = tone;
    renderer.setRenderTarget(oldTarget); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest); renderer.setClearColor(clear, alpha);
    target.dispose(); black.dispose(); white.dispose();
  }
}
