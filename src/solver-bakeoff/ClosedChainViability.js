import {
  Solver,
  Link,
  Joint,
  Goal,
  DOF,
  SOLVE_STATUS,
  SOLVE_STATUS_NAMES,
} from "closed-chain-ik";

const EPSILON = 1e-6;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function finite3(v) {
  return (
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  );
}

function distance3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function copyThreeVector(target, source) {
  source.getWorldPosition(target);
}

function getBoneWorldPosition(bone) {
  const result = new Float32Array(3);
  copyThreeVector(result, bone);
  return result;
}

function midpoint(a, b) {
  return new Float32Array([
    (a[0] + b[0]) * 0.5,
    (a[1] + b[1]) * 0.5,
    (a[2] + b[2]) * 0.5,
  ]);
}

function addScaled(a, b, scale) {
  return new Float32Array([
    a[0] + b[0] * scale,
    a[1] + b[1] * scale,
    a[2] + b[2] * scale,
  ]);
}

function subtract3(a, b) {
  return new Float32Array([
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
  ]);
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]);

  if (length < EPSILON) {
    return new Float32Array([0, 1, 0]);
  }

  return new Float32Array([
    v[0] / length,
    v[1] / length,
    v[2] / length,
  ]);
}

function formatNumber(value, digits = 5) {
  if (!Number.isFinite(value)) {
    return "NaN";
  }

  return value.toFixed(digits);
}

function formatStatus(status) {
  return (
    SOLVE_STATUS_NAMES?.[status] ??
    Object.entries(SOLVE_STATUS).find(([, value]) => value === status)?.[0] ??
    `UNKNOWN(${status})`
  );
}

function findBone(skeleton, name) {
  const bone = skeleton?.bones?.find((item) => item.name === name);

  if (!bone) {
    throw new Error(`ClosedChainViability: bone "${name}" not found.`);
  }

  return bone;
}

function createChainFromXBot(skeleton) {
  const hipBone = findBone(skeleton, "LeftUpLeg");
  const kneeBone = findBone(skeleton, "LeftLeg");
  const footBone = findBone(skeleton, "LeftFoot");

  const hip = getBoneWorldPosition(hipBone);
  const knee = getBoneWorldPosition(kneeBone);
  const foot = getBoneWorldPosition(footBone);

  assert(finite3(hip), "Hip world position is not finite.");
  assert(finite3(knee), "Knee world position is not finite.");
  assert(finite3(foot), "Foot world position is not finite.");

  const thighVector = subtract3(knee, hip);
  const shinVector = subtract3(foot, knee);

  const thighLength = Math.hypot(
    thighVector[0],
    thighVector[1],
    thighVector[2],
  );

  const shinLength = Math.hypot(
    shinVector[0],
    shinVector[1],
    shinVector[2],
  );

  assert(thighLength > EPSILON, "Left thigh length is zero.");
  assert(shinLength > EPSILON, "Left shin length is zero.");

  /*
   * closed-chain-ik model:
   *
   * root Link
   *   ↓
   * hip Joint
   *   ↓
   * thigh Link
   *   ↓
   * knee Joint
   *   ↓
   * shin/foot Link
   *   ↕
   * Goal closure
   *
   * The frame positions are parent-relative.
   * Both rotational joints operate around the model's local X axis.
   */

  const root = new Link();
  root.setWorldPosition(hip[0], hip[1], hip[2]);

  const hipJoint = new Joint();
  hipJoint.setDoF(DOF.EX, DOF.EY, DOF.EZ);

  const thigh = new Link();
  thigh.setPosition(
    thighVector[0],
    thighVector[1],
    thighVector[2],
  );

  const kneeJoint = new Joint();
  kneeJoint.setDoF(DOF.EX);

  const shin = new Link();
  shin.setPosition(
    shinVector[0],
    shinVector[1],
    shinVector[2],
  );

  root.addChild(hipJoint);
  hipJoint.addChild(thigh);
  thigh.addChild(kneeJoint);
  kneeJoint.addChild(shin);

  /*
   * Anatomically-inspired but deliberately generous limits.
   *
   * Hip:
   *   X: ±70°
   *   Y: ±60°
   *   Z: ±90°
   *
   * Knee:
   *   X: 0° ... 150°
   *
   * The goal of Gate 8A is solver viability, not final anatomical calibration.
   */

  hipJoint.setMinLimits(
    -Math.PI * 0.3889,
    -Math.PI * 0.3333,
    -Math.PI * 0.5,
  );

  hipJoint.setMaxLimits(
    Math.PI * 0.3889,
    Math.PI * 0.3333,
    Math.PI * 0.5,
  );

  kneeJoint.setMinLimits(0);
  kneeJoint.setMaxLimits(Math.PI * 0.8333);

  hipJoint.setRestPoseValues(0, 0, 0);
  kneeJoint.setRestPoseValues(0);

  hipJoint.restPoseSet = true;
  kneeJoint.restPoseSet = true;

  const goal = new Goal();

  /*
   * Position-only target.
   *
   * If we left Goal at its default 6-DOF constraint,
   * the solver would also try to match orientation.
   * Gate 8A is specifically a position viability test.
   */
  goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z);

  goal.setWorldPosition(
    foot[0],
    foot[1],
    foot[2],
  );

  goal.makeClosure(shin);

  const solver = new Solver(root);

  solver.maxIterations = 20;
  solver.translationConvergeThreshold = 1e-4;
  solver.translationFactor = 1;
  solver.dampingFactor = 0.01;
  solver.restPoseFactor = 0.01;

  solver.updateStructure();

  return {
    root,
    hipJoint,
    kneeJoint,
    thigh,
    shin,
    goal,
    solver,
    source: {
      hip,
      knee,
      foot,
      thighLength,
      shinLength,
      totalLength: thighLength + shinLength,
    },
  };
}

