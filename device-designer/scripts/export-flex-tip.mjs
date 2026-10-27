import { writeFile } from 'node:fs/promises';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createFlexTip200 } from '../src/flex-tip-200.ts';

// GLTFExporter uses this browser interface for its embedded binary buffer.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();}); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.();}); }
};
const tip=createFlexTip200(); tip.scale.setScalar(.001);
tip.userData={source:'Opentrons Flex 200 uL technical drawing, April 2024; user rack photos',
  lengthMm:58.35,maxDiameterMm:7.8,estimated:['wall thickness','rib count','filter dimensions and location','optical properties']};
const glb=await new GLTFExporter().parseAsync(tip,{binary:true});
await writeFile(new URL('../models/labware/opentrons-flex-200ul-filter-tip.glb',import.meta.url),Buffer.from(glb));
console.log(`Exported ${glb.byteLength} bytes; metres, +Z from outlet to mouth.`);
