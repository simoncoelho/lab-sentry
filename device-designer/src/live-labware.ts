import * as THREE from 'three';
import type { DatasetAsset } from './dataset';
import { loadDatasetAsset } from './dataset-assets';

export type LiveKind = 'tiprack' | 'plate' | 'reservoir';

// Digital twins of the labware the deck-check protocol loads, built from the
// Opentrons definitions (true footprint, height and tip/well positions).
const liveAssets: Record<LiveKind, DatasetAsset> = {
  tiprack: { id: 'library-flex-filter-200', name: 'Flex 200 µL filter tips', kind: 'tiprack', classId: '', widthMm: 127.75, up: 'Z', definitionUrl: './models/labware/opentrons_flex_96_filtertiprack_200ul.json' },
  plate: { id: 'live-corning-96-360', name: 'Corning 96-well 360 µL flat plate', kind: 'plate', classId: '', widthMm: 127.76, up: 'Z', definitionUrl: './models/labware/corning_96_wellplate_360ul_flat.json' },
  reservoir: { id: 'library-nest-12', name: 'NEST 12-channel 15 mL reservoir', kind: 'reservoir', classId: '', widthMm: 127.76, up: 'Z', definitionUrl: './models/labware/nest_12_reservoir_15ml.json' },
};
export function detailedLiveLabware(kind: LiveKind): Promise<THREE.Group> { return loadDatasetAsset(liveAssets[kind]); }

// Lightweight class silhouettes, shown until the detailed models have loaded
// (or if a definition can't be loaded).
export function liveLabware(kind: LiveKind): THREE.Group {
  const root = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: '#a5a8ad', roughness: .65 });
  const inset = new THREE.MeshStandardMaterial({ color: '#646970', roughness: .8 });
  const box = (w:number,d:number,h:number,x:number,y:number,z:number,material= shell) => {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,d,h),material); mesh.position.set(x,y,z);root.add(mesh);
  };
  const w=.128,d=.086,h=kind==='tiprack'?.052:kind==='reservoir'?.035:.016;
  box(w,d,.006,0,0,.003,inset);
  if(kind==='tiprack'){
    // Low skirt, inset tray, and 96 hollow tip mouths make the rack readable
    // from above without the detailed training mesh's individual tubes/wells.
    const trayZ=h-.009;
    box(w-.006,d-.006,trayZ-.006,0,0,(trayZ+.006)/2,inset);
    box(w-.002,.003,.012,0,-d/2+.0015,trayZ-.004);
    box(w-.002,.003,.012,0,d/2-.0015,trayZ-.004);
    box(.003,d-.006,.012,-w/2+.0015,0,trayZ-.004);
    box(.003,d-.006,.012,w/2-.0015,0,trayZ-.004);
    box(w-.010,d-.010,.002,0,0,trayZ-.001);
    // Three instanced meshes for the whole 8 x 12 array, at 9 mm pitch.
    const tipsGeometry=new THREE.CylinderGeometry(.003,.0024,.008,10,1,true);
    tipsGeometry.rotateX(-Math.PI/2);
    const tips=new THREE.InstancedMesh(tipsGeometry,shell,96);
    const rims=new THREE.InstancedMesh(new THREE.RingGeometry(.00215,.003,10),shell,96);
    const openings=new THREE.InstancedMesh(new THREE.CircleGeometry(.00215,10),inset,96);
    const matrix=new THREE.Matrix4();
    for(let row=0;row<8;row++)for(let column=0;column<12;column++){
      const index=row*12+column,x=(column-5.5)*.009,y=(row-3.5)*.009;
      tips.setMatrixAt(index,matrix.makeTranslation(x,y,trayZ+.004));
      rims.setMatrixAt(index,matrix.makeTranslation(x,y,trayZ+.008));
      openings.setMatrixAt(index,matrix.makeTranslation(x,y,trayZ+.0001));
    }
    tips.instanceMatrix.needsUpdate=true;rims.instanceMatrix.needsUpdate=true;
    openings.instanceMatrix.needsUpdate=true;
    root.add(tips,rims,openings);
  }else{
    box(.004,d,h,-w/2+.002,0,h/2);box(.004,d,h,w/2-.002,0,h/2);
    box(w-.008,.004,h,0,-d/2+.002,h/2);box(w-.008,.004,h,0,d/2-.002,h/2);
    if(kind==='reservoir')for(let i=1;i<4;i++)box(.002,d-.008,h-.006,-w/2+i*w/4,0,(h+.006)/2);
  }
  return root;
}
