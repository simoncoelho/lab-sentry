import { deckSlots } from './classifier';
import type { DatasetFrame } from './dataset';

export type SlotState = {
  slot: string;
  state: 'occupied' | 'empty' | 'obscured' | 'unknown';
  reason: string;
  classId: string | null;
  assetId: string | null;
  visibility: number;
  polygon: number[][] | null;
  truth: 'occupied' | 'empty' | null;
};
export function inferSlotState(input: { slot: string; inFrame: boolean; visibility: number; occupied: boolean; recognized: boolean; classId: string | null; assetId: string | null; polygon: number[][] | null }): SlotState {
  const { slot, visibility, polygon, occupied, recognized, classId, assetId } = input;
  const state = recognized && occupied ? 'occupied' : !input.inFrame ? 'unknown' : visibility < 8 / 9 ? 'obscured' : occupied ? 'unknown' : 'empty';
  return { slot, state, reason: state === 'occupied' ? 'visible_labware' : state === 'empty' ? 'clear_deck' : state === 'obscured' ? 'blocked_view' : !input.inFrame ? 'outside_or_partial_view' : 'unrecognized_labware', classId: state === 'occupied' ? classId : null, assetId: state === 'occupied' ? assetId : null, visibility, polygon, truth: occupied ? 'occupied' : 'empty' };
}
export function completeDeckState(frame: Pick<DatasetFrame, 'slotStates' | 'slotStateVersion'>): SlotState[] {
  return deckSlots.map(slot => (frame.slotStateVersion === 1 ? frame.slotStates?.find(s => s.slot === slot) : undefined) ?? { slot, state: 'unknown', reason: 'missing_slot_observation', classId: null, assetId: null, visibility: 0, polygon: null, truth: null });
}
export const slotStateNames = ['occupied', 'empty', 'obscured', 'unknown'] as const;
export function slotYoloLabel(states: SlotState[]) {
  return states.flatMap(s => {
    if (!s.polygon?.length || !s.polygon.flat().every(Number.isFinite)) return [];
    const left = Math.max(0, Math.min(...s.polygon.map(p => p[0]))), right = Math.min(1280, Math.max(...s.polygon.map(p => p[0])));
    const top = Math.max(0, Math.min(...s.polygon.map(p => p[1]))), bottom = Math.min(720, Math.max(...s.polygon.map(p => p[1])));
    if (right - left < 2 || bottom - top < 2) return [];
    return [`${slotStateNames.indexOf(s.state)} ${[(left + right) / 2560, (top + bottom) / 1440, (right - left) / 1280, (bottom - top) / 720].map(v => v.toFixed(6)).join(' ')}`];
  }).join('\n');
}
