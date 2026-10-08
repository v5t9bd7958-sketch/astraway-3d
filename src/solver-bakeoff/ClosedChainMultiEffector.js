import {
  Solver,
  Link,
  Joint,
  Goal,
  DOF,
  SOLVE_STATUS,
  SOLVE_STATUS_NAMES,
} from "closed-chain-ik";

import { Vector3 } from "three";

const GOAL_ERROR_THRESHOLD = 0.012;
const FOOT_DRIFT_THRESHOLD = 0.02;
const STABILITY_THRESHOLD = 0.008;
const FRAME_COUNT = 30;

const TOPOLOGY = {
  Hips: null,

  Spine: "Hips",
  Spine1: "Spine",
  Spine2: "Spine1",
  Neck: "Spine2",
  Head: "Neck",

  LeftUpLeg: "Hips",
  LeftLeg: "LeftUpLeg",
  LeftFoot: "LeftLeg",

  RightUpLeg: "Hips",
  RightLeg: "RightUpLeg",
  RightFoot: "RightLeg",

  LeftShoulder: "Spine2",
  LeftArm: "LeftShoulder",
  LeftForeArm: "LeftArm",
  LeftHand: "LeftForeArm",

  RightShoulder: "Spine2",
  RightArm: "RightShoulder",
  RightForeArm: "RightArm",
  RightHand: "RightForeArm",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function distance3(a, b) {
  return Math.hypot(
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
  );
}

function add3(a, b) {
  return new Float32Array([
    a[0] + b[0],
    a[1] + b[1],
    a[2] + b[2],
  ]);
}

function format(value, digits = 5) {
  return Number.isFinite(value)
    ? value.toFixed(digits)
    : "NaN";
}

function statusName(status) {
  return (
    SOLVE_STATUS_NAMES?.[status] ??
    Object.entries(SOLVE_STATUS).find(
      ([, value]) => value === status
    )?.[0] ??
    `UNKNOWN(${status})`
  );
}

function getBoneMap(skeleton) {
  const map = new Map(
    skeleton.bones.map(
      (bone) => [bone.name, bone]
    )
  );

  for (const name of Object.keys(TOPOLOGY)) {
    assert(
      map.has(name),
      `Gate 8B: XBot bone "${name}" not found.`
    );
  }

  return map;
}

function verifyTopology(map) {
  for (
    const [childName, parentName]
    of Object.entries(TOPOLOGY)
  ) {
    if (!parentName) {
      continue;
    }

    const actual =
      map.get(childName).parent?.name;

    assert(
      actual === parentName,
      `Gate 8B: topology mismatch: ${childName}.parent=${actual}, expected ${parentName}.`
    );
  }
}

function readWorldPositions(map) {
  const temp = new Vector3();
  const result = {};

  for (const name of Object.keys(TOPOLOGY)) {
    map.get(name).getWorldPosition(temp);

    result[name] =
      new Float32Array([
        temp.x,
        temp.y,
        temp.z,
      ]);
  }

  return result;
}

function createJoint(
  parentLink,
  worldPosition,
  dof
) {
  const joint = new Joint();

  joint.setDoF(...dof);

  parentLink.addChild(joint);

  joint.setWorldPosition(
    worldPosition[0],
    worldPosition[1],
    worldPosition[2]
  );

  return joint;
}

function createSegment(
  joint,
  worldPosition
) {
  const link = new Link();

  joint.addChild(link);

  link.setWorldPosition(
    worldPosition[0],
    worldPosition[1],
    worldPosition[2]
  );

  return link;
}

function makeGoal(
  link,
  target
) {
  const goal = new Goal();

  goal.setGoalDoF(
    DOF.X,
    DOF.Y,
    DOF.Z
  );

  goal.setWorldPosition(
    target[0],
    target[1],
    target[2]
  );

  goal.makeClosure(link);

  return goal;
}

function setGenerousLimits(
  joint,
  min,
  max
) {
  joint.setMinLimits(...min);
  joint.setMaxLimits(...max);

  joint.setRestPoseValues(
    ...joint.dof.map(() => 0)
  );

  joint.restPoseSet = true;
}

function buildModel(skeleton) {
  const bones =
    getBoneMap(skeleton);

  verifyTopology(bones);

  const p =
    readWorldPositions(bones);

  /*
   * ONE BODY.
   *
   * The root is shared by every effector.
   * Translation + rotation are deliberately enabled
   * so the solver can move the body when the targets
   * demand it.
   */

  const root = new Joint();

  root.setDoF(
    DOF.X,
    DOF.Y,
    DOF.Z,
    DOF.EX,
    DOF.EY,
    DOF.EZ
  );

  root.setWorldPosition(
    p.Hips[0],
    p.Hips[1],
    p.Hips[2]
  );

  root.setMinLimits(
    -0.18,
    -0.18,
    -0.18,
    -0.55,
    -0.55,
    -0.55
  );

  root.setMaxLimits(
    0.18,
    0.18,
    0.18,
    0.55,
    0.55,
    0.55
  );

  root.setRestPoseValues(
    0,
    0,
    0,
    0,
    0,
    0
  );

  root.restPoseSet = true;

  const pelvis =
    new Link();

  root.addChild(pelvis);

  pelvis.setPosition(
    0,
    0,
    0
  );

  const goals = {};
  const joints = {};

  /*
   * -----------------------------
   * SPINE
   * -----------------------------
   */

  joints.spine =
    createJoint(
      pelvis,
      p.Spine,
      [DOF.EX, DOF.EY, DOF.EZ]
    );

  const spineLink =
    createSegment(
      joints.spine,
      p.Spine1
    );

  joints.spine1 =
    createJoint(
      spineLink,
      p.Spine2,
      [DOF.EX, DOF.EY, DOF.EZ]
    );

  const chest =
    createSegment(
      joints.spine1,
      p.Spine2
    );

  /*
   * -----------------------------
   * NECK / HEAD
   * -----------------------------
   */

  joints.neck =
    createJoint(
      chest,
      p.Neck,
      [DOF.EX, DOF.EY, DOF.EZ]
    );

  const neckLink =
    createSegment(
      joints.neck,
      p.Head
    );

  goals.head =
    makeGoal(
      neckLink,
      p.Head
    );

  /*
   * -----------------------------
   * LEGS
   * -----------------------------
   */

  for (const side of [
    "Left",
    "Right",
  ]) {
    const hipName =
      `${side}UpLeg`;

    const kneeName =
      `${side}Leg`;

    const footName =
      `${side}Foot`;

    const key =
      side.toLowerCase();

    joints[`${key}Hip`] =
      createJoint(
        pelvis,
        p[hipName],
        [DOF.EX, DOF.EY, DOF.EZ]
      );

    setGenerousLimits(
      joints[`${key}Hip`],
      [-1.2, -1.2, -1.2],
      [1.2, 1.2, 1.2]
    );

    const thigh =
      createSegment(
        joints[`${key}Hip`],
        p[kneeName]
      );

    joints[`${key}Knee`] =
      createJoint(
        thigh,
        p[kneeName],
        [DOF.EX, DOF.EY, DOF.EZ]
      );

    setGenerousLimits(
      joints[`${key}Knee`],
      [-1.7, -1.0, -1.0],
      [1.7, 1.0, 1.0]
    );

    const shin =
      createSegment(
        joints[`${key}Knee`],
        p[footName]
      );

    goals[`${key}Foot`] =
      makeGoal(
        shin,
        p[footName]
      );
  }

  /*
   * -----------------------------
   * ARMS
   * -----------------------------
   *
   * IMPORTANT:
   *
   * They attach to Spine2 / chest.
   * NOT to Hips.
   */

  for (const side of [
    "Left",
    "Right",
  ]) {
    const shoulderName =
      `${side}Shoulder`;

    const armName =
      `${side}Arm`;

    const foreArmName =
      `${side}ForeArm`;

    const handName =
      `${side}Hand`;

    const key =
      side.toLowerCase();

    joints[`${key}Shoulder`] =
      createJoint(
        chest,
        p[shoulderName],
        [DOF.EX, DOF.EY, DOF.EZ]
      );

    setGenerousLimits(
      joints[`${key}Shoulder`],
      [-1.5, -1.5, -1.5],
      [1.5, 1.5, 1.5]
    );

    const upperArm =
      createSegment(
        joints[`${key}Shoulder`],
        p[armName]
      );

    joints[`${key}Elbow`] =
      createJoint(
        upperArm,
        p[foreArmName],
        [DOF.EX, DOF.EY, DOF.EZ]
      );

    setGenerousLimits(
      joints[`${key}Elbow`],
      [-1.7, -1.0, -1.0],
      [1.7, 1.0, 1.0]
    );

    const foreArm =
      createSegment(
        joints[`${key}Elbow`],
        p[handName]
      );

    goals[`${key}Hand`] =
      makeGoal(
        foreArm,
        p[handName]
      );
  }

  const solver =
    new Solver(root);

  solver.maxIterations = 40;
  solver.translationConvergeThreshold = 1e-4;
  solver.translationFactor = 1;
  solver.dampingFactor = 0.03;
  solver.restPoseFactor = 0.01;

  solver.updateStructure();

  return {
    root,
    pelvis,
    chest,
    goals,
    joints,
    solver,
    source: p,
  };
}

function getGoalPosition(goal) {
  const out =
    new Float32Array(3);

  goal.getWorldPosition(out);

  return out;
}

function getEffectorPosition(link) {
  const out =
    new Float32Array(3);

  link.getWorldPosition(out);

  return out;
}

function getRootPosition(root) {
  const out =
    new Float32Array(3);

  root.getWorldPosition(out);

  return out;
}

function snapshotEffectors(model) {
  return {
    leftFoot:
      getEffectorPosition(
        model.goals.leftFoot.child
      ),

    rightFoot:
      getEffectorPosition(
        model.goals.rightFoot.child
      ),

    leftHand:
      getEffectorPosition(
        model.goals.leftHand.child
      ),

    rightHand:
      getEffectorPosition(
        model.goals.rightHand.child
      ),

    head:
      getEffectorPosition(
        model.goals.head.child
      ),
  };
}

function errorReport(model) {
  const report = {};

  for (
    const [name, goal]
    of Object.entries(model.goals)
  ) {
    const actual =
      getEffectorPosition(
        goal.child
      );

    const target =
      getGoalPosition(goal);

    report[name] = {
      actual,
      target,
      error:
        distance3(
          actual,
          target
        ),
    };
  }

  return report;
}

function setTarget(
  goal,
  target
) {
  goal.setWorldPosition(
    target[0],
    target[1],
    target[2]
  );
}

function solve(model) {
  const started =
    performance.now();

  const statuses =
    model.solver.solve();

  const timeMs =
    performance.now() - started;

  const errors =
    errorReport(model);

  const maxError =
    Math.max(
      ...Object.values(errors)
        .map(
          (value) => value.error
        )
    );

  return {
    statuses,
    status:
      statuses[0],
    statusName:
      statusName(statuses[0]),
    timeMs,
    errors,
    maxError,
  };
}

function buildTargets(source) {
  return {
    leftFoot:
      add3(
        source.LeftFoot,
        new Float32Array([
          0.08,
          0.02,
          0.02,
        ])
      ),

    rightFoot:
      add3(
        source.RightFoot,
        new Float32Array([
          -0.08,
          0.02,
          0.02,
        ])
      ),

    leftHand:
      add3(
        source.LeftHand,
        new Float32Array([
          0.10,
          0.05,
          0.12,
        ])
      ),

    rightHand:
      add3(
        source.RightHand,
        new Float32Array([
          -0.10,
          0.05,
          0.12,
        ])
      ),

    head:
      add3(
        source.Head,
        new Float32Array([
          0.02,
          0.04,
          0.02,
        ])
      ),
  };
}

function setAllTargets(
  model,
  targets
) {
  for (
    const [name, target]
    of Object.entries(targets)
  ) {
    setTarget(
      model.goals[name],
      target
    );
  }
}

function frameStability(
  model,
  count
) {
  let peakError = 0;
  let jitter = 0;

  let previous =
    snapshotEffectors(model);

  let totalMs = 0;

  const statuses = [];

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const result =
      solve(model);

    statuses.push(
      result.statusName
    );

    totalMs +=
      result.timeMs;

    peakError =
      Math.max(
        peakError,
        result.maxError
      );

    const current =
      snapshotEffectors(model);

    for (
      const name of Object.keys(current)
    ) {
      jitter =
        Math.max(
          jitter,
          distance3(
            current[name],
            previous[name]
          )
        );
    }

    previous = current;
  }

  return {
    peakError,
    jitter,
    avgTimeMs:
      totalMs / count,
    statuses,
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

  /*
   * Build ONE connected kinematic tree.
   */

  const model =
    buildModel(skeleton);

  const targets =
    buildTargets(
      model.source
    );

  setAllTargets(
    model,
    targets
  );

  /*
   * Phase 1:
   *
   * Five effectors simultaneously.
   */

  const initial =
    solve(model);

  const stability =
    frameStability(
      model,
      FRAME_COUNT
    );

  /*
   * Phase 2:
   *
   * Change ONLY the hands.
   *
   * Feet and head remain constrained.
   *
   * This is the critical coupling test.
   */

  const feetBefore = {
    left:
      getEffectorPosition(
        model.goals.leftFoot.child
      ),

    right:
      getEffectorPosition(
        model.goals.rightFoot.child
      ),
  };

  setTarget(
    model.goals.leftHand,
    add3(
      targets.leftHand,
      new Float32Array([
        0.08,
        0.04,
        0.05,
      ])
    )
  );

  setTarget(
    model.goals.rightHand,
    add3(
      targets.rightHand,
      new Float32Array([
        -0.08,
        0.04,
        0.05,
      ])
    )
  );

  const retarget =
    solve(model);

  const retargetStability =
    frameStability(
      model,
      FRAME_COUNT
    );

  const feetAfter = {
    left:
      getEffectorPosition(
        model.goals.leftFoot.child
      ),

    right:
      getEffectorPosition(
        model.goals.rightFoot.child
      ),
  };

  const leftFootDrift =
    distance3(
      feetBefore.left,
      feetAfter.left
    );

  const rightFootDrift =
    distance3(
      feetBefore.right,
      feetAfter.right
    );

  const footDrift =
    Math.max(
      leftFootDrift,
      rightFootDrift
    );

  const allFinite =
    Object.values(
      retarget.errors
    ).every(
      (entry) =>
        Number.isFinite(
          entry.error
        )
    );

  const initialPass =
    initial.status ===
      SOLVE_STATUS.CONVERGED &&
    initial.maxError <=
      GOAL_ERROR_THRESHOLD;

  const stabilityPass =
    stability.peakError <=
      GOAL_ERROR_THRESHOLD &&
    stability.jitter <=
      STABILITY_THRESHOLD;

  const retargetPass =
    retarget.status ===
      SOLVE_STATUS.CONVERGED &&
    retarget.maxError <=
      GOAL_ERROR_THRESHOLD;

  const feetProtected =
    footDrift <=
    FOOT_DRIFT_THRESHOLD;

  const green =
    allFinite &&
    initialPass &&
    stabilityPass &&
    retargetPass &&
    feetProtected &&
    retargetStability.peakError <=
      GOAL_ERROR_THRESHOLD &&
    retargetStability.jitter <=
      STABILITY_THRESHOLD;

  const lines = [
    "=== AstraWay Closed-Chain IK Gate 8B ===",

    `TOPOLOGY: VERIFIED | bones=${Object.keys(TOPOLOGY).length}`,

    `INITIAL: ${initial.statusName} | maxError=${format(initial.maxError)} | ${format(initial.timeMs, 2)} ms`,

    `STABILITY 30: peakError=${format(stability.peakError)} | jitter=${format(stability.jitter)} | avg=${format(stability.avgTimeMs, 2)} ms`,

    `RETARGET: ${retarget.statusName} | maxError=${format(retarget.maxError)} | footDrift=${format(footDrift)}`,

    `RETARGET 30: peakError=${format(retargetStability.peakError)} | jitter=${format(retargetStability.jitter)} | avg=${format(retargetStability.avgTimeMs, 2)} ms`,

    `LEFT_FOOT: error=${format(retarget.errors.leftFoot.error)}`,

    `RIGHT_FOOT: error=${format(retarget.errors.rightFoot.error)}`,

    `LEFT_HAND: error=${format(retarget.errors.leftHand.error)}`,

    `RIGHT_HAND: error=${format(retarget.errors.rightHand.error)}`,

    `HEAD: error=${format(retarget.errors.head.error)}`,

    `FEET_PROTECTED: ${feetProtected} | leftDrift=${format(leftFootDrift)} | rightDrift=${format(rightFootDrift)}`,

    `FINAL: ${green ? "GATE 8B GREEN" : "GATE 8B RED"}`,
  ];

  const text =
    lines.join("\n");

  if (statusElement) {
    statusElement.textContent =
      text;
  }

  console.log(text);

  console.table({
    topology: true,
    initial: initialPass,
    stability30: stabilityPass,
    retarget: retargetPass,
    feetProtected,
    gate8B: green,
  });

  return {
    green,
    topology: true,
    initial,
    stability,
    retarget,
    retargetStability,
    footDrift,
    feetProtected,
  };
}

export default runClosedChainMultiEffector;
