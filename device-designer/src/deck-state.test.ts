import { it, expect } from 'vitest';
import { completeDeckState, inferSlotState, slotYoloLabel } from './deck-state';

const observation = { slot: 'D1', inFrame: true, visibility: 1, occupied: false, recognized: false, classId: null, assetId: null, polygon: [[0, 0], [128, 0], [128, 72], [0, 72]] };
it('reports empty only when the slot is clear and unoccupied', () => {
  expect(inferSlotState(observation).state).toBe('empty');
  expect(inferSlotState({ ...observation, visibility: 6 / 9 }).state).toBe('obscured');
  expect(inferSlotState({ ...observation, occupied: true }).state).toBe('unknown');
});
it('does not leak hidden scene truth into an observed occupied or empty label', () => {
  const state = inferSlotState({ ...observation, occupied: true, visibility: 0, classId: 'tiprack', assetId: 'rack' });
  expect(state.state).toBe('obscured'); expect(state.classId).toBeNull(); expect(state.assetId).toBeNull(); expect(state.truth).toBe('occupied');
  expect(inferSlotState({ ...observation, inFrame: false }).state).toBe('unknown');
  expect(inferSlotState({ ...observation, occupied: true, recognized: true, visibility: .2 }).state).toBe('occupied');
});
it('always reports twelve positions, with unknown for absent and legacy observations', () => {
  const states = completeDeckState({ slotStateVersion: 1, slotStates: [inferSlotState(observation)] });
  expect(states).toHaveLength(12); expect(new Set(states.map(s => s.slot)).size).toBe(12);
  expect(states.find(s => s.slot === 'A3')!.state).toBe('unknown');
  expect(states.filter(s => s.state === 'unknown')).toHaveLength(11);
  expect(completeDeckState({}).every(s => s.state === 'unknown' && s.truth === null)).toBe(true);
});
it('labels empty and obscured slot regions, clips partial views, and omits unprojectable regions', () => {
  expect(slotYoloLabel([inferSlotState(observation)])).toBe('1 0.050000 0.050000 0.100000 0.100000');
  expect(slotYoloLabel([inferSlotState({ ...observation, visibility: 0 })])).toMatch(/^2 /);
  expect(slotYoloLabel([inferSlotState({ ...observation, inFrame: false, polygon: [[-100, 0], [128, 72]] })])).toBe('3 0.050000 0.050000 0.100000 0.100000');
  expect(slotYoloLabel(completeDeckState({}))).toBe('');
});
