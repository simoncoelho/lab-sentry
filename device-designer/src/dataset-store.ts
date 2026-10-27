import type { GenerationPlan } from './generation-plan';
import type { ImageProcessing } from './image-processing';
import type { CameraRange, DatasetAsset, DatasetFrame } from './dataset';
import type { SavedWorkspace } from './workspace-file';
export type DatasetRun = { renderer?: 'browser' | 'isaac'; generationStats?: { images: number; seconds: number; completedAt: string }; generationMode?: 'bulk' | 'directed'; generationPlans?: { revision: number; plan: GenerationPlan; feedback: string[]; atIndex: number }[]; processing?: ImageProcessing; cameraRange?: CameraRange; id: string; signature: string; context: SavedWorkspace; assets: DatasetAsset[]; sourceAssets?: DatasetAsset[]; emptyClass: string; target: number; split: 'train' | 'validation' | 'test'; feedback: string[]; createdAt: string };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lab-sentry-datasets', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('runs', { keyPath: 'id' });
      const frames = request.result.createObjectStore('frames', { keyPath: 'id' });
      frames.createIndex('runId', 'runId');
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function write(store: string, value: DatasetRun | DatasetFrame) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
export const saveRun = (value: DatasetRun) => write('runs', value);
export const saveFrame = (value: DatasetFrame) => write('frames', value);
export async function loadRuns(): Promise<DatasetRun[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const r = db.transaction('runs').objectStore('runs').getAll(); r.onsuccess = () => resolve(r.result.sort((a: DatasetRun, b: DatasetRun) => b.createdAt.localeCompare(a.createdAt))); r.onerror = () => reject(r.error); }); }
  finally { db.close(); }
}
export async function loadFrames(runId: string): Promise<DatasetFrame[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const r = db.transaction('frames').objectStore('frames').index('runId').getAll(runId); r.onsuccess = () => resolve(r.result.sort((a: DatasetFrame, b: DatasetFrame) => a.index - b.index)); r.onerror = () => reject(r.error); }); }
  finally { db.close(); }
}
