import { expect, it } from 'vitest';
import * as THREE from 'three';
import { nearestHitQuery } from './nearest-hit';

it('matches exhaustive nearest hits for rotated, instanced, and overlapping meshes', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes: THREE.Mesh[] = Array.from({ length: 20 }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.position.set((i % 5) - 2, Math.floor(i / 5) - 2, -i / 5);
    mesh.rotation.set(i * .1, i * .3, 0); mesh.updateMatrixWorld(); return mesh;
  });
  const instances = new THREE.InstancedMesh(new THREE.SphereGeometry(.4), material, 2);
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 3));
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 3));
  instances.updateMatrixWorld(); meshes.push(instances);
  const query = nearestHitQuery(meshes);
  for (let x = -3; x <= 3; x += .3) for (let y = -3; y <= 3; y += .3) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 6), new THREE.Vector3(0, 0, -1));
    const expected = ray.intersectObjects(meshes, false)[0], actual = query(ray);
    expect(actual?.object).toBe(expected?.object);
    if (expected) expect(actual?.distance).toBeCloseTo(expected.distance, 9);
  }
  const inside = new THREE.Raycaster(meshes[0].position.clone(), new THREE.Vector3(1, 0, 0));
  expect(query(inside)?.distance).toBeCloseTo(inside.intersectObjects(meshes, false)[0].distance, 9);
  meshes.forEach(mesh => mesh.geometry.dispose()); material.dispose();
});
