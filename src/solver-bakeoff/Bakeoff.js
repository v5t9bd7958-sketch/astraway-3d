/*
 * AstraWay — Solver Decision Gate
 *
 * FILE:
 *   src/solver-bakeoff/Bakeoff.js
 *
 * PURPOSE:
 *   Единственный диагностический стенд для сравнения Solver-ов.
 *
 * IMPORTANT:
 *   Этот файл НЕ управляет Character.
 *   НЕ содержит Gait.
 *   НЕ содержит ContactManager.
 *   НЕ содержит BodyState.
 *
 *   Он:
 *     1. фиксирует BasePose;
 *     2. описывает сценарии A–G;
 *     3. запускает Solver через единый контракт;
 *     4. измеряет результат;
 *     5. разделяет affected / unaffected drift;
 *     6. сравнивает Solver-ы на одинаковых входах.
 *
 * ARCHITECTURAL RULE:
 *   Bakeoff не использует Skeleton.pose() и Skeleton.update()
 *   для восстановления или обновления позы.
 *
 *   Обе операции могут вернуть skeleton в base pose.
 *   Для matrix propagation используется Object3D.updateMatrixWorld().
 */

import * as THREE from "three";

/*
 * ---------------------------------------------------------
 * CONSTANTS
 * ---------------------------------------------------------
 */

export const BAKEOFF_VERSION =
  "AstraWay Solver Decision Gate v0.2";

export const BAKEOFF_SCENARIOS = Object.freeze([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
]);

export const BAKEOFF_THRESHOLDS = Object.freeze({
  basePosePreservation: 0.001,
  twoFootConvergence: 0.01,
  conflictStability: 0.005,
  drift60Frames: 0.01,
  jitter: 0.002,
});

/*
 * ---------------------------------------------------------
 * LOGICAL → CANONICAL
 * ---------------------------------------------------------
 */

const LOGICAL_TO_CANONICAL = Object.freeze({
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
});

function mapLogicalToCanonical(name) {
  return LOGICAL_TO_CANONICAL[name] || name;
}

/*
 * ---------------------------------------------------------
 * SMALL UTILITY
 * ---------------------------------------------------------
 */

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function cloneVector3(value) {
  return value ? value.clone() : new THREE.Vector3();
}

function cloneQuaternion(value) {
  return value ? value.clone() : new THREE.Quaternion();
}

function findBone(skeleton, name) {
  const canonical = mapLogicalToCanonical(name);

  return skeleton.bones.find(
    (bone) =>
      bone.name === canonical ||
      bone.name === name
  );
}

/*
 * ---------------------------------------------------------
 * MATRIX REFRESH
 *
 * IMPORTANT:
 *
 * DO NOT call skeleton.update().
 * DO NOT call skeleton.pose().
 *
 * Both are inappropriate here because Skeleton.pose()
 * resets the skeleton to base pose and Skeleton.update()
 * is also documented as resetting the skeleton to base pose.
 *
 * We only propagate Object3D transforms.
 * ---------------------------------------------------------
 */

export function refreshSkeletonWorldMatrices(skeleton) {
  if (!skeleton?.bones) {
    throw new Error(
      "refreshSkeletonWorldMatrices: THREE.Skeleton missing"
    );
  }

  /*
   * Find root bones.
   *
   * XBot normally has one main skeleton root,
   * but this also works with multiple roots.
   */
  const roots = skeleton.bones.filter(
    (bone) => !bone.parent || !bone.parent.isBone
  );

  if (roots.length > 0) {
    for (const root of roots) {
      root.updateMatrixWorld(true);
    }
  } else {
    /*
     * Defensive fallback.
     */
    for (const bone of skeleton.bones) {
      bone.updateMatrixWorld(true);
    }
  }

  /*
   * Ensure every bone has a current world matrix.
   */
  for (const bone of skeleton.bones) {
    bone.updateMatrixWorld(true);
  }
}

/*
 * ---------------------------------------------------------
 * WORLD POSITION / ROTATION
 * ---------------------------------------------------------
 */

function getWorldPosition(skeleton, logicalName) {
  refreshSkeletonWorldMatrices(skeleton);

  const bone = findBone(
    skeleton,
    logicalName
  );

  if (!bone) {
    throw new Error(
      `Bakeoff: bone not found: ${logicalName}`
    );
  }

  return bone.getWorldPosition(
    new THREE.Vector3()
  );
}

function getWorldQuaternion(skeleton, logicalName) {
  refreshSkeletonWorldMatrices(skeleton);

  const bone = findBone(
    skeleton,
    logicalName
  );

  if (!bone) {
    throw new Error(
      `Bakeoff: bone not found: ${logicalName}`
    );
  }

  return bone.getWorldQuaternion(
    new THREE.Quaternion()
  );
}

/*
 * ---------------------------------------------------------
 * POSE SNAPSHOT
 * ---------------------------------------------------------
 *
 * BasePose is owned by Bakeoff.
 *
 * Solver receives a clone.
 *
 * Restore writes local transforms directly.
 *
 * NO skeleton.pose().
 * ---------------------------------------------------------
 */

export class PoseSnapshot {
  constructor() {
    this.rotations = new Map();
    this.positions = new Map();
  }

