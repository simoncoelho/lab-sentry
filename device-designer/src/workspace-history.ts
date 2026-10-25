import { parseWorkspace, STORAGE_KEY, type SavedWorkspace } from './workspace-file';
const HISTORY_KEY = 'lab-sentry.workspace-history.v1';
export function workspaceHistory(): SavedWorkspace[] {
  const stored: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  if (!Array.isArray(stored)) throw new Error('Workspace history is unreadable. Export your current setup before clearing browser storage.');
  const history = stored.map(value => parseWorkspace(JSON.stringify(value)));
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) {
    const saved = parseWorkspace(current);
    if (!history.some(item => JSON.stringify(item) === JSON.stringify(saved))) history.unshift(saved);
  }
  return history.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export function rememberWorkspace(next: SavedWorkspace) {
  const history = workspaceHistory();
  const same = (item: SavedWorkspace) => JSON.stringify({ ...item, savedAt: '' }) === JSON.stringify({ ...next, savedAt: '' });
  localStorage.setItem(HISTORY_KEY, JSON.stringify([next, ...history.filter(item => !same(item))]));
}
