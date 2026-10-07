export const LOGICAL_JOINTS = [
  "pelvis",
  "spine01",
  "spine02",
  "chest",
  "neck",
  "head",

  "clavicle_L",
  "upperArm_L",
  "foreArm_L",
  "hand_L",

  "clavicle_R",
  "upperArm_R",
  "foreArm_R",
  "hand_R",

  "thigh_L",
  "shin_L",
  "foot_L",
  "toe_L",

  "thigh_R",
  "shin_R",
  "foot_R",
  "toe_R",
];

export const CANONICAL_JOINTS = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",

  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",

  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand",

  "LeftHandThumb1",
  "LeftHandThumb2",
  "LeftHandThumb3",

  "LeftHandIndex1",
  "LeftHandIndex2",
  "LeftHandIndex3",

  "LeftHandMiddle1",
  "LeftHandMiddle2",
  "LeftHandMiddle3",

  "LeftHandRing1",
  "LeftHandRing2",
  "LeftHandRing3",

  "LeftHandPinky1",
  "LeftHandPinky2",
  "LeftHandPinky3",

  "RightHandThumb1",
  "RightHandThumb2",
  "RightHandThumb3",

  "RightHandIndex1",
  "RightHandIndex2",
  "RightHandIndex3",

  "RightHandMiddle1",
  "RightHandMiddle2",
  "RightHandMiddle3",

  "RightHandRing1",
  "RightHandRing2",
  "RightHandRing3",

  "RightHandPinky1",
  "RightHandPinky2",
  "RightHandPinky3",

  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "LeftToeBase",

  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "RightToeBase",
];

export const BONE_MAP = {
  pelvis: "Hips",
  spine01: "Spine",
  spine02: "Spine1",
  chest: "Spine2",
  neck: "Neck",
  head: "Head",

  clavicle_L: "LeftShoulder",
  upperArm_L: "LeftArm",
  foreArm_L: "LeftForeArm",
  hand_L: "LeftHand",

  clavicle_R: "RightShoulder",
  upperArm_R: "RightArm",
  foreArm_R: "RightForeArm",
  hand_R: "RightHand",

  thigh_L: "LeftUpLeg",
  shin_L: "LeftLeg",
  foot_L: "LeftFoot",
  toe_L: "LeftToeBase",

  thigh_R: "RightUpLeg",
  shin_R: "RightLeg",
  foot_R: "RightFoot",
  toe_R: "RightToeBase",
};

if (CANONICAL_JOINTS.length !== 52) {
  throw new Error(
    `Canonical joint contract broken: expected 52, got ${CANONICAL_JOINTS.length}`
  );
}

if (LOGICAL_JOINTS.length !== 22) {
  throw new Error(
    `Logical joint contract broken: expected 22, got ${LOGICAL_JOINTS.length}`
  );
}
