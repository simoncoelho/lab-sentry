import type { LiveKind } from './live-labware';

// Repeatable test layouts: empty, sparse, mixed, and crowded decks.
export function simulationLayout(iteration: number): Record<string, LiveKind> {
  const slots = 'ABCD'.split('').flatMap(row => [1, 2, 3].map(column => `${row}${column}`)).filter(slot => slot !== 'A3');
  const kinds: LiveKind[] = ['tiprack', 'plate', 'reservoir'];
  let seed = (iteration + 1) * 7919;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const count = [3, 5, 1, 8, 0, 11][iteration % 6];
  return Object.fromEntries(slots.slice(0, count).map((slot, i) => [slot, kinds[(iteration + i) % kinds.length]]));
}
