import * as THREE from 'three';

// Bake world transforms at the same instant as the browser's label pass.
// Both Three and USD cameras look down -Z with +Y up. All lengths are meters.
export function isaacSnapshot(scene: THREE.Scene, camera: THREE.PerspectiveCamera, exposure: number) {
  if (Math.abs(camera.aspect - 16 / 9) > .001) throw new Error('Isaac currently requires a 16:9 calibrated camera.');
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const meshes: unknown[] = [], lights: unknown[] = [];
  const textures: Record<string, string> = {};
  scene.traverseVisible(object => {
    if (object instanceof THREE.Light) {
      lights.push({ kind: object.type, color: object.color.toArray(), intensity: object.intensity,
        position: object.getWorldPosition(new THREE.Vector3()).toArray(),
        target: object instanceof THREE.DirectionalLight ? object.target.getWorldPosition(new THREE.Vector3()).toArray() : undefined });
    }
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh) throw new Error('Isaac export does not yet support skinned meshes.');
    const geometry = object.geometry, position = geometry.getAttribute('position');
    if (!position) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const indices = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: position.count }, (_, i) => i);
    const groups = Array.isArray(object.material) && geometry.groups.length ? geometry.groups : [{ start: 0, count: indices.length, materialIndex: 0 }];
    const count = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let instance = 0; instance < count; instance++) {
      const matrix = object.matrixWorld.clone();
      if (object instanceof THREE.InstancedMesh) { const local = new THREE.Matrix4(); object.getMatrixAt(instance, local); matrix.multiply(local); }
      for (const group of groups) {
        const material = materials[group.materialIndex ?? 0] as THREE.MeshStandardMaterial;
        if (!material?.visible) continue;
        // Textures need explicit USD translation, never silently omit them.
        if (material.normalMap || material.roughnessMap || material.metalnessMap || material.alphaMap)
          throw new Error(`Isaac material "${material.name || object.name}" uses a texture that needs conversion. Use the browser renderer for this scene.`);
        let uv: number[][] | undefined;
        if (material.map) {
          const map = material.map, attribute = geometry.getAttribute('uv');
          if (!attribute) throw new Error('Textured mesh has no UV coordinates.');
          if (!textures[map.uuid]) {
            const canvas = document.createElement('canvas');
            canvas.width = map.image.width; canvas.height = map.image.height;
            canvas.getContext('2d')!.drawImage(map.image, 0, 0);
            textures[map.uuid] = canvas.toDataURL('image/png');
          }
          map.updateMatrix();
          uv = Array.from({ length: attribute.count }, (_, i) => {
            const point = new THREE.Vector2(attribute.getX(i), attribute.getY(i)); map.transformUv(point);
            return [point.x, 1 - point.y];
          });
        }
        meshes.push({ name: object.name, matrix: matrix.toArray(),
          points: Array.from({ length: position.count }, (_, i) => [position.getX(i), position.getY(i), position.getZ(i)]),
          indices: indices.slice(group.start, group.start + group.count), uv,
          normals: geometry.getAttribute('normal') ? Array.from({ length: position.count }, (_, i) => { const n = geometry.getAttribute('normal'); return [n.getX(i), n.getY(i), n.getZ(i)]; }) : undefined,
          material: { texture: material.map?.uuid, color: material.color?.toArray() ?? [1, 1, 1], roughness: material.roughness ?? .5, metalness: material.metalness ?? 0,
            // USD Preview Surface approximates transmission using opacity until MDL materials are supported.
            opacity: Math.min(material.transparent ? material.opacity : 1, Math.max(.08, 1 - ((material as THREE.MeshPhysicalMaterial).transmission ?? 0))), ior: (material as THREE.MeshPhysicalMaterial).ior ?? 1.5,
            doubleSided: material.side === THREE.DoubleSide } });
      }
    }
  });
  return { version: 1, width: 1280, height: 720, upAxis: 'Y', metersPerUnit: 1,
    camera: { matrix: camera.matrixWorld.toArray(), verticalFov: camera.fov, near: camera.near, far: camera.far },
    exposure, meshes, lights, textures };
}

export async function renderIsaac(snapshot: ReturnType<typeof isaacSnapshot>): Promise<Blob> {
  const health = await fetch('/isaac-api/health', { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!health?.ok) throw new Error('Isaac is not ready. Run Start-Isaac.cmd and wait for the ready message.');
  const response = await fetch('/isaac-api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot), signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Isaac render failed: ${await response.text()}`);
  if (!response.headers.get('content-type')?.includes('image/png')) throw new Error('Isaac returned an invalid image.');
  return response.blob();
}