  static capture(skeleton) {
    if (!skeleton?.bones) {
      throw new Error(
        "PoseSnapshot.capture: THREE.Skeleton missing"
      );
    }

    const snapshot = new PoseSnapshot();

    for (const bone of skeleton.bones) {
      snapshot.rotations.set(
        bone.name,
        bone.quaternion.clone()
      );

      snapshot.positions.set(
        bone.name,
        bone.position.clone()
      );
    }

    return snapshot;
  }

  clone() {
    const copy = new PoseSnapshot();

    for (const [name, rotation] of this.rotations) {
      copy.rotations.set(
        name,
        rotation.clone()
      );
    }

    for (const [name, position] of this.positions) {
      copy.positions.set(
        name,
        position.clone()
      );
    }

    return copy;
  }

  apply(skeleton) {
    if (!skeleton?.bones) {
      throw new Error(
        "PoseSnapshot.apply: THREE.Skeleton missing"
      );
    }

    /*
     * Restore LOCAL transforms.
     *
     * This is the authoritative restore path.
     */
    for (const bone of skeleton.bones) {
      const rotation =
        this.rotations.get(bone.name);

      const position =
        this.positions.get(bone.name);

      if (rotation) {
        bone.quaternion.copy(rotation);
      }

      if (position) {
        bone.position.copy(position);
      }
    }

    /*
     * Propagate matrices.
     *
     * NEVER call skeleton.pose() here.
     */
    refreshSkeletonWorldMatrices(
      skeleton
    );
  }

  maxRotationDrift(
    skeleton,
    affectedBones = null
  ) {
    let maxDrift = 0;

    for (const bone of skeleton.bones) {
      /*
       * If affectedBones is supplied,
       * only measure UNAFFECTED bones.
       */
      if (
        affectedBones &&
        affectedBones.has(bone.name)
      ) {
        continue;
      }

      const original =
        this.rotations.get(
          bone.name
        );

      if (!original) {
        continue;
      }

      const angle =
        original.angleTo(
          bone.quaternion
        );

      maxDrift = Math.max(
        maxDrift,
        Math.abs(angle)
      );
    }

    return maxDrift;
  }

  maxPositionDrift(
    skeleton,
    affectedBones = null
  ) {
    let maxDrift = 0;

    for (const bone of skeleton.bones) {
      if (
        affectedBones &&
        affectedBones.has(bone.name)
      ) {
        continue;
      }

      const original =
        this.positions.get(
          bone.name
        );

      if (!original) {
        continue;
      }

      const distance =
        original.distanceTo(
          bone.position
        );

      maxDrift = Math.max(
        maxDrift,
        distance
      );
    }

    return maxDrift;
  }

  maxRotationDriftAll(
    skeleton
  ) {
    let maxDrift = 0;

    for (const bone of skeleton.bones) {
      const original =
        this.rotations.get(
          bone.name
        );

      if (!original) {
        continue;
      }

      maxDrift = Math.max(
        maxDrift,
        Math.abs(
          original.angleTo(
            bone.quaternion
          )
        )
      );
    }

    return maxDrift;
  }

  maxPositionDriftAll(
    skeleton
  ) {
    let maxDrift = 0;

    for (const bone of skeleton.bones) {
      const original =
        this.positions.get(
          bone.name
        );

      if (!original) {
        continue;
      }

      maxDrift = Math.max(
        maxDrift,
        original.distanceTo(
          bone.position
        )
      );
    }

    return maxDrift;
  }
}

/*
 * ---------------------------------------------------------
 * EFFECTOR
 * ---------------------------------------------------------
 */

export class BakeoffEffector {
  constructor({
    id,
    bone,
    targetPos = null,
    targetRot = null,
    weightPos = 1,
    weightRot = 0,
    enabled = true,
  }) {
    this.id = id;
    this.bone = bone;

    this.targetPos = targetPos
      ? targetPos.clone()
      : null;

    this.targetRot = targetRot
      ? targetRot.clone()
      : null;

    this.weightPos = finiteNumber(
      weightPos,
      1
    );

    this.weightRot = finiteNumber(
      weightRot,
      0
    );

    this.enabled = Boolean(enabled);
  }

  clone() {
    return new BakeoffEffector({
      id: this.id,
      bone: this.bone,

      targetPos: this.targetPos
        ? this.targetPos.clone()
        : null,

      targetRot: this.targetRot
        ? this.targetRot.clone()
        : null,

      weightPos: this.weightPos,
      weightRot: this.weightRot,

      enabled: this.enabled,
    });
  }
}

/*
 * ---------------------------------------------------------
 * SCENARIO
 * ---------------------------------------------------------
 */

export class BakeoffScenario {
  constructor({
    id,
    name,
    description,
    effectors = [],
    frames = 1,
    unreachable = false,
    affectedBones = [],
  }) {
    this.id = id;
    this.name = name;
    this.description = description;

    this.effectors = effectors.map(
      (effector) =>
        effector instanceof BakeoffEffector
          ? effector
          : new BakeoffEffector(
              effector
            )
    );

    this.frames = Math.max(
      1,
      Math.floor(frames)
    );

    this.unreachable =
      Boolean(unreachable);

    this.affectedBones =
      new Set(
        affectedBones.map(
          mapLogicalToCanonical
        )
      );
  }