function measureFoot(chain) {
  const position = new Float32Array(3);

  chain.shin.getWorldPosition(position);

  return position;
}

function setGoal(chain, target) {
  chain.goal.setWorldPosition(
    target[0],
    target[1],
    target[2],
  );

  chain.goal.setMatrixWorldNeedsUpdate();
}

function solveOnce(chain) {
  const started = performance.now();

  const statuses = chain.solver.solve();

  const timeMs = performance.now() - started;

  assert(
    Array.isArray(statuses),
    "Solver.solve() did not return a status array.",
  );

  assert(
    statuses.length > 0,
    "Solver.solve() returned an empty status array.",
  );

  const status = statuses[0];

  const actual = measureFoot(chain);

  const target = new Float32Array(3);
  chain.goal.getWorldPosition(target);

  const error = distance3(actual, target);

  return {
    status,
    statusName: formatStatus(status),
    statuses,
    actual,
    target,
    error,
    timeMs,
    finite:
      finite3(actual) &&
      finite3(target) &&
      Number.isFinite(error),
  };
}

function runReachableTest(chain) {
  const { foot } = chain.source;

  const target = addScaled(
    foot,
    new Float32Array([1, 0, 0]),
    0.08,
  );

  setGoal(chain, target);

  const result = solveOnce(chain);

  return {
    name: "REACHABLE",
    target,
    ...result,
    passed:
      result.finite &&
      result.status === SOLVE_STATUS.CONVERGED &&
      result.error <= 0.01,
  };
}

function runUnreachableTest(chain) {
  const { hip, totalLength } = chain.source;

  const direction = normalize3(
    subtract3(
      new Float32Array([hip[0] + 1, hip[1], hip[2]]),
      hip,
    ),
  );

  const target = addScaled(
    hip,
    direction,
    totalLength + 0.5,
  );

  setGoal(chain, target);

  const result = solveOnce(chain);

  /*
   * An unreachable target must NOT be considered a solver failure
   * merely because it cannot converge.
   *
   * We check that the solver returns a valid finite state and does
   * not explode.
   */

  const bounded =
    result.finite &&
    Number.isFinite(result.error) &&
    result.error < 1000;

  return {
    name: "UNREACHABLE",
    target,
    ...result,
    bounded,
    passed: bounded,
  };
}

function runJointLimitTest(chain) {
  const { hip } = chain.source;

  /*
   * Push the target far sideways.
   * Joint limits must prevent arbitrary rotation.
   */

  const target = new Float32Array([
    hip[0] + 0.35,
    hip[1] + 0.05,
    hip[2] + 0.9,
  ]);

  setGoal(chain, target);

  const result = solveOnce(chain);

  const hipValues = Array.from(chain.hipJoint.dofValues);
  const kneeValue = chain.kneeJoint.getDoFValue(DOF.EX);

  const withinLimits =
    hipValues[DOF.EX] >= chain.hipJoint.getMinLimit(DOF.EX) - EPSILON &&
    hipValues[DOF.EX] <= chain.hipJoint.getMaxLimit(DOF.EX) + EPSILON &&
    hipValues[DOF.EY] >= chain.hipJoint.getMinLimit(DOF.EY) - EPSILON &&
    hipValues[DOF.EY] <= chain.hipJoint.getMaxLimit(DOF.EY) + EPSILON &&
    hipValues[DOF.EZ] >= chain.hipJoint.getMinLimit(DOF.EZ) - EPSILON &&
    hipValues[DOF.EZ] <= chain.hipJoint.getMaxLimit(DOF.EZ) + EPSILON &&
    kneeValue >= chain.kneeJoint.getMinLimit(DOF.EX) - EPSILON &&
    kneeValue <= chain.kneeJoint.getMaxLimit(DOF.EX) + EPSILON;

  return {
    name: "JOINT_LIMITS",
    target,
    ...result,
    withinLimits,
    passed: result.finite && withinLimits,
  };
}

