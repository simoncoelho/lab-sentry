import { describe,it,expect } from 'vitest';
import * as THREE from 'three';
import { createFlexTip200,createFlexTip200Array } from './flex-tip-200';

describe('Flex 200 uL tip',()=>{
  it('matches the dimensioned envelope and leaves the outlet open',()=>{
    const tip=createFlexTip200();
    const size=new THREE.Box3().setFromObject(tip).getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(58.35,3);expect(size.x).toBeCloseTo(7.8,3);expect(size.y).toBeCloseTo(7.8,3);
    const p=(tip.children[0] as THREE.Mesh).geometry.getAttribute('position');
    const outlet=[];
    for(let i=0;i<p.count;i++)if(Math.abs(p.getZ(i))<.00001)outlet.push(Math.hypot(p.getX(i),p.getY(i)));
    expect(Math.min(...outlet)).toBeCloseTo(.27,3);expect(Math.max(...outlet)).toBeCloseTo(.48,3);
  });
  it('places 96 tips without 96 separate draw calls and keeps filter optional',()=>{
    const positions=Array.from({length:96},(_,i)=>({x:(i%12)*9,y:Math.floor(i/12)*9,z:40.65}));
    const rack=createFlexTip200Array(positions);
    expect(rack.children).toHaveLength(2);
    for(const child of rack.children)expect((child as THREE.InstancedMesh).count).toBe(96);
    expect(new THREE.Box3().setFromObject(rack).max.z).toBeCloseTo(99,3);
    expect(createFlexTip200(false).children).toHaveLength(1);
  });
});
