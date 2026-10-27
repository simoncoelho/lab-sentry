import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Millimetres, +Z from outlet to mouth. See models/labware/flex-tip-200.md.
export const FLEX_TIP_200 = { length: 58.35, collarStart: 52.35, diameter: 7.8, outletDiameter: .96 } as const;

export function createFlexTip200Parts(segments = 64) {
  // Profile traced from the manufacturer drawing. Inner wall is estimated.
  const outer = [[.48,0],[.49,.3],[1.93,17.9],[1.98,18.2],[2.22,37.9],
    [2.25,38.15],[2.72,39.05],[2.77,39.3],[3.00,52.15],
    [3.08,52.35],[3.58,52.35],[3.64,52.48],[3.64,58.12],
    [3.60,58.29],[3.48,58.35]];
  const inner = [[3.16,58.35],[3.07,58.22],[3.03,57.9],[2.91,52.55],
    [2.67,51.9],[2.43,39.45],[1.91,38.35],[1.67,18.25],[.27,.3],[.27,0],[.48,0]];
  const shell = new THREE.LatheGeometry([...outer,...inner].map(([r,z])=>new THREE.Vector2(r,z)),segments);
  shell.rotateX(Math.PI/2);
  // Twelve longitudinal collar ribs, with softened ends, visible in the drawing/photos.
  const pieces: THREE.BufferGeometry[] = [shell];
  for(let i=0;i<12;i++) {
    const rib = new THREE.CapsuleGeometry(.24,4.94,4,8);
    rib.rotateX(Math.PI/2);
    const angle=i*Math.PI/6;
    rib.translate(3.66*Math.cos(angle),3.66*Math.sin(angle),55.35);
    pieces.push(rib);
  }
  const geometry=mergeGeometries(pieces,false)!;
  pieces.forEach(p=>p.dispose());
  // Almost all light passes through the wall; a diffuse component made the
  // previous version read as frosted grey plastic. Geometry supplies the rim.
  const plastic=new THREE.MeshPhysicalMaterial({name:'Clear polypropylene',color:'#ffffff',
    roughness:.08,metalness:0,transmission:1,thickness:.00025,ior:1.49,
    attenuationColor:'#ffffff',attenuationDistance:Infinity,clearcoat:0});
  const filterGeometry=new THREE.CylinderGeometry(2.68,2.59,3.8,32);
  filterGeometry.rotateX(Math.PI/2); filterGeometry.translate(0,0,49.35);
  const filter=new THREE.MeshStandardMaterial({name:'Porous white filter',color:'#f2f0e8',roughness:.95});
  return [{geometry,material:plastic,name:'Tip shell and collar'},
    {geometry:filterGeometry,material:filter,name:'Filter insert'}];
}

export function createFlexTip200(filtered = true) {
  const root=new THREE.Group(); root.name='Opentrons Flex 200 uL tip';
  for(const part of createFlexTip200Parts()) {
    if(!filtered && part.name==='Filter insert') {part.geometry.dispose();part.material.dispose();continue;}
    const mesh=new THREE.Mesh(part.geometry,part.material);mesh.name=part.name;
    root.add(mesh);
  }
  return root;
}

export function createFlexTip200Array(positions: {x:number;y:number;z:number}[]) {
  const root=new THREE.Group();root.name='Flex 200 uL filter tips';
  for(const part of createFlexTip200Parts(40)) {
    const mesh=new THREE.InstancedMesh(part.geometry,part.material,positions.length);
    mesh.name=part.name;
    const matrix=new THREE.Matrix4();
    positions.forEach((p,i)=>mesh.setMatrixAt(i,matrix.makeTranslation(p.x,p.y,p.z)));
    mesh.instanceMatrix.needsUpdate=true;root.add(mesh);
  }
  return root;
}