  clone() {
    return new BakeoffScenario({
      id: this.id,
      name: this.name,
      description: this.description,

      effectors:
        this.effectors.map(
          (effector) =>
            effector.clone()
        ),

      frames: this.frames,
      unreachable: this.unreachable,

      affectedBones: [
        ...this.affectedBones,
      ],
    });
  }
}

/*
 * ---------------------------------------------------------
 * AFFECTED BONE SETS
 * ---------------------------------------------------------
 *
 * These are the bones the scenario is EXPECTED to allow
 * the solver to modify.
 *
 * Any modification outside this set is measured as drift.
 *
 * NOTE:
 * This is intentionally conservative.
 * If a future whole-body solver legitimately needs to move
 * the pelvis/spine to satisfy an arm task, that scenario
 * must explicitly declare those bones as affected.
 * ---------------------------------------------------------
 */

const LEFT_LEG_BONES = Object.freeze([
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
]);

const RIGHT_LEG_BONES = Object.freeze([
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
]);

const LEFT_ARM_BONES = Object.freeze([
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
]);

const RIGHT_ARM_BONES = Object.freeze([
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand",
]);

const HEAD_BONES = Object.freeze([
  "Neck",
  "Head",
]);

const PELVIS_BONES = Object.freeze([
  "Hips",
]);

function concatBones(...groups) {
  return [
    ...new Set(
      groups.flat()
    ),
  ];
}

/*
 * ---------------------------------------------------------
 * SCENARIO BUILDER
 * ---------------------------------------------------------
 */

