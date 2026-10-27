import { describe, expect, it } from 'vitest';
import { simulationLayout } from './simulation-layout';

describe('simulation scenarios', () => {
  it('covers empty and crowded decks without replacing the waste bin', () => {
    const layouts = Array.from({ length: 12 }, (_, i) => simulationLayout(i));
    expect(layouts.some(layout => Object.keys(layout).length === 0)).toBe(true);
    expect(layouts.some(layout => Object.keys(layout).length === 11)).toBe(true);
    for (const layout of layouts) {
      expect(layout).not.toHaveProperty('A3');
      expect(Object.keys(layout).every(slot => /^[ABCD][123]$/.test(slot))).toBe(true);
    }
    expect(new Set(layouts.flatMap(Object.values))).toEqual(new Set(['tiprack', 'plate', 'reservoir']));
  });
  it('replays layouts consistently and varies placements between cycles', () => {
    expect(simulationLayout(1)).toEqual(simulationLayout(1));
    expect(simulationLayout(1)).not.toEqual(simulationLayout(7));
  });
});
