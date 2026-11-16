
import * as THREE from "three";

import {
  Constraint,
  CONSTRAINT_TYPE,
} from "../character/Constraint.js";

import {
  ConstraintSet,
} from "../character/ConstraintSet.js";

import {
  ConstraintSolver,
} from "../character/ConstraintSolver.js";

import {
  PoseWriter,
} from "../character/PoseWriter.js";

const FRAME_COUNT = 60;
const MOVE_FRAMES = 30;

const MAX_ANCHOR_DRIFT = 0.02;
const MAX_SWING_ERROR = 0.025;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function format(value, digits = 5) {
  return Number.isFinite(value)
    ? value.toFixed(digits)
    : "NaN";
}

function updateWorld(skeleton) {
  const first = skeleton?.bones?.[0];

  assert(first, "Gate 8B: skeleton has no bones.");

  let top = first;

  while (
    top.parent &&
    top.parent.isObject3D
  ) {
    top = top.parent;
  }

  top.updateMatrixWorld(true);
}

function findBone(skeleton, name) {
  const bone = skeleton.bones.find(
    (item) => item?.name === name
  );

  assert(
    bone,
    `Gate 8B: bone "${name}" not found.`
  );

  return bone;
}

function readPosition(bone) {
  return bone.getWorldPosition(
    new THREE.Vector3()
  );
}

function capturePose(skeleton) {
  return skeleton.bones.map((bone) => ({
    bone,
    quaternion: bone.quaternion.clone(),
  }));
}

function restorePose(snapshot, skeleton) {
  for (const item of snapshot) {
    item.bone.quaternion.copy(
      item.quaternion
    );
  }

  updateWorld(skeleton);
}

function getForward(skeleton) {
  const hips = findBone(
    skeleton,
    "Hips"
  );

  const quaternion =
    hips.getWorldQuaternion(
      new THREE.Quaternion()
    );

  const forward =
    new THREE.Vector3(0, 0, 1)
      .applyQuaternion(quaternion)
      .setY(0);

  if (forward.lengthSq() < 1e-8) {
    forward.set(0, 0, 1);
  }

  return forward.normalize();
}

function makeConstraint({
  id,
  bone,
  target,
  hard,
  priority,
}) {
  return new Constraint({
    id,

    type:
      CONSTRAINT_TYPE.POSITION,

    source:
      id,

    target,

    priority,

    weight: 1,

    hard,

    enabled: true,

    tolerance: 0.005,

    metadata: {
      bone: bone.name,

      effectorPosition:
        target.toArray(),

      isSupport: hard,
    },
  });
}

function runTrial({
  skeleton,
  anchorBone,
  swingBone,
  baseline,
  forward,
}) {
  restorePose(
    baseline,
    skeleton
  );

  updateWorld(skeleton);

  const anchorStart =
    readPosition(anchorBone);

  const swingStart =
    readPosition(swingBone);

  const anchorTarget =
    anchorStart.clone();

  const swingEnd =
    swingStart.clone()
      .addScaledVector(forward, 0.07)
      .add(new THREE.Vector3(0, 0.06, 0));

  /*
   * HARD anchor is inserted first.
   *
   * IMPORTANT:
   * Current ConstraintSolver does not implement
   * mathematical HARD/SOFT hierarchy.
   * This test measures actual combined behavior.
   */

  const anchorConstraint =
    makeConstraint({
      id: "gate8b:planted",
      bone: anchorBone,
      target: anchorTarget,
      hard: true,
      priority: 100,
    });

  const swingConstraint =
    makeConstraint({
      id: "gate8b:swing",
      bone: swingBone,
      target: swingStart,
      hard: false,
      priority: 50,
    });

  const constraints =
    new ConstraintSet();

  constraints.add(anchorConstraint);
  constraints.add(swingConstraint);

  const solver =
    new ConstraintSolver({
      skeleton,
      damping: 0.12,
      maxAngleStep: 0.20,
      positionTolerance: 0.005,
      enabled: true,
    });

  const writer =
    new PoseWriter({
      skeleton,
      enabled: true,
      maxRotationPerBone: 0.18,
    });

  let maxAnchorDrift = 0;
  let maxSwingError = 0;
  let totalWrites = 0;
  let lastSolverStatus = "not-run";

  for (
    let frame = 0;
    frame < FRAME_COUNT;
    frame++
  ) {
    updateWorld(skeleton);

    /*
     * Refresh actual effector positions.
     *
     * This reproduces the feedback principle
     * used by BodyStateBinder:
     * measured position is not a frozen input.
     */

    anchorConstraint.metadata.effectorPosition =
      readPosition(anchorBone).toArray();

    swingConstraint.metadata.effectorPosition =
      readPosition(swingBone).toArray();

    const progress = Math.min(
      1,
      (frame + 1) / MOVE_FRAMES
    );

    const currentTarget =
      swingStart.clone().lerp(
        swingEnd,
        progress
      );

    swingConstraint.target.copy(
      currentTarget
    );

    const solverResult =
      solver.solve(constraints);

    lastSolverStatus =
      solverResult.status;

    const writeResult =
      writer.write(solverResult);

    totalWrites +=
      writeResult.applied || 0;

    updateWorld(skeleton);

    const anchorNow =
      readPosition(anchorBone);

    const swingNow =
      readPosition(swingBone);

    const anchorDrift =
      anchorNow.distanceTo(
        anchorTarget
      );

    const swingError =
      swingNow.distanceTo(
        currentTarget
      );

    maxAnchorDrift =
      Math.max(
        maxAnchorDrift,
        anchorDrift
      );

    maxSwingError =
      Math.max(
        maxSwingError,
        swingError
      );
  }

  updateWorld(skeleton);

  const finalAnchorDrift =
    readPosition(anchorBone)
      .distanceTo(anchorTarget);

  const finalSwingError =
    readPosition(swingBone)
      .distanceTo(swingEnd);

  const finite =
    Number.isFinite(maxAnchorDrift) &&
    Number.isFinite(maxSwingError) &&
    Number.isFinite(finalAnchorDrift) &&
    Number.isFinite(finalSwingError);

  const anchorProtected =
    finite &&
    maxAnchorDrift <= MAX_ANCHOR_DRIFT;

  const swingReached =
    finite &&
    finalSwingError <= MAX_SWING_ERROR;

  return {
    anchorBone: anchorBone.name,
    swingBone: swingBone.name,

    maxAnchorDrift,
    finalAnchorDrift,

    maxSwingError,
    finalSwingError,

    totalWrites,
    lastSolverStatus,

    anchorProtected,
    swingReached,

    green:
      anchorProtected &&
      swingReached &&
      totalWrites > 0,
  };
}