export function buildScenarios(
  skeleton,
  boneNames
) {
  if (!skeleton?.bones) {
    throw new Error(
      "buildScenarios: THREE.Skeleton missing"
    );
  }

  const required = [
    "LeftFoot",
    "RightFoot",
    "LeftHand",
    "RightHand",
    "Head",
    "Hips",
  ];

  for (const name of required) {
    const canonical =
      mapLogicalToCanonical(name);

    if (!boneNames.has(canonical)) {
      throw new Error(
        `Bakeoff: required bone missing: ${canonical}`
      );
    }
  }

  refreshSkeletonWorldMatrices(
    skeleton
  );

  const leftFoot =
    getWorldPosition(
      skeleton,
      "LeftFoot"
    );

  const rightFoot =
    getWorldPosition(
      skeleton,
      "RightFoot"
    );

  const leftHand =
    getWorldPosition(
      skeleton,
      "LeftHand"
    );

  const rightHand =
    getWorldPosition(
      skeleton,
      "RightHand"
    );

  const head =
    getWorldPosition(
      skeleton,
      "Head"
    );

  const hips =
    getWorldPosition(
      skeleton,
      "Hips"
    );

  const headRotation =
    getWorldQuaternion(
      skeleton,
      "Head"
    );

  /*
   * Conservative deterministic offsets.
   */

  const leftFootTarget =
    leftFoot.clone();

  leftFootTarget.x += 0.08;

  const rightFootTarget =
    rightFoot.clone();

  rightFootTarget.x -= 0.08;

  const leftHandTarget =
    leftHand.clone();

  leftHandTarget.y += 0.08;

  const rightHandTarget =
    rightHand.clone();

  rightHandTarget.y += 0.08;

  const headTarget =
    head.clone();

  headTarget.x += 0.04;

  /*
   * IMPORTANT:
   * C now contains a REAL orientation target.
   *
   * Previous version used the current rotation,
   * which made the orientation task a no-op.
   */
  const headRotationTarget =
    headRotation.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.degToRad(10)
      )
    );

  /*
   * E pelvis target:
   *
   * Deliberately moved above current hips.
   *
   * This is no longer a zero task.
   */
  const pelvisTarget =
    hips.clone();

  pelvisTarget.y += 0.03;

  /*
   * -------------------------------------------------------
   * A — BASE POSE
   * -------------------------------------------------------
   */

  const scenarioA =
    new BakeoffScenario({
      id: "A",
      name: "Base Pose",
      description:
        "No effectors. Solver must preserve BasePose.",
      effectors: [],
      frames: 1,
      affectedBones: [],
    });

  /*
   * -------------------------------------------------------
   * B — TWO FEET
   * -------------------------------------------------------
   */

  const scenarioB =
    new BakeoffScenario({
      id: "B",
      name: "Two Feet",
      description:
        "Simultaneous left + right foot position targets.",

      effectors: [
        {
          id: "foot_L",
          bone: "foot_L",
          targetPos:
            leftFootTarget,
          weightPos: 1,
        },

        {
          id: "foot_R",
          bone: "foot_R",
          targetPos:
            rightFootTarget,
          weightPos: 1,
        },
      ],

      frames: 1,

      affectedBones:
        concatBones(
          LEFT_LEG_BONES,
          RIGHT_LEG_BONES
        ),
    });

  /*
   * -------------------------------------------------------
   * C — TWO FEET + HEAD
   * -------------------------------------------------------
   */

  const scenarioC =
    new BakeoffScenario({
      id: "C",
      name: "Two Feet + Head",
      description:
        "Two feet plus simultaneous head position/orientation.",

      effectors: [
        {
          id: "foot_L",
          bone: "foot_L",
          targetPos:
            leftFootTarget,
          weightPos: 1,
        },

        {
          id: "foot_R",
          bone: "foot_R",
          targetPos:
            rightFootTarget,
          weightPos: 1,
        },

        {
          id: "head",
          bone: "head",

          targetPos:
            headTarget,

          targetRot:
            headRotationTarget,

          weightPos: 0.5,
          weightRot: 0.5,
        },
      ],

      frames: 1,

      affectedBones:
        concatBones(
          LEFT_LEG_BONES,
          RIGHT_LEG_BONES,
          HEAD_BONES
        ),
    });

  /*
   * -------------------------------------------------------
   * D — TWO FEET + TWO HANDS
   * -------------------------------------------------------
   */

  const scenarioD =
    new BakeoffScenario({
      id: "D",
      name:
        "Two Feet + Two Hands",

      description:
        "Four simultaneous end-effector targets.",

      effectors: [
        {
          id: "foot_L",
          bone: "foot_L",
          targetPos:
            leftFootTarget,
          weightPos: 1,
        },

        {
          id: "foot_R",
          bone: "foot_R",
          targetPos:
            rightFootTarget,
          weightPos: 1,
        },

        {
          id: "hand_L",
          bone: "hand_L",
          targetPos:
            leftHandTarget,
          weightPos: 1,
        },

        {
          id: "hand_R",
          bone: "hand_R",
          targetPos:
            rightHandTarget,
          weightPos: 1,
        },
      ],

      frames: 1,

      affectedBones:
        concatBones(
          LEFT_LEG_BONES,
          RIGHT_LEG_BONES,
          LEFT_ARM_BONES,
          RIGHT_ARM_BONES
        ),
    });

  /*
   * -------------------------------------------------------
   * E — FULL BASIC BODY TASK SET
   * -------------------------------------------------------
   */

  const scenarioE =
    new BakeoffScenario({
      id: "E",

      name:
        "Feet + Hands + Head + Pelvis",

      description:
        "Six simultaneous body requirements.",

      effectors: [
        {
          id: "foot_L",
          bone: "foot_L",
          targetPos:
            leftFootTarget,
          weightPos: 1,
        },

        {
          id: "foot_R",
          bone: "foot_R",
          targetPos:
            rightFootTarget,
          weightPos: 1,
        },

        {
          id: "hand_L",
          bone: "hand_L",
          targetPos:
            leftHandTarget,
          weightPos: 1,
        },

        {
          id: "hand_R",
          bone: "hand_R",
          targetPos:
            rightHandTarget,
          weightPos: 1,
        },

        {
          id: "head",
          bone: "head",
          targetPos:
            headTarget,
          weightPos: 0.5,
        },

        {
          id: "pelvis",
          bone: "pelvis",

          targetPos:
            pelvisTarget,

          weightPos: 0.25,
        },
      ],

      frames: 1,

      affectedBones:
        concatBones(
          LEFT_LEG_BONES,
          RIGHT_LEG_BONES,
          LEFT_ARM_BONES,
          RIGHT_ARM_BONES,
          HEAD_BONES,
          PELVIS_BONES
        ),
    });

  /*
   * -------------------------------------------------------
   * F — UNREACHABLE HAND
   * -------------------------------------------------------
   */

  const unreachableHand =
    leftHand.clone();

  unreachableHand.y += 10;

  const scenarioF =
    new BakeoffScenario({
      id: "F",

      name:
        "Unreachable Hand",

      description:
        "Impossible hand target. Solver must remain stable.",

      effectors: [
        {
          id: "hand_L",
          bone: "hand_L",

          targetPos:
            unreachableHand,

          weightPos: 1,
        },
      ],

      frames: 1,

      unreachable: true,

      affectedBones:
        concatBones(
          LEFT_ARM_BONES
        ),
    });

  /*
   * -------------------------------------------------------
   * G — 60 FRAME STABILITY
   * -------------------------------------------------------
   *
   * IMPORTANT:
   * Clone effectors.
   *
   * Do not share mutable Effector objects
   * between Scenario D and G.
   * -------------------------------------------------------
   */

  const scenarioG =
    new BakeoffScenario({
      id: "G",

      name:
        "60 Frame Stability",

      description:
        "Same multi-effector task for 60 frames.",

      effectors:
        scenarioD.effectors.map(
          (effector) =>
            effector.clone()
        ),

      frames: 60,

      affectedBones:
        concatBones(
          LEFT_LEG_BONES,
          RIGHT_LEG_BONES,
          LEFT_ARM_BONES,
          RIGHT_ARM_BONES
        ),
    });

  return [
    scenarioA,
    scenarioB,
    scenarioC,
    scenarioD,
    scenarioE,
    scenarioF,
    scenarioG,
  ];
}

/*
 * ---------------------------------------------------------
 * EFFECTOR ERROR
 * ---------------------------------------------------------
 */

export function measureEffectorError(
  skeleton,
  effector
) {
  if (!effector?.enabled) {
    return 0;
  }

  /*
   * This first bake-off measures positional
   * effector convergence.
   *
   * Orientation is still passed to the solver
   * and will be added to the final orientation metric.
   */

  if (!effector.targetPos) {
    return 0;
  }

  const bone =
    findBone(
      skeleton,
      effector.bone
    );

  if (!bone) {
    return Infinity;
  }

  const actual =
    new THREE.Vector3();

  bone.getWorldPosition(
    actual
  );

  return actual.distanceTo(
    effector.targetPos
  );
}

