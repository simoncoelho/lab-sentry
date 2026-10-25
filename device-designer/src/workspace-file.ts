import { instruments, type Workspace } from "./state";
import type { Lighting } from "./lighting-match";

export const STORAGE_KEY = "lab-sentry.workspace.v1";
export type SavedWorkspace = {
  version: 1;
  name: string;
  savedAt: string;
  workspace: Workspace;
  view: { acrylicVisible: boolean; grid: boolean; horizontalFov?: number; lighting?: Lighting };
};
export function snapshot(name: string, workspace: Workspace, view: SavedWorkspace["view"]): SavedWorkspace {
  return { version: 1, name: name.trim() || "Untitled workspace", savedAt: new Date().toISOString(), workspace: structuredClone(workspace), view: { ...view } };
}
export function parseWorkspace(raw: string): SavedWorkspace {
  const data = JSON.parse(raw) as SavedWorkspace;
  if (data?.version !== 1 || typeof data.name !== "string" || !data.name.trim() ||
      typeof data.savedAt !== "string" || !Number.isFinite(Date.parse(data.savedAt)) ||
      typeof data.view?.acrylicVisible !== "boolean" || typeof data.view?.grid !== "boolean") throw new Error("Invalid workspace file.");
  if (data.view.horizontalFov !== undefined && (!Number.isFinite(data.view.horizontalFov) || data.view.horizontalFov < 30 || data.view.horizontalFov > 120)) throw new Error("Invalid camera field of view.");
  const lighting = data.view.lighting;
  if (lighting !== undefined && (!lighting || !Number.isFinite(lighting.exposure) || lighting.exposure < .3 || lighting.exposure > 2.5 || !Array.isArray(lighting.tint) || lighting.tint.length !== 3 || !lighting.tint.every(v => Number.isFinite(v) && v >= .7 && v <= 1.3))) throw new Error("Invalid lighting settings.");
  for (const { id } of instruments) {
    const state = data.workspace?.[id];
    if (!state || typeof state.present !== "boolean" || typeof state.visible !== "boolean" ||
        !state.pose || !["x", "y", "z", "roll", "pitch", "yaw"].every(key => typeof state.pose[key as keyof typeof state.pose] === "number" && Number.isFinite(state.pose[key as keyof typeof state.pose])) ||
        !state.joints || typeof state.joints !== "object" || Array.isArray(state.joints) ||
        !Object.values(state.joints).every(value => typeof value === "number" && Number.isFinite(value))) throw new Error("Invalid instrument configuration.");
  }
  return data;
}
export function matchesSaved(saved: SavedWorkspace | null, name: string, workspace: Workspace, view: SavedWorkspace["view"]) {
  return !!saved && saved.name === (name.trim() || "Untitled workspace") &&
    JSON.stringify(saved.workspace) === JSON.stringify(workspace) && JSON.stringify(saved.view) === JSON.stringify(view);
}
