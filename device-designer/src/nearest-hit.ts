import * as THREE from 'three';

/** Broad-phase bounds are rebuilt after each scene placement. Visit near meshes
 * first and skip triangle tests once their bounds are beyond the nearest hit. */
export function nearestHitQuery(meshes: THREE.Object3D[]) {
  const bounds = meshes.map(mesh => ({ mesh, box: new THREE.Box3().setFromObject(mesh) }));
  const point = new THREE.Vector3();
  return (raycaster: THREE.Raycaster): THREE.Intersection | undefined => {
    const candidates = bounds.flatMap(entry => {
      if (!raycaster.ray.intersectBox(entry.box, point)) return [];
      const distance = entry.box.containsPoint(raycaster.ray.origin) ? 0 : point.distanceTo(raycaster.ray.origin);
      return [{ ...entry, distance }];
    }).sort((a, b) => a.distance - b.distance);
    let nearest: THREE.Intersection | undefined;
    for (const candidate of candidates) {
      if (nearest && candidate.distance > nearest.distance + 1e-8) break;
      const hit = raycaster.intersectObject(candidate.mesh, false)[0];
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
    }
    return nearest;
  };
}