/*
 * ---------------------------------------------------------
 * ORIENTATION ERROR
 * ---------------------------------------------------------
 */

export function measureEffectorRotationError(
  skeleton,
  effector
) {
  if (
    !effector?.enabled ||
    !effector.targetRot ||
    effector.weightRot <= 0
  ) {
    return 0;
  }

  const bone =
    findBone(
      skeleton,
      effector.bone
    );

  if (!bone) {
    return Infinity;
  }

  const actual =
    new THREE.Quaternion();

  bone.getWorldQuaternion(
    actual
  );

  return actual.angleTo(
    effector.targetRot
  );
}

/*
 * ---------------------------------------------------------
 * SCENARIO MEASUREMENT
 * ---------------------------------------------------------
 */

export function measureScenario(
  skeleton,
  scenario
) {
  refreshSkeletonWorldMatrices(
    skeleton
  );

  const enabledEffectors =
    scenario.effectors.filter(
      (effector) =>
        effector.enabled
    );

  const positionErrors =
    enabledEffectors.map(
      (effector) =>
        measureEffectorError(
          skeleton,
          effector
        )
    );

  const rotationErrors =
    enabledEffectors.map(
      (effector) =>
        measureEffectorRotationError(
          skeleton,
          effector
        )
    );

  const finitePositionErrors =
    positionErrors.filter(
      Number.isFinite
    );

  const finiteRotationErrors =
    rotationErrors.filter(
      Number.isFinite
    );

  const maxPositionError =
    finitePositionErrors.length
      ? Math.max(
          ...finitePositionErrors
        )
      : Infinity;

  const avgPositionError =
    finitePositionErrors.length
      ? finitePositionErrors.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        finitePositionErrors.length
      : Infinity;

  const maxRotationError =
    finiteRotationErrors.length
      ? Math.max(
          ...finiteRotationErrors
        )
      : 0;

  const avgRotationError =
    finiteRotationErrors.length
      ? finiteRotationErrors.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        finiteRotationErrors.length
      : 0;

  return {
    maxPositionError,
    avgPositionError,

    maxRotationError,
    avgRotationError,

    positionErrors,
    rotationErrors,

    /*
     * The primary bake-off error remains
     * positional convergence.
     */
    maxError:
      maxPositionError,

    avgError:
      avgPositionError,
  };
}

/*
 * ---------------------------------------------------------
 * NUMERIC HEALTH
 * ---------------------------------------------------------
 */

export function skeletonIsFinite(
  skeleton
) {
  for (const bone of skeleton.bones) {
    const values = [
      bone.position.x,
      bone.position.y,
      bone.position.z,

      bone.quaternion.x,
      bone.quaternion.y,
      bone.quaternion.z,
      bone.quaternion.w,

      bone.scale.x,
      bone.scale.y,
      bone.scale.z,
    ];

    if (
      values.some(
        (value) =>
          !Number.isFinite(value)
      )
    ) {
      return false;
    }
  }

  return true;
}

/*
 * ---------------------------------------------------------
 * POSE RESULT VALIDATION
 * ---------------------------------------------------------
 */

function validatePoseResult(
  skeleton,
  pose
) {
  if (!pose) {
    return true;
  }

  const validNames =
    new Set(
      skeleton.bones.map(
        (bone) =>
          bone.name
      )
    );

  if (
    pose.rotations instanceof Map
  ) {
    for (const [
      boneName,
    ] of pose.rotations) {
      if (
        !validNames.has(
          boneName
        )
      ) {
        throw new Error(
          `Bakeoff: solver returned unknown rotation bone: ${boneName}`
        );
      }
    }
  }

  if (
    pose.positions instanceof Map
  ) {
    for (const [
      boneName,
    ] of pose.positions) {
      if (
        !validNames.has(
          boneName
        )
      ) {
        throw new Error(
          `Bakeoff: solver returned unknown position bone: ${boneName}`
        );
      }
    }
  }

  return true;
}

/*
 * ---------------------------------------------------------
 * POSE RESULT APPLICATION
 * ---------------------------------------------------------
 */

function applyPoseResult(
  skeleton,
  pose
) {
  if (!pose) {
    return;
  }

  validatePoseResult(
    skeleton,
    pose
  );

  if (
    pose.rotations instanceof Map
  ) {
    for (const [
      boneName,
      rotation,
    ] of pose.rotations) {
      const bone =
        skeleton.bones.find(
          (item) =>
            item.name ===
            boneName
        );

      if (
        bone &&
        rotation
      ) {
        bone.quaternion.copy(
          rotation
        );
      }
    }
  }

  if (
    pose.positions instanceof Map
  ) {
    for (const [
      boneName,
      position,
    ] of pose.positions) {
      const bone =
        skeleton.bones.find(
          (item) =>
            item.name ===
            boneName
        );

      if (
        bone &&
        position
      ) {
        bone.position.copy(
          position
        );
      }
    }
  }

  refreshSkeletonWorldMatrices(
    skeleton
  );
}

/*
 * ---------------------------------------------------------
 * BAKEOFF RESULT
 * ---------------------------------------------------------
 */

