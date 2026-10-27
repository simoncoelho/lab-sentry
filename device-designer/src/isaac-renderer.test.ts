import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isaacSnapshot } from './isaac-renderer';

describe('Isaac scene transfer', () => {
  it('keeps camera and mesh transforms in meters and omits hidden geometry', () => {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 16 / 9, .01, 20);
    camera.position.set(.2, .3, .4); camera.lookAt(0, 0, 0);
    const parent = new THREE.Group(); parent.position.x = .5;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.1, .2, .3), new THREE.MeshStandardMaterial());
    parent.add(mesh); scene.add(parent);
    const hidden = mesh.clone(); hidden.visible = false; scene.add(hidden);
    const result = isaacSnapshot(scene, camera, .9);
    expect(result.camera.matrix).toEqual(camera.matrixWorld.toArray());
    expect(result.camera.verticalFov).toBe(42);
    // BoxGeometry has six material groups, all using the same material here.
    expect(result.meshes).toHaveLength(1);
    expect((result.meshes[0] as { indices: number[] }).indices).toHaveLength(36);
    expect((result.meshes[0] as { matrix: number[] }).matrix[12]).toBe(.5);
  });
  it('expands instanced geometry with individual transforms', () => {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 16 / 9);
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial(), 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 2, 3));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 5, 6));
    scene.add(mesh);
    const result = isaacSnapshot(scene, camera, 1);
    expect(result.meshes.map(m => (m as { matrix: number[] }).matrix.slice(12, 15))).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
  it('rejects unsupported camera aspect ratios rather than misaligning labels', () => {
    expect(() => isaacSnapshot(new THREE.Scene(), new THREE.PerspectiveCamera(45, 4 / 3), 1)).toThrow('16:9');
  });
});