export function runClosedChainMultiEffector({
  skeleton,
  statusElement = null,
} = {}) {
  assert(
    skeleton?.bones?.length,
    "Gate 8B: valid THREE.Skeleton required."
  );

  const leftFoot =
    findBone(skeleton, "LeftFoot");

  const rightFoot =
    findBone(skeleton, "RightFoot");

  const baseline =
    capturePose(skeleton);

  const forward =
    getForward(skeleton);

  let leftAnchor;
  let rightAnchor;

  try {
    leftAnchor = runTrial({
      skeleton,
      anchorBone: leftFoot,
      swingBone: rightFoot,
      baseline,
      forward,
    });

    rightAnchor = runTrial({
      skeleton,
      anchorBone: rightFoot,
      swingBone: leftFoot,
      baseline,
      forward,
    });
  } finally {
    /*
     * Diagnostic must not leave the live
     * character in a modified pose.
     */
    restorePose(
      baseline,
      skeleton
    );
  }

  const green =
    leftAnchor.green &&
    rightAnchor.green;

  const lines = [
    "=== AstraWay REAL Solver / PoseWriter Gate 8B ===",

    "MODE: isolated diagnostic",

    "EFFECTOR: foot bone origin proxy",

    "HARD/SOFT: metadata only; no hierarchy implementation",

    "",

    "LEFT ANCHOR / RIGHT SWING",

    `ANCHOR DRIFT: max=${format(leftAnchor.maxAnchorDrift)} | final=${format(leftAnchor.finalAnchorDrift)}`,

    `SWING ERROR: max=${format(leftAnchor.maxSwingError)} | final=${format(leftAnchor.finalSwingError)}`,

    `WRITES: ${leftAnchor.totalWrites} | solver=${leftAnchor.lastSolverStatus}`,

    `RESULT: ${leftAnchor.green ? "GREEN" : "RED"}`,

    "",

    "RIGHT ANCHOR / LEFT SWING",

    `ANCHOR DRIFT: max=${format(rightAnchor.maxAnchorDrift)} | final=${format(rightAnchor.finalAnchorDrift)}`,

    `SWING ERROR: max=${format(rightAnchor.maxSwingError)} | final=${format(rightAnchor.finalSwingError)}`,

    `WRITES: ${rightAnchor.totalWrites} | solver=${rightAnchor.lastSolverStatus}`,

    `RESULT: ${rightAnchor.green ? "GREEN" : "RED"}`,

    "",

    `FINAL: ${green ? "GATE 8B GREEN" : "GATE 8B RED"}`,
  ];

  const output =
    lines.join("\n");

  if (statusElement) {
    statusElement.textContent =
      output;
  }

  console.log(output);

  console.table({
    leftAnchor: leftAnchor.green,
    rightAnchor: rightAnchor.green,
    gate8B: green,
  });

  return {
    green,
    leftAnchor,
    rightAnchor,
  };
}

export default runClosedChainMultiEffector;