export class BakeoffResult {
  constructor({
    solverName,
    scenarioId,
  }) {
    this.solverName =
      solverName;

    this.scenarioId =
      scenarioId;

    this.frames = 0;

    this.maxError =
      Infinity;

    this.avgError =
      Infinity;

    this.maxRotationError =
      0;

    this.avgRotationError =
      0;

    /*
     * Drift is measured ONLY against
     * unaffected bones.
     */
    this.unaffectedRotationDrift =
      0;

    this.unaffectedPositionDrift =
      0;

    /*
     * Keep total drift separately for diagnostics.
     */
    this.totalRotationDrift =
      0;

    this.totalPositionDrift =
      0;

    this.drift60 =
      0;

    this.jitter =
      0;

    this.solveTimeMs =
      0;

    this.totalTimeMs =
      0;

    /*
     * Backwards-compatible alias.
     */
    this.timeMs =
      0;

    this.finite =
      true;

    this.converged =
      false;

    this.notes = [];
  }
}

/*
 * ---------------------------------------------------------
 * ADAPTER CONTRACT
 * ---------------------------------------------------------
 */

export function validateSolverAdapter(
  adapter
) {
  const requiredMethods = [
    "configure",
    "setPose",
    "setEffectors",
    "setConstraints",
    "solve",
    "getPoseResult",
  ];

  const missing =
    requiredMethods.filter(
      (method) =>
        typeof adapter?.[method] !==
        "function"
    );

  if (missing.length > 0) {
    throw new Error(
      `SolverAdapter invalid — missing: ${missing.join(
        ", "
      )}`
    );
  }

  return true;
}

/*
 * ---------------------------------------------------------
 * SINGLE SCENARIO EXECUTION
 * ---------------------------------------------------------
 */

export function runScenario({
  adapter,
  skeleton,
  basePose,
  scenario,
  boneMap,
  dt = 1 / 60,
}) {
  validateSolverAdapter(
    adapter
  );

  if (!skeleton?.bones) {
    throw new Error(
      "runScenario: skeleton missing"
    );
  }

  if (!basePose) {
    throw new Error(
      "runScenario: BasePose missing"
    );
  }

  /*
   * Clean starting state.
   */
  basePose.apply(
    skeleton
  );

  adapter.configure(
    skeleton,
    boneMap
  );

  /*
   * Solver gets a CLONE.
   */
  adapter.setPose(
    basePose.clone()
  );

  adapter.setEffectors(
    scenario.effectors.map(
      (effector) => ({
        id: effector.id,

        bone:
          effector.bone,

        targetPos:
          effector.targetPos
            ? effector.targetPos.clone()
            : null,

        targetRot:
          effector.targetRot
            ? effector.targetRot.clone()
            : null,

        weightPos:
          effector.weightPos,

        weightRot:
          effector.weightRot,

        enabled:
          effector.enabled,
      })
    )
  );

  /*
   * Constraints intentionally empty
   * in this first solver bake-off.
   */
  adapter.setConstraints(
    []
  );

  const result =
    new BakeoffResult({
      solverName:
        adapter.name ||
        "Unnamed Solver",

      scenarioId:
        scenario.id,
    });

  const frameErrors = [];

  const totalStart =
    performance.now();

  for (
    let frame = 0;
    frame < scenario.frames;
    frame++
  ) {
    /*
     * Measure ONLY actual solver call.
     */
    const solveStart =
      performance.now();

    const stats =
      adapter.solve(
        dt
      );

    result.solveTimeMs +=
      performance.now() -
      solveStart;

    /*
     * Adapter returns resolved pose.
     */
    const pose =
      adapter.getPoseResult();

    if (pose) {
      applyPoseResult(
        skeleton,
        pose
      );
    }

    refreshSkeletonWorldMatrices(
      skeleton
    );

    const measurement =
      measureScenario(
        skeleton,
        scenario
      );

    frameErrors.push(
      measurement.maxError
    );

    result.frames =
      frame + 1;

    if (
      Number.isFinite(
        measurement.maxError
      )
    ) {
      if (
        result.maxError ===
        Infinity
      ) {
        result.maxError =
          measurement.maxError;
      } else {
        result.maxError =
          Math.max(
            result.maxError,
            measurement.maxError
          );
      }
    }

    result.avgError =
      measurement.avgError;

    result.maxRotationError =
      Math.max(
        result.maxRotationError,
        measurement.maxRotationError
      );

    result.avgRotationError =
      measurement.avgRotationError;

    result.finite =
      result.finite &&
      skeletonIsFinite(
        skeleton
      );

    /*
     * -----------------------------------------------------
     * DRIFT
     * -----------------------------------------------------
     *
     * Affected bones are expected to move.
     *
     * Unaffected bones are NOT expected to move.
     *
     * Therefore:
     *
     *   unaffectedRotationDrift
     *   unaffectedPositionDrift
     *
     * are the architectural preservation metrics.
     */

    result.unaffectedRotationDrift =
      Math.max(
        result.unaffectedRotationDrift,
        basePose.maxRotationDrift(
          skeleton,
          scenario.affectedBones
        )
      );

    result.unaffectedPositionDrift =
      Math.max(
        result.unaffectedPositionDrift,
        basePose.maxPositionDrift(
          skeleton,
          scenario.affectedBones
        )
      );

    /*
     * Diagnostic total drift.
     */
    result.totalRotationDrift =
      Math.max(
        result.totalRotationDrift,
        basePose.maxRotationDriftAll(
          skeleton
        )
      );

    result.totalPositionDrift =
      Math.max(
        result.totalPositionDrift,
        basePose.maxPositionDriftAll(
          skeleton
        )
      );

    if (!result.finite) {
      result.notes.push(
        `Non-finite skeleton at frame ${frame}`
      );

      break;
    }

    /*
     * If solver supplied stats, preserve useful
     * diagnostics without trusting them for our metrics.
     */
    if (
      stats &&
      Number.isFinite(
        stats.maxError
      )
    ) {
      result.notes.push(
        `solverStats.maxError=${stats.maxError}`
      );
    }
  }

  result.totalTimeMs =
    performance.now() -
    totalStart;

  /*
   * Backwards-compatible field.
   */
  result.timeMs =
    result.totalTimeMs;

  /*
   * -------------------------------------------------------
   * 60 FRAME DRIFT
   * -------------------------------------------------------
   */

  if (
    frameErrors.length >= 2
  ) {
    result.drift60 =
      Math.abs(
        frameErrors[
          frameErrors.length - 1
        ] -
        frameErrors[0]
      );
  }

  /*
   * -------------------------------------------------------
   * JITTER
   * -------------------------------------------------------
   *
   * First-order variation of measured error.
   *
   * This is intentionally simple for Gate 1.
   */
  if (
    frameErrors.length >= 3
  ) {
    let totalVariation = 0;

    for (
      let i = 1;
      i < frameErrors.length;
      i++
    ) {
      if (
        !Number.isFinite(
          frameErrors[i]
        ) ||
        !Number.isFinite(
          frameErrors[i - 1]
        )
      ) {
        continue;
      }

      totalVariation +=
        Math.abs(
          frameErrors[i] -
          frameErrors[i - 1]
        );
    }

    result.jitter =
      totalVariation /
      (frameErrors.length - 1);
  }

  /*
   * -------------------------------------------------------
   * CONVERGENCE
   * -------------------------------------------------------
   *
   * F is intentionally exempt from convergence.
   *
   * F passes if it remains finite and stable.
   */
  result.converged =
    result.finite &&
    Number.isFinite(
      result.maxError
    ) &&
    (
      scenario.unreachable ||
      result.maxError <=
        BAKEOFF_THRESHOLDS.twoFootConvergence
    );

  /*
   * -------------------------------------------------------
   * RESTORE
   * -------------------------------------------------------
   *
   * CRITICAL:
   *
   * Direct local transform restore.
   *
   * NEVER:
   *
   *   skeleton.pose()
   *   skeleton.update()
   *
   * -------------------------------------------------------
   */

  basePose.apply(
    skeleton
  );

  return result;
}

