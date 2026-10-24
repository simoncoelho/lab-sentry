export type InstrumentId = "flex" | "ot2" | "tiny2";
export type JointSpec = {
  name: string;
  label: string;
  type: string;
  lower: number;
  upper: number;
  initial: number;
};
export type Pose = {
  x: number;
  y: number;
  z: number;
  roll: number;
  pitch: number;
  yaw: number;
};
export type InstrumentState = {
  present: boolean;
  visible: boolean;
  pose: Pose;
  joints: Record<string, number>;
};
export type Workspace = Record<InstrumentId, InstrumentState>;
export const instruments: {
  id: InstrumentId;
  name: string;
  maker: string;
  category: string;
  path: string;
  description: string;
  source: string;
  notice: string;
  pose: Pose;
}[] = [
  {
    id: "flex",
    name: "Flex",
    maker: "OPENTRONS",
    category: "Liquid handler",
    path: "opentrons_flex/opentrons_flex.urdf",
    description: "8-channel pipette · gripper · folding door",
    source: "https://docs.opentrons.com/flex/system-description/",
    notice: "Supplied CAD conversion · photo-informed reconstruction",
    pose: { x: -0.55, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 },
  },
  {
    id: "ot2",
    name: "OT-2",
    maker: "OPENTRONS",
    category: "Liquid handler",
    path: "opentrons_ot2/opentrons_ot2.urdf",
    description: "Three-axis gantry · independent carriage motion",
    source: "https://github.com/EmilFox231007/Y2B-2023-OT2_Twin",
    notice: "Community model · Y2B OT2 Twin · no upstream license supplied",
    pose: { x: 0.55, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 },
  },
  {
    id: "tiny2",
    name: "Tiny 2",
    maker: "OBSBOT",
    category: "Tracking camera",
    path: "obsbot_tiny_2/obsbot_tiny_2.urdf",
    description: "Two-axis gimbal · pan and tilt",
    source: "https://www.obsbot.com/obsbot-tiny-2-4k-webcam",
    notice: "Drawing-derived reconstruction · estimated internal geometry",
    pose: { x: 0, y: -0.6, z: 0, roll: 0, pitch: 0, yaw: -90 },
  },
];
export const jointLabels: Record<string, string> = {
  gantry_y_joint: "Gantry Y",
  carriage_x_joint: "Carriage X",
  carriage_z_joint: "Carriage Z",
  gripper_z_joint: "Gripper Z",
  rear_power_rocker_joint: "Power rocker",
  front_door_lift_joint: "Door lift",
  front_door_fold_joint: "Door fold",
  Slider_3: "Gantry X",
  Slider_4: "Carriage Y",
  Slider_5: "Toolhead Z",
  obsbot_pan_joint: "Pan",
  obsbot_tilt_joint: "Tilt",
};
export function createWorkspace(): Workspace {
  return Object.fromEntries(
    instruments.map((i) => [
      i.id,
      { present: i.id === "flex", visible: true, pose: { ...i.pose }, joints: {} },
    ]),
  ) as Workspace;
}
export function clamp(value: number, lower: number, upper: number) {
  return Math.min(upper, Math.max(lower, value));
}
// Convert renderer Y-up translation into the workspace's URDF Z-up frame.
export function translatedPose(
  pose: Pose,
  position: { x: number; y: number; z: number },
): Pose {
  if (![position.x, position.y, position.z].every(Number.isFinite)) return pose;
  return {
    ...pose,
    x: clamp(position.x, -3, 3),
    y: clamp(-position.z, -3, 3),
    z: clamp(position.y, 0, 3),
  };
}
export function setInstrumentPresent(
  workspace: Workspace,
  id: InstrumentId,
  present: boolean,
): Workspace {
  return {
    ...workspace,
    [id]: {
      ...workspace[id],
      present,
      visible: present ? true : workspace[id].visible,
    },
  };
}
export function updateJoint(
  workspace: Workspace,
  id: InstrumentId,
  joint: JointSpec,
  value: number,
): Workspace {
  if (!Number.isFinite(value)) return workspace;
  return {
    ...workspace,
    [id]: {
      ...workspace[id],
      joints: {
        ...workspace[id].joints,
        [joint.name]: clamp(value, joint.lower, joint.upper),
      },
    },
  };
}
export function resetInstrument(
  workspace: Workspace,
  id: InstrumentId,
  joints: JointSpec[],
): Workspace {
  return {
    ...workspace,
    [id]: {
      present: workspace[id].present,
      visible: true,
      pose: { ...instruments.find((i) => i.id === id)!.pose },
      joints: Object.fromEntries(joints.map((j) => [j.name, j.initial])),
    },
  };
}
export function displayValue(value: number, joint: JointSpec) {
  return joint.type === "prismatic" ? value * 1000 : (value * 180) / Math.PI;
}
export function nativeValue(value: number, joint: JointSpec) {
  return joint.type === "prismatic" ? value / 1000 : (value * Math.PI) / 180;
}