function runRestPoseTest(chain) {
  chain.hipJoint.setDoFValues(
    0.15,
    -0.1,
    0.05,
  );

  chain.kneeJoint.setDoFValues(
    0.35,
  );

  chain.hipJoint.setRestPoseValues(
    0.15,
    -0.1,
    0.05,
  );

  chain.kneeJoint.setRestPoseValues(
    0.35,
  );

  chain.hipJoint.restPoseSet = true;
  chain.kneeJoint.restPoseSet = true;

  const beforeHip = Array.from(chain.hipJoint.dofValues);
  const beforeKnee = chain.kneeJoint.getDoFValue(DOF.EX);

  const result = solveOnce(chain);

  const afterHip = Array.from(chain.hipJoint.dofValues);
  const afterKnee = chain.kneeJoint.getDoFValue(DOF.EX);

  const restDrift =
    Math.abs(afterHip[DOF.EX] - beforeHip[DOF.EX]) +
    Math.abs(afterHip[DOF.EY] - beforeHip[DOF.EY]) +
    Math.abs(afterHip[DOF.EZ] - beforeHip[DOF.EZ]) +
    Math.abs(afterKnee - beforeKnee);

  return {
    name: "REST_POSE",
    ...result,
    restDrift,
    passed:
      result.finite &&
      restDrift < 0.5,
  };
}

function renderResult(result) {
  const lines = [];

  lines.push("=== AstraWay Closed-Chain IK Gate 8A ===");

  if (result.error) {
    lines.push(
      `REACHABLE: ${result.reachable.statusName} | error=${formatNumber(result.reachable.error)} | ${formatNumber(result.reachable.timeMs, 2)} ms`,
    );
  }

  if (result.unreachable) {
    lines.push(
      `UNREACHABLE: ${result.unreachable.statusName} | error=${formatNumber(result.unreachable.error)} | bounded=${result.unreachable.bounded}`,
    );
  }

  if (result.jointLimits) {
    lines.push(
      `LIMITS: ${result.jointLimits.statusName} | withinLimits=${result.jointLimits.withinLimits}`,
    );
  }

  if (result.restPose) {
    lines.push(
      `REST: ${result.restPose.statusName} | drift=${formatNumber(result.restPose.restDrift)}`,
    );
  }

  lines.push(
    `maxIterations=${result.maxIterations}`,
  );

  lines.push(
    `FINAL: ${result.green ? "GATE 8A GREEN" : "GATE 8A RED"}`,
  );

  return lines.join("\n");
}

export function runClosedChainViability({
  skeleton,
  statusElement = null,
} = {}) {
  assert(
    skeleton?.bones?.length,
    "ClosedChainViability: valid THREE.Skeleton required.",
  );

  const chain = createChainFromXBot(skeleton);

  const reachable = runReachableTest(chain);

  /*
   * Reset to a clean model before the remaining independent tests.
   * The chain is reconstructed so previous solver state cannot contaminate
   * the next result.
   */
  const chainUnreachable = createChainFromXBot(skeleton);
  const unreachable = runUnreachableTest(chainUnreachable);

  const chainLimits = createChainFromXBot(skeleton);
  const jointLimits = runJointLimitTest(chainLimits);

  const chainRest = createChainFromXBot(skeleton);
  const restPose = runRestPoseTest(chainRest);

  const result = {
    maxIterations: chain.solver.maxIterations,

    reachable,
    unreachable,
    jointLimits,
    restPose,

    green:
      reachable.passed &&
      unreachable.passed &&
      jointLimits.passed &&
      restPose.passed,
  };

  const text = renderResult(result);

  if (statusElement) {
    statusElement.textContent = text;
  }

  console.log(text);
  console.table({
    reachable: reachable.passed,
    unreachable: unreachable.passed,
    jointLimits: jointLimits.passed,
    restPose: restPose.passed,
    gate8A: result.green,
  });

  return result;
}

export default runClosedChainViability;