/*
 * ---------------------------------------------------------
 * BAKEOFF RUNNER
 * ---------------------------------------------------------
 */

export function runBakeoff({
  skeleton,
  boneMap,
  adapters,
  scenarios,
  dt = 1 / 60,
}) {
  if (!skeleton?.bones) {
    throw new Error(
      "runBakeoff: THREE.Skeleton missing"
    );
  }

  if (
    !Array.isArray(adapters) ||
    adapters.length === 0
  ) {
    throw new Error(
      "runBakeoff: no SolverAdapters"
    );
  }

  const basePose =
    PoseSnapshot.capture(
      skeleton
    );

  const selectedScenarios =
    scenarios ||
    buildScenarios(
      skeleton,
      new Set(
        skeleton.bones.map(
          (bone) =>
            bone.name
        )
      )
    );

  const results = [];

  for (
    const adapter of adapters
  ) {
    validateSolverAdapter(
      adapter
    );

    for (
      const scenario of selectedScenarios
    ) {
      const result =
        runScenario({
          adapter,
          skeleton,
          basePose,
          scenario,
          boneMap,
          dt,
        });

      results.push(
        result
      );
    }
  }

  /*
   * Absolute final restore.
   */
  basePose.apply(
    skeleton
  );

  return {
    version:
      BAKEOFF_VERSION,

    thresholds:
      BAKEOFF_THRESHOLDS,

    scenarioIds:
      selectedScenarios.map(
        (scenario) =>
          scenario.id
      ),

    solverNames:
      adapters.map(
        (adapter) =>
          adapter.name ||
          "Unnamed Solver"
      ),

    results,
  };
}

/*
 * ---------------------------------------------------------
 * FORMAT RESULT
 * ---------------------------------------------------------
 */

export function formatResult(
  result
) {
  return [
    `${result.solverName} / ${result.scenarioId}`,

    `frames=${result.frames}`,

    `maxError=${formatNumber(
      result.maxError
    )}`,

    `avgError=${formatNumber(
      result.avgError
    )}`,

    `maxRotError=${formatNumber(
      result.maxRotationError
    )}`,

    `unaffectedRotDrift=${formatNumber(
      result.unaffectedRotationDrift
    )}`,

    `unaffectedPosDrift=${formatNumber(
      result.unaffectedPositionDrift
    )}`,

    `totalRotDrift=${formatNumber(
      result.totalRotationDrift
    )}`,

    `totalPosDrift=${formatNumber(
      result.totalPositionDrift
    )}`,

    `drift60=${formatNumber(
      result.drift60
    )}`,

    `jitter=${formatNumber(
      result.jitter
    )}`,

    `solveMs=${formatNumber(
      result.solveTimeMs
    )}`,

    `totalMs=${formatNumber(
      result.totalTimeMs
    )}`,

    `finite=${result.finite}`,

    `converged=${result.converged}`,
  ].join(
    " | "
  );
}

