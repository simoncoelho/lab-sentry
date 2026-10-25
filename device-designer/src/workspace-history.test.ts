import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace } from './state';
import { snapshot, STORAGE_KEY } from './workspace-file';
import { rememberWorkspace, workspaceHistory } from './workspace-history';
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
const setup = () => snapshot('Lab', createWorkspace(), { acrylicVisible: false, grid: true });
it('preserves the legacy saved setup when another setup is saved', () => {
  const old = setup(); localStorage.setItem(STORAGE_KEY, JSON.stringify(old));
  const next = { ...setup(), name: 'New lab' }; rememberWorkspace(next);
  expect(workspaceHistory().map(w => w.name)).toEqual(expect.arrayContaining(['Lab', 'New lab']));
});
it('retains changed calibration revisions but deduplicates identical saves', () => {
  const old = setup(); rememberWorkspace(old);
  rememberWorkspace({ ...old, savedAt: '2026-10-25T12:00:00.000Z' });
  expect(workspaceHistory()).toHaveLength(1);
  rememberWorkspace({ ...old, view: { ...old.view, horizontalFov: 75 } });
  expect(workspaceHistory()).toHaveLength(2);
});
it('does not overwrite a corrupt history', () => {
  localStorage.setItem('lab-sentry.workspace-history.v1', '{broken');
  expect(() => rememberWorkspace(setup())).toThrow();
  expect(localStorage.getItem('lab-sentry.workspace-history.v1')).toBe('{broken');
});
