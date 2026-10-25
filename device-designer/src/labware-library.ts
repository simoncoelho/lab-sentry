import type { ClassifierDesign } from './classifier';
import type { DatasetAsset } from './dataset';

export function labwareLibrary(design: ClassifierDesign): DatasetAsset[] {
  const tipClass = design.classes.find(c => /tip.?rack/i.test(c.name))?.id ?? '';
  const plateClass = design.classes.find(c => /plate/i.test(c.name))?.id ?? '';
  const reservoirClass = design.classes.find(c => /reservoir/i.test(c.name))?.id ?? '';
  const base = './models/labware/';
  const source = 'https://github.com/Opentrons/opentrons/blob/ed9bab4896d3a7440e8e5bef4bc40ca0bb071802/shared-data/labware/definitions/2/';
  return [
    { id: 'library-nest-deep-96', name: 'NEST 2 mL deep-well plate (candidate)', kind: 'plate', classId: plateClass, widthMm: 127.76, up: 'Z', definitionUrl: base + 'nest_96_wellplate_2ml_deep.json', source: source + 'nest_96_wellplate_2ml_deep/1.json', fidelity: 'Live clear labware candidate - definition approximation; SKU unconfirmed' },
    { id: 'library-flex-filter-200', name: 'Flex 200 µL filter tips', kind: 'tiprack', classId: tipClass, widthMm: 127.75, up: 'Z', definitionUrl: base + 'opentrons_flex_96_filtertiprack_200ul.json', source: source + 'opentrons_flex_96_filtertiprack_200ul/1.json', fidelity: 'Photo match · definition-based approximation' },
    ...([50, 1000] as const).map(volume => ({ id: `library-flex-filter-${volume}`, name: `Flex ${volume} uL filter tips`, kind: 'tiprack' as const, classId: tipClass, widthMm: 127.75, up: 'Z' as const, definitionUrl: base + `opentrons_flex_96_filtertiprack_${volume}ul.json`, source: source + `opentrons_flex_96_filtertiprack_${volume}ul/1.json`, fidelity: 'Live camera label match - definition approximation' })),
    { id: 'library-nest-12', name: 'NEST 12-channel 15 mL reservoir', kind: 'reservoir', classId: reservoirClass, widthMm: 127.76, up: 'Z', definitionUrl: base + 'nest_12_reservoir_15ml.json', source: source + 'nest_12_reservoir_15ml/1.json', fidelity: '12-channel form matches live deck - definition approximation' },
    { id: 'library-ot-10', name: 'Opentrons 10 µL non-filter tips', kind: 'tiprack', classId: tipClass, widthMm: 127.76, up: 'Z', definitionUrl: base + 'opentrons_96_tiprack_10ul.json', source: source + 'opentrons_96_tiprack_10ul/1.json', fidelity: 'OT-2 product · definition-based approximation' },
    { id: 'library-costar-96', name: 'Corning Costar 96-well plate', kind: 'glb', classId: plateClass, widthMm: 127.76, up: 'Y', modelUrl: base + 'corning-costar-96.glb', source: 'https://github.com/stefangolas/LabwareModels/blob/3b2ad88859cf231d75aa6f187e672bcaebbdab46/corning/costar_96w.glb', fidelity: 'Existing community GLB · photo identity unconfirmed' },
    { id: 'library-nest-96', name: 'NEST 200 µL flat plate (candidate)', kind: 'plate', classId: plateClass, widthMm: 127.76, up: 'Z', definitionUrl: base + 'nest_96_wellplate_200ul_flat.json', source: source + 'nest_96_wellplate_200ul_flat/1.json', fidelity: 'D3 candidate · definition-based approximation' },
    { id: 'library-nest-195', name: 'NEST 195 mL reservoir (candidate)', kind: 'reservoir', classId: reservoirClass, widthMm: 127.76, up: 'Z', definitionUrl: base + 'nest_1_reservoir_195ml.json', source: source + 'nest_1_reservoir_195ml/1.json', fidelity: 'Unconfirmed photo identity · definition approximation' },
  ];
}