function formatNumber(
  value
) {
  return Number.isFinite(value)
    ? value.toFixed(6)
    : "INF";
}

/*
 * ---------------------------------------------------------
 * CONSOLE REPORT
 * ---------------------------------------------------------
 */

export function printBakeoffReport(
  report
) {
  console.group(
    `[AstraWay] ${report.version}`
  );

  console.log(
    "Thresholds:",
    report.thresholds
  );

  console.log(
    "Scenarios:",
    report.scenarioIds
  );

  console.log(
    "Solvers:",
    report.solverNames
  );

  console.table(
    report.results.map(
      (result) => ({
        solver:
          result.solverName,

        scenario:
          result.scenarioId,

        frames:
          result.frames,

        maxError:
          finiteOrNull(
            result.maxError
          ),

        avgError:
          finiteOrNull(
            result.avgError
          ),

        maxRotError:
          finiteOrNull(
            result.maxRotationError
          ),

        unaffectedRotDrift:
          finiteOrNull(
            result.unaffectedRotationDrift
          ),

        unaffectedPosDrift:
          finiteOrNull(
            result.unaffectedPositionDrift
          ),

        totalRotDrift:
          finiteOrNull(
            result.totalRotationDrift
          ),

        totalPosDrift:
          finiteOrNull(
            result.totalPositionDrift
          ),

        drift60:
          finiteOrNull(
            result.drift60
          ),

        jitter:
          finiteOrNull(
            result.jitter
          ),

        solveMs:
          finiteOrNull(
            result.solveTimeMs
          ),

        totalMs:
          finiteOrNull(
            result.totalTimeMs
          ),

        finite:
          result.finite,

        converged:
          result.converged,
      })
    )
  );

  for (
    const result of report.results
  ) {
    console.log(
      formatResult(
        result
      )
    );
  }

  console.groupEnd();

  return report;
}

function finiteOrNull(
  value
) {
  return Number.isFinite(value)
    ? Number(
        value.toFixed(6)
      )
    : null;
}

/*
 * ---------------------------------------------------------
 * DIAGNOSTIC SUMMARY
 * ---------------------------------------------------------
 */

export function createBakeoffSummary(
  report
) {
  const summary = {
    version:
      report.version,

    solvers: {},

    totalRuns:
      report.results.length,
  };

  for (
    const result of report.results
  ) {
    if (
      !summary.solvers[
        result.solverName
      ]
    ) {
      summary.solvers[
        result.solverName
      ] = {
        runs: 0,

        finite: 0,

        converged: 0,

        maxError: 0,

        maxRotationError: 0,

        maxUnaffectedRotationDrift: 0,

        maxUnaffectedPositionDrift: 0,

        maxDrift60: 0,

        maxJitter: 0,

        totalSolveTimeMs: 0,

        totalTimeMs: 0,
      };
    }

    const solver =
      summary.solvers[
        result.solverName
      ];

    solver.runs++;

    if (result.finite) {
      solver.finite++;
    }

    if (result.converged) {
      solver.converged++;
    }

    if (
      Number.isFinite(
        result.maxError
      )
    ) {
      solver.maxError =
        Math.max(
          solver.maxError,
          result.maxError
        );
    }

    if (
      Number.isFinite(
        result.maxRotationError
      )
    ) {
      solver.maxRotationError =
        Math.max(
          solver.maxRotationError,
          result.maxRotationError
        );
    }

    if (
      Number.isFinite(
        result.unaffectedRotationDrift
      )
    ) {
      solver.maxUnaffectedRotationDrift =
        Math.max(
          solver.maxUnaffectedRotationDrift,
          result.unaffectedRotationDrift
        );
    }

    if (
      Number.isFinite(
        result.unaffectedPositionDrift
      )
    ) {
      solver.maxUnaffectedPositionDrift =
        Math.max(
          solver.maxUnaffectedPositionDrift,
          result.unaffectedPositionDrift
        );
    }

    if (
      Number.isFinite(
        result.drift60
      )
    ) {
      solver.maxDrift60 =
        Math.max(
          solver.maxDrift60,
          result.drift60
        );
    }

    if (
      Number.isFinite(
        result.jitter
      )
    ) {
      solver.maxJitter =
        Math.max(
          solver.maxJitter,
          result.jitter
        );
    }

    solver.totalSolveTimeMs +=
      result.solveTimeMs;

    solver.totalTimeMs +=
      result.totalTimeMs;
  }

  return summary;
}

/*
 * ---------------------------------------------------------
 * EXPORTS
 * ---------------------------------------------------------
 */

export default {
  BAKEOFF_VERSION,

  BAKEOFF_SCENARIOS,

  BAKEOFF_THRESHOLDS,

  PoseSnapshot,

  BakeoffEffector,

  BakeoffScenario,

  BakeoffResult,

  buildScenarios,

  measureScenario,

  measureEffectorError,

  measureEffectorRotationError,

  skeletonIsFinite,

  refreshSkeletonWorldMatrices,

  validateSolverAdapter,

  runScenario,

  runBakeoff,

  formatResult,

  printBakeoffReport,

  createBakeoffSummary,
};
