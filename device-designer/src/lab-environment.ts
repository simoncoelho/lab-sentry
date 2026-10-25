import * as THREE from "three";

// Visual approximation of the captured lab, in Flex-local URDF coordinates.
// Kept outside the instrument mesh and calibration raycasts.
export function createLabBackdrop() {
  const group = new THREE.Group();
  group.name = "Reference lab surroundings";
  const box = (size: number[], position: number[], color: number, roughness = .85) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), new THREE.MeshStandardMaterial({ color, roughness }));
    mesh.position.fromArray(position); mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  };
  box([2.4, 1.7, .04], [.15, 0, -.035], 0x9e825d); // wood workbench
  box([.04, 2.8, 1.7], [.99, .25, .76], 0xc7c2ae); // warm painted wall
  // Subtle masonry joints visible through the clear right enclosure.
  for (let z = .15; z < 1.5; z += .20) box([.002, 2.8, .003], [.968, .25, z], 0xada997);
  for (let row = 0; row < 8; row++) for (let y = -1; y < 1.6; y += .4)
    box([.002, .003, .197], [.967, y + (row % 2) * .2, .05 + row * .2], 0xb6b19e);
  for (const [x, y, z, width, depth, height] of [
    [.69, .14, .12, .32, .38, .23], [.72, .18, .345, .27, .31, .22], [.72, .16, .545, .25, .29, .17],
  ]) {
    box([width, depth, height], [x, y, z], 0x9a754a);
    box([width + .001, .024, .001], [x, y, z + height / 2 + .001], 0xb39a6d);
    box([.001, depth * .58, height * .55], [x - width / 2 - .001, y, z], 0xdcdccf);
    box([.002, depth * .58, height * .10], [x - width / 2 - .002, y, z + height * .22], 0x58a6ac);
  }
  return group;
}

// Broad ceiling panels generate real rough-metal reflections instead of flat
// diffuse fill. The map is procedural, with no photograph baked onto geometry.
export function createLabReflections(renderer: THREE.WebGLRenderer, tint = [1, 1, 1]) {
  const room = new THREE.Scene();
  const shell = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), new THREE.MeshBasicMaterial({ color: 0xbcbeb5, side: THREE.BackSide }));
  shell.position.y = 1; room.add(shell);
  for (const x of [-1.4, 1.4]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 3.35, 3.15), side: THREE.DoubleSide }));
    panel.rotation.x = Math.PI / 2; panel.position.set(x, 3.4, 0); room.add(panel);
  }
  room.traverse(object => { if (object instanceof THREE.Mesh) (object.material as THREE.MeshBasicMaterial).color.multiply(new THREE.Color(...tint as [number, number, number])); });
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(room, .06, .1, 20);
  generator.dispose();
  room.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
  return target;
}
