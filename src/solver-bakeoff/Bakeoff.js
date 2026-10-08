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
 *   НЕ пишет кости.
 *   НЕ содержит Gait.
 *   НЕ содержит ContactManager.
 *   НЕ содержит BodyState.
 *
 *   Он только:
 *     1. фиксирует BasePose;
 *     2. описывает сценарии A–G;
 *     3. запускает Solver через единый контракт;
 *     4. измеряет результат;
 *     5. сравнивает Solver-ы на одинаковых входах.
 *
 *   Первый этап этого файла намеренно может работать
 *   без конкретного SolverAdapter.
 *
 *   Это архитектурный тестовый стенд, а не Character Controller.
 */

import * as THREE from "three";

/*
 * ---------------------------------------------------------
 * CONSTANTS
 * ---------------------------------------------------------
 */

export const BAKEOFF_VERSION =
  "AstraWay Solver Decision Gate v0.1";

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
 * SMALL UTILITY
 * ---------------------------------------------------------
 */

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value)
    ? value
    : fallback;
}

function cloneVector3(value) {
  return value
    ? value.clone()
    : new THREE.Vector3();
}

function cloneQuaternion(value) {
  return value
    ? value.clone()
    : new THREE.Quaternion();
}

/*
 * ---------------------------------------------------------
 * POSE SNAPSHOT
 *
 * This is intentionally independent of any Solver.
 *
 * BasePose belongs to the Bakeoff.
 * Solver receives a copy.
 * Solver is never allowed to mutate the
 * authoritative BasePose object.
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

    const snapshot =
      new PoseSnapshot();

    for (const bone of skeleton.bones) {
      snapshot.rotations.set(
        bone.name,
        cloneQuaternion(bone.quaternion)
      );

      snapshot.positions.set(
        bone.name,
        cloneVector3(bone.position)
      );
    }

    return snapshot;
  }

  clone() {
    const copy =
      new PoseSnapshot();

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

    for (const bone of skeleton.bones) {
      const rotation =
        this.rotations.get(bone.name);

      const position =
        this.positions.get(bone.name);

      if (rotation) {
        bone.quaternion.copy(
          rotation
        );
      }

      if (position) {
        bone.position.copy(
          position
        );
      }
    }

    skeleton.pose();

    for (const bone of skeleton.bones) {
      bone.updateMatrixWorld(true);
    }
  }

  maxRotationDrift(skeleton) {
    let maxDrift = 0;

    for (const bone of skeleton.bones) {
      const original =
        this.rotations.get(bone.name);

      if (!original) {
        continue;
      }

      const angle =
        original.angleTo(
          bone.quaternion
        );

      maxDrift =
        Math.max(
          maxDrift,
          Math.abs(angle)
        );
    }

    return maxDrift;
  }

  maxPositionDrift(skeleton) {
    let maxDrift = 0;

    for (const bone of skeleton.bones) {
      const original =
        this.positions.get(bone.name);

      if (!original) {
        continue;
      }

      const distance =
        original.distanceTo(
          bone.position
        );

      maxDrift =
        Math.max(
          maxDrift,
          distance
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

    this.targetPos =
      targetPos
        ? targetPos.clone()
        : null;

    this.targetRot =
      targetRot
        ? targetRot.clone()
        : null;

    this.weightPos =
      finiteNumber(
        weightPos,
        1
      );

    this.weightRot =
      finiteNumber(
        weightRot,
        0
      );

    this.enabled =
      Boolean(enabled);
  }

  clone() {
    return new BakeoffEffector({
      id: this.id,
      bone: this.bone,
      targetPos:
        this.targetPos
          ? this.targetPos.clone()
          : null,
      targetRot:
        this.targetRot
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
  }) {
    this.id = id;
    this.name = name;
    this.description = description;

    this.effectors =
      effectors.map(
        (effector) =>
          effector instanceof BakeoffEffector
            ? effector
            : new BakeoffEffector(effector)
      );

    this.frames =
      Math.max(
        1,
        Math.floor(frames)
      );

    this.unreachable =
      Boolean(unreachable);
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
      unreachable:
        this.unreachable,
    });
  }
}

/*
 * ---------------------------------------------------------
 * SCENARIO BUILDER
 *
 * IMPORTANT:
 * Targets are generated from the ACTUAL BasePose.
 *
 * We do not invent arbitrary world coordinates here.
 * This makes the first bake-off deterministic.
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
    if (!boneNames.has(name)) {
      throw new Error(
        `Bakeoff: required bone missing: ${name}`
      );
    }
  }

  skeleton.bones.forEach(
    (bone) =>
      bone.updateMatrixWorld(true)
  );

  const worldPosition =
    (name) => {
      const bone =
        skeleton.bones.find(
          (item) =>
            item.name === name
        );

      if (!bone) {
        throw new Error(
          `Bakeoff: bone not found: ${name}`
        );
      }

      const result =
        new THREE.Vector3();

      bone.getWorldPosition(
        result
      );

      return result;
    };

  const worldRotation =
    (name) => {
      const bone =
        skeleton.bones.find(
          (item) =>
            item.name === name
        );

      if (!bone) {
        throw new Error(
          `Bakeoff: bone not found: ${name}`
        );
      }

      const result =
        new THREE.Quaternion();

      bone.getWorldQuaternion(
        result
      );

      return result;
    };

  /*
   * Base pose positions.
   */

  const leftFoot =
    worldPosition("LeftFoot");

  const rightFoot =
    worldPosition("RightFoot");

  const leftHand =
    worldPosition("LeftHand");

  const rightHand =
    worldPosition("RightHand");

  const head =
    worldPosition("Head");

  const hips =
    worldPosition("Hips");

  const headRotation =
    worldRotation("Head");

  /*
   * Small deterministic offsets.
   *
   * They are intentionally conservative.
   * The first bake-off tests solver architecture,
   * not maximum reach.
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
   * A — Base Pose
   *
   * No effectors.
   *
   * Purpose:
   *   Does the solver preserve the pose
   *   when there is nothing to solve?
   */

  const scenarioA =
    new BakeoffScenario({
      id: "A",
      name: "Base Pose",
      description:
        "No effectors. Solver must preserve BasePose.",
      effectors: [],
      frames: 1,
    });

  /*
   * B — Two Feet
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
          weightRot: 0,
        },
        {
          id: "foot_R",
          bone: "foot_R",
          targetPos:
            rightFootTarget,
          weightPos: 1,
          weightRot: 0,
        },
      ],
      frames: 1,
    });

  /*
   * C — Two Feet + Head
   */

  const scenarioC =
    new BakeoffScenario({
      id: "C",
      name: "Two Feet + Head",
      description:
        "Two feet plus simultaneous head target.",
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
            headRotation,
          weightPos: 0.5,
          weightRot: 0.5,
        },
      ],
      frames: 1,
    });

  /*
   * D — Two Feet + Two Hands
   */

  const scenarioD =
    new BakeoffScenario({
      id: "D",
      name: "Two Feet + Two Hands",
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
    });

  /*
   * E — Full basic body task set
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
            hips,
          weightPos: 0.25,
        },
      ],
      frames: 1,
    });

  /*
   * F — Unreachable
   *
   * Deliberately impossible target.
   *
   * IMPORTANT:
   * Passing F does NOT mean reaching the target.
   *
   * We test whether the solver fails gracefully:
   *   - no NaN
   *   - no explosion
   *   - no skeleton corruption
   *   - stable final pose
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
    });

  /*
   * G — 60 frame stability
   */

  const scenarioG =
    new BakeoffScenario({
      id: "G",
      name:
        "60 Frame Stability",
      description:
        "Same multi-effector task for 60 frames.",
      effectors:
        scenarioD.effectors,
      frames: 60,
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
 * METRICS
 * ---------------------------------------------------------
 */

export function measureEffectorError(
  skeleton,
  effector
) {
  if (!effector?.enabled) {
    return 0;
  }

  if (!effector.targetPos) {
    return 0;
  }

  const bone =
    skeleton.bones.find(
      (item) =>
        item.name ===
        mapLogicalToCanonical(
          effector.bone
        )
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
 * Logical → canonical.
 *
 * Bakeoff deliberately keeps this tiny and local.
 * Full BoneMap integration will be connected by
 * the adapter layer, not by SolverCore.
 */

const LOGICAL_TO_CANONICAL =
  Object.freeze({
    pelvis: "Hips",
    spine01: "Spine",
    spine02: "Spine1",
    chest: "Spine2",
    neck: "Neck",
    head: "Head",

    clavicle_L:
      "LeftShoulder",
    upperArm_L:
      "LeftArm",
    foreArm_L:
      "LeftForeArm",
    hand_L:
      "LeftHand",

    clavicle_R:
      "RightShoulder",
    upperArm_R:
      "RightArm",
    foreArm_R:
      "RightForeArm",
    hand_R:
      "RightHand",

    thigh_L:
      "LeftUpLeg",
    shin_L:
      "LeftLeg",
    foot_L:
      "LeftFoot",
    toe_L:
      "LeftToeBase",

    thigh_R:
      "RightUpLeg",
    shin_R:
      "RightLeg",
    foot_R:
      "RightFoot",
    toe_R:
      "RightToeBase",
  });

function mapLogicalToCanonical(
  logicalName
) {
  return (
    LOGICAL_TO_CANONICAL[
      logicalName
    ] || logicalName
  );
}

export function measureScenario(
  skeleton,
  scenario
) {
  skeleton.bones.forEach(
    (bone) =>
      bone.updateMatrixWorld(true)
  );

  const errors =
    scenario.effectors
      .filter(
        (effector) =>
          effector.enabled
      )
      .map(
        (effector) =>
          measureEffectorError(
            skeleton,
            effector
          )
      );

  const finiteErrors =
    errors.filter(
      Number.isFinite
    );

  const maxError =
    finiteErrors.length
      ? Math.max(
          ...finiteErrors
        )
      : Infinity;

  const avgError =
    finiteErrors.length
      ? finiteErrors.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        finiteErrors.length
      : Infinity;

  return {
    maxError,
    avgError,
    errors,
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

    this.basePoseRotationDrift =
      0;

    this.basePosePositionDrift =
      0;

    this.drift60 =
      0;

    this.jitter =
      0;

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
 *
 * This is deliberately a JavaScript runtime contract
 * rather than a TypeScript interface.
 *
 * Any solver must implement these methods.
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
      `SolverAdapter invalid — missing: ${missing.join(", ")}`
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
   * Restore clean BasePose before every scenario.
   */

  basePose.apply(
    skeleton
  );

  adapter.configure(
    skeleton,
    boneMap
  );

  adapter.setPose(
    basePose.clone()
  );

  adapter.setEffectors(
    scenario.effectors.map(
      (effector) =>
        ({
          id: effector.id,
          bone: effector.bone,
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
   * Constraints are intentionally empty
   * for the first mathematical comparison.
   *
   * Joint limits will become a separate
   * bake-off dimension after multi-effector
   * capability is established.
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

  const start =
    performance.now();

  for (
    let frame = 0;
    frame < scenario.frames;
    frame++
  ) {
    const stats =
      adapter.solve(
        dt
      );

    const pose =
      adapter.getPoseResult();

    /*
     * Adapter owns translation from solver pose
     * back into the skeleton.
     */

    if (pose) {
      applyPoseResult(
        skeleton,
        pose
      );
    }

    skeleton.bones.forEach(
      (bone) =>
        bone.updateMatrixWorld(true)
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

    result.maxError =
      Math.max(
        result.maxError === Infinity
          ? 0
          : result.maxError,
        measurement.maxError
      );

    result.avgError =
      measurement.avgError;

    result.finite =
      result.finite &&
      skeletonIsFinite(
        skeleton
      );

    /*
     * Base-pose drift is meaningful
     * only for A and for unaffected bones
     * in later scenarios.
     */

    result.basePoseRotationDrift =
      Math.max(
        result.basePoseRotationDrift,
        basePose.maxRotationDrift(
          skeleton
        )
      );

    result.basePosePositionDrift =
      Math.max(
        result.basePosePositionDrift,
        basePose.maxPositionDrift(
          skeleton
        )
      );

    if (!result.finite) {
      result.notes.push(
        `Non-finite skeleton at frame ${frame}`
      );

      break;
    }
  }

  result.timeMs =
    performance.now() -
    start;

  /*
   * 60-frame drift:
   *
   * difference between first and final
   * measured max error.
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
   * Jitter:
   *
   * simple frame-to-frame error variation.
   *
   * This is intentionally conservative.
   * Later we can replace it with
   * positional velocity variance.
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
      totalVariation +=
        Math.abs(
          frameErrors[i] -
          frameErrors[i - 1]
        );
    }

    result.jitter =
      totalVariation /
      (
        frameErrors.length - 1
      );
  }

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
   * Restore BasePose AFTER the scenario.
   *
   * This guarantees that the next solver/scenario
   * starts from exactly the same state.
   */

  basePose.apply(
    skeleton
  );

  return result;
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

  const rotations =
    pose.rotations;

  const positions =
    pose.positions;

  if (rotations instanceof Map) {
    for (
      const [
        boneName,
        rotation,
      ] of rotations
    ) {
      const bone =
        skeleton.bones.find(
          (item) =>
            item.name === boneName
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

  if (positions instanceof Map) {
    for (
      const [
        boneName,
        position,
      ] of positions
    ) {
      const bone =
        skeleton.bones.find(
          (item) =>
            item.name === boneName
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
}

/*
 * ---------------------------------------------------------
 * REPORT
 * ---------------------------------------------------------
 */

export function formatResult(
  result
) {
  return [
    `${result.solverName} / ${result.scenarioId}`,
    `frames=${result.frames}`,
    `maxError=${formatNumber(result.maxError)}`,
    `avgError=${formatNumber(result.avgError)}`,
    `baseRotDrift=${formatNumber(result.basePoseRotationDrift)}`,
    `basePosDrift=${formatNumber(result.basePosePositionDrift)}`,
    `drift60=${formatNumber(result.drift60)}`,
    `jitter=${formatNumber(result.jitter)}`,
    `timeMs=${formatNumber(result.timeMs)}`,
    `finite=${result.finite}`,
    `converged=${result.converged}`,
  ].join(" | ");
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
 * REPORT TO CONSOLE
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
          Number.isFinite(
            result.maxError
          )
            ? Number(
                result.maxError.toFixed(
                  6
                )
              )
            : null,

        avgError:
          Number.isFinite(
            result.avgError
          )
            ? Number(
                result.avgError.toFixed(
                  6
                )
              )
            : null,

        baseRotDrift:
          Number(
            result.basePoseRotationDrift.toFixed(
              6
            )
          ),

        basePosDrift:
          Number(
            result.basePosePositionDrift.toFixed(
              6
            )
          ),

        drift60:
          Number(
            result.drift60.toFixed(
              6
            )
          ),

        jitter:
          Number(
            result.jitter.toFixed(
              6
            )
          ),

        timeMs:
          Number(
            result.timeMs.toFixed(
              3
            )
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

    solvers:
      {},

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

    solver.totalTimeMs +=
      result.timeMs;
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
  skeletonIsFinite,

  validateSolverAdapter,
  runScenario,
  runBakeoff,

  formatResult,
  printBakeoffReport,
  createBakeoffSummary,
};
