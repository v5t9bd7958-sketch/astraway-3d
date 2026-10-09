
// src/main.js

import * as THREE from "three";

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { canonicalizeGLBBones } from "@three-ws/retarget";

import { CCDIKSolver } from "./animation/IKSolver.js";

import {
  inspectBones,
  renderBoneReport,
} from "./bone-inspector.js";

import { BONE_MAP } from "./character/BoneMap.js";
import { BodyState } from "./character/BodyState.js";
import { BodyStateBinder } from "./character/BodyStateBinder.js";

import { TaskSet } from "./character/TaskSet.js";
import { ContactTaskGenerator } from "./character/ContactTaskGenerator.js";
import { TaskResolver } from "./character/TaskResolver.js";
import { ConstraintSet } from "./character/ConstraintSet.js";
import { TaskConstraintBuilder } from "./character/TaskConstraintBuilder.js";

import { ConstraintSolver } from "./character/ConstraintSolver.js";
import { PoseWriter } from "./character/PoseWriter.js";

import { SurfaceQuery } from "./character/SurfaceQuery.js";
import { ContactPerception } from "./character/ContactPerception.js";

import {
  runClosedChainViability,
} from "./solver-bakeoff/ClosedChainViability.js";

import {
  runClosedChainMultiEffector,
} from "./solver-bakeoff/ClosedChainMultiEffector.js";

/*
 * =======================================================
 * ASTRAWAY — CHARACTER LAB RUNTIME
 *
 * This file is the application orchestrator.
 *
 * Production authority:
 *
 * WORLD
 *   ↓
 * SURFACE QUERY
 *   ↓
 * CONTACT PERCEPTION
 *   ↓
 * CONTACT EVIDENCE
 *   ↓
 * BODY STATE
 *   ↓
 * TASKS
 *   ↓
 * CONSTRAINTS
 *   ↓
 * SOLVER
 *   ↓
 * POSE WRITER
 *   ↓
 * SKELETON
 *
 * Absolute production invariant:
 *
 * Only PoseWriter is allowed to write final
 * production bone transforms.
 *
 * This file must never directly modify
 * production bone local transforms.
 * =======================================================
 */

/*
 * =======================================================
 * VIEW
 * =======================================================
 */

const canvas =
  document.querySelector("#viewer");

const status =
  document.querySelector("#status");

if (!canvas) {
  throw new Error(
    "Canvas #viewer не найден"
  );
}

if (!status) {
  throw new Error(
    "Элемент #status не найден"
  );
}

const renderer =
  new THREE.WebGLRenderer({
    canvas,
    antialias: true,
  });

renderer.setPixelRatio(
  Math.min(
    window.devicePixelRatio || 1,
    2
  )
);

renderer.setSize(
  window.innerWidth,
  window.innerHeight
);

renderer.outputColorSpace =
  THREE.SRGBColorSpace;

const scene =
  new THREE.Scene();

scene.background =
  new THREE.Color(
    0x090b10
  );

const camera =
  new THREE.PerspectiveCamera(
    35,
    window.innerWidth /
      Math.max(
        window.innerHeight,
        1
      ),
    0.01,
    100
  );

camera.position.set(
  0,
  1.2,
  4
);

/*
 * =======================================================
 * LIGHTING
 * =======================================================
 */

scene.add(
  new THREE.HemisphereLight(
    0xdde8ff,
    0x20232b,
    2.2
  )
);

const keyLight =
  new THREE.DirectionalLight(
    0xffffff,
    2.5
  );

keyLight.position.set(
  2,
  4,
  3
);

scene.add(
  keyLight
);

const fillLight =
  new THREE.DirectionalLight(
    0x8fa8ff,
    1
  );

fillLight.position.set(
  -3,
  2,
  -2
);

scene.add(
  fillLight
);

/*
 * =======================================================
 * DEBUG GROUND VISUALIZATION
 *
 * This mesh is visual only.
 *
 * It is NOT the contact authority.
 *
 * Contact authority:
 * SurfaceQuery → ContactPerception → Evidence
 * =======================================================
 */

const ground =
  new THREE.Mesh(
    new THREE.PlaneGeometry(
      10,
      10
    ),
    new THREE.MeshStandardMaterial({
      color: 0x151922,
      roughness: 0.9,
    })
  );

ground.rotation.x =
  -Math.PI / 2;

scene.add(
  ground
);

/*
 * =======================================================
 * LOADER
 * =======================================================
 */

const loader =
  new GLTFLoader();

loader.setMeshoptDecoder(
  MeshoptDecoder
);

const MODEL_URL =
  `${import.meta.env.BASE_URL}models/Xbot.glb`;

/*
 * =======================================================
 * RUNTIME STATE
 * =======================================================
 */

let model = null;

let skinnedMesh = null;

let skeleton = null;

/*
 * =======================================================
 * PRODUCTION CHARACTER PIPELINE
 * =======================================================
 */

let bodyState = null;

let bodyStateBinder = null;

let surfaceQuery = null;

let contactPerception = null;

let taskSet = null;

let contactTaskGenerator = null;

let taskResolver = null;

let constraintSet = null;

let taskConstraintBuilder = null;

let resolvedTaskPlan = null;

let constraintSolver = null;

let poseWriter = null;

let solverResult = null;

let poseWriteResult = null;

/*
 * =======================================================
 * RUNTIME LIFECYCLE
 * =======================================================
 */

const RUNTIME_PHASE = Object.freeze({
  BOOT: "BOOT",
  LOADING: "LOADING",
  VALIDATING: "VALIDATING",
  INITIALIZING: "INITIALIZING",
  READY: "READY",
  FAILED: "FAILED",
});

let runtimePhase =
  RUNTIME_PHASE.BOOT;

let runtimeStartedAt =
  performance.now();

let modelLoadedAt =
  0;

/*
 * =======================================================
 * FRAME / DIAGNOSTIC STATE
 * =======================================================
 */

let bodyStateFrames =
  0;

let bodyStateLastReport =
  0;

let lastFrameTime =
  performance.now();

let frameCount =
  0;

let droppedFrameCount =
  0;

/*
 * =======================================================
 * GATE 7 — CCD IK
 * =======================================================
 */

let ikSolver = null;

let ikTarget = null;

let ikMarker = null;

let ikFrames = 0;

let ikFinished = false;

let ikInitialError = 0;

let ikInitialFoot = null;

let ikTargetPosition = null;

const IK_TEST_FRAMES =
  60;

/*
 * =======================================================
 * STATUS
 * =======================================================
 */

function setStatus(message) {
  status.textContent =
    message;

  console.log(
    `[AstraWay] ${message}`
  );
}

function setRuntimePhase(
  phase
) {
  runtimePhase =
    phase;

  console.log(
    `[AstraWay] Runtime phase → ${phase}`
  );
}

/*
 * =======================================================
 * ERROR HANDLING
 * =======================================================
 */

function failRuntime(
  error,
  context = "Runtime"
) {
  runtimePhase =
    RUNTIME_PHASE.FAILED;

  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `[AstraWay] ${context}`,
    error
  );

  status.textContent =
    `❌ ${context}: ${message}`;
}

/*
 * =======================================================
 * ASYNC TIMEOUT
 * =======================================================
 */

function timeout(
  promise,
  ms,
  name
) {
  let timer = null;

  const timeoutPromise =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
            () => {
              reject(
                new Error(
                  `${name}: timeout ${ms / 1000}s`
                )
              );
            },
            ms
          );
      }
    );

  return Promise.race([
    promise,
    timeoutPromise,
  ]).finally(() => {
    if (timer !== null) {
      clearTimeout(
        timer
      );
    }
  });
}

/*
 * =======================================================
 * ARRAY BUFFER NORMALIZATION
 * =======================================================
 */

function toArrayBuffer(
  value
) {
  if (
    value instanceof
    ArrayBuffer
  ) {
    return value;
  }

  if (
    ArrayBuffer.isView(value)
  ) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset +
        value.byteLength
    );
  }

  if (
    value?.buffer
  ) {
    return toArrayBuffer(
      value.buffer
    );
  }

  return null;
}

/*
 * =======================================================
 * BONE RESOLUTION
 *
 * Logical character name
 *        ↓
 * BoneMap
 *        ↓
 * Canonical Three.js bone
 * =======================================================
 */

function findBone(
  root,
  logicalName
) {
  if (!root) {
    return null;
  }

  const canonicalName =
    BONE_MAP[
      logicalName
    ];

  if (!canonicalName) {
    return null;
  }

  return root.getObjectByName(
    canonicalName
  );
}

/*
 * =======================================================
 * MODEL / SKELETON ASSERTIONS
 * =======================================================
 */

function assertModelRoot(
  root
) {
  if (!root) {
    throw new Error(
      "Model root missing"
    );
  }

  if (!root.isObject3D) {
    throw new Error(
      "Model root is not THREE.Object3D"
    );
  }
}

function assertSkinnedMesh(
  skin
) {
  if (!skin) {
    throw new Error(
      "SkinnedMesh missing"
    );
  }

  if (!skin.isSkinnedMesh) {
    throw new Error(
      "Selected mesh is not SkinnedMesh"
    );
  }

  if (!skin.skeleton) {
    throw new Error(
      "SkinnedMesh skeleton missing"
    );
  }
}

function assertSkeleton(
  skin
) {
  if (!skin?.skeleton) {
    throw new Error(
      "Skeleton missing"
    );
  }

  if (
    !Array.isArray(
      skin.skeleton.bones
    ) ||
    skin.skeleton.bones.length === 0
  ) {
    throw new Error(
      "Skeleton contains no bones"
    );
  }
}

/*
 * =======================================================
 * CAMERA / MODEL FRAMING
 * =======================================================
 */

function frameModel(
  root
) {
  assertModelRoot(
    root
  );

  root.updateMatrixWorld(
    true
  );

  const box =
    new THREE.Box3()
      .setFromObject(
        root
      );

  if (box.isEmpty()) {
    throw new Error(
      "Model bounding box is empty"
    );
  }

  const size =
    box.getSize(
      new THREE.Vector3()
    );

  const center =
    box.getCenter(
      new THREE.Vector3()
    );

  const maxSize =
    Math.max(
      size.x,
      size.y,
      size.z
    );

  if (
    !Number.isFinite(
      maxSize
    ) ||
    maxSize <= 0
  ) {
    throw new Error(
      "Invalid model dimensions"
    );
  }

  const halfFov =
    THREE.MathUtils.degToRad(
      camera.fov * 0.5
    );

  const tangent =
    Math.tan(
      halfFov
    );

  if (
    !Number.isFinite(
      tangent
    ) ||
    tangent <= 0
  ) {
    throw new Error(
      "Invalid camera FOV"
    );
  }

  const distance =
    maxSize /
    (2 * tangent);

  camera.position.set(
    center.x,
    center.y +
      maxSize * 0.08,
    center.z +
      distance * 1.25
  );

  camera.lookAt(
    center
  );

  /*
   * Visual ground only.
   *
   * The actual SurfaceQuery backend receives
   * the same initial Y separately.
   */
  ground.position.y =
    box.min.y;

  return box;
}

/*
 * =======================================================
 * POSE GATE
 *
 * Structural validation only.
 *
 * No production pose is written here.
 * =======================================================
 */

function runPoseGate(
  root
) {
  const checks = [];

  const logicalNames =
    Object.keys(
      BONE_MAP
    );

  const missing =
    logicalNames.filter(
      (name) =>
        !findBone(
          root,
          name
        )
    );

  checks.push(
    missing.length === 0
  );

  if (
    missing.length > 0
  ) {
    console.error(
      "[AstraWay] Missing canonical bones",
      missing
    );
  }

  const thigh =
    findBone(
      root,
      "thigh_L"
    );

  const shin =
    findBone(
      root,
      "shin_L"
    );

  const foot =
    findBone(
      root,
      "foot_L"
    );

  checks.push(
    !!thigh &&
    !!shin &&
    !!foot &&
    shin.parent === thigh &&
    foot.parent === shin
  );

  const upperArm =
    findBone(
      root,
      "upperArm_L"
    );

  const foreArm =
    findBone(
      root,
      "foreArm_L"
    );

  let armPropagation =
    false;

  if (
    upperArm &&
    foreArm
  ) {
    root.updateMatrixWorld(
      true
    );

    const before =
      new THREE.Vector3();

    foreArm.getWorldPosition(
      before
    );

    const original =
      upperArm.quaternion.clone();

    upperArm.rotateZ(
      THREE.MathUtils.degToRad(
        30
      )
    );

    root.updateMatrixWorld(
      true
    );

    const after =
      new THREE.Vector3();

    foreArm.getWorldPosition(
      after
    );

    upperArm.quaternion.copy(
      original
    );

    root.updateMatrixWorld(
      true
    );

    armPropagation =
      before.distanceTo(
        after
      ) > 0.001;
  }

  checks.push(
    armPropagation
  );

  checks.push(
    !!root.getObjectByProperty(
      "isSkinnedMesh",
      true
    )
  );

  const spine01 =
    findBone(
      root,
      "spine01"
    );

  const spine02 =
    findBone(
      root,
      "spine02"
    );

  const chest =
    findBone(
      root,
      "chest"
    );

  const neck =
    findBone(
      root,
      "neck"
    );

  const head =
    findBone(
      root,
      "head"
    );

  checks.push(
    !!spine01 &&
    !!spine02 &&
    !!chest &&
    !!neck &&
    !!head &&
    spine02.parent ===
      spine01 &&
    chest.parent ===
      spine02 &&
    neck.parent ===
      chest &&
    head.parent ===
      neck
  );

  const passed =
    checks.filter(
      Boolean
    ).length;

  return {
    passed,
    total:
      checks.length,
    pass:
      passed ===
      checks.length,
    missing,
  };
}

/*
 * =======================================================
 * CONTROLLED POSE TEST
 *
 * Tests FK propagation only.
 *
 * Original transforms are restored immediately.
 * =======================================================
 */

function runControlledPoseTest(
  root
) {
  const tests = [];

  const testBone = (
    parent,
    child,
    degrees
  ) => {
    if (
      !parent ||
      !child
    ) {
      return false;
    }

    root.updateMatrixWorld(
      true
    );

    const before =
      new THREE.Vector3();

    child.getWorldPosition(
      before
    );

    const original =
      parent.quaternion.clone();

    parent.rotateZ(
      THREE.MathUtils.degToRad(
        degrees
      )
    );

    root.updateMatrixWorld(
      true
    );

    const moved =
      new THREE.Vector3();

    child.getWorldPosition(
      moved
    );

    parent.quaternion.copy(
      original
    );

    root.updateMatrixWorld(
      true
    );

    const restored =
      new THREE.Vector3();

    child.getWorldPosition(
      restored
    );

    return (
      before.distanceTo(
        moved
      ) > 0.001 &&
      before.distanceTo(
        restored
      ) < 0.0001
    );
  };

  tests.push(
    testBone(
      findBone(
        root,
        "upperArm_L"
      ),
      findBone(
        root,
        "foreArm_L"
      ),
      25
    )
  );

  tests.push(
    testBone(
      findBone(
        root,
        "thigh_L"
      ),
      findBone(
        root,
        "foot_L"
      ),
      -18
    )
  );

  tests.push(
    testBone(
      findBone(
        root,
        "spine01"
      ),
      findBone(
        root,
        "head"
      ),
      12
    )
  );

  const passed =
    tests.filter(
      Boolean
    ).length;

  return {
    passed,
    total:
      tests.length,
    pass:
      passed ===
      tests.length,
  };
}

/*
 * =======================================================
 * GATE 7 — PREPARE
 *
 * This is a test harness.
 *
 * It does not participate in the production
 * BodyState → Task → Constraint → DLS pipeline.
 * =======================================================
 */

function prepareIKGate(
  root,
  skin
) {
  const thigh =
    findBone(
      root,
      "thigh_L"
    );

  const shin =
    findBone(
      root,
      "shin_L"
    );

  const foot =
    findBone(
      root,
      "foot_L"
    );

  if (!skin?.skeleton) {
    throw new Error(
      "IK Skeleton missing"
    );
  }

  if (
    !thigh ||
    !shin ||
    !foot ||
    shin.parent !==
      thigh ||
    foot.parent !==
      shin
  ) {
    throw new Error(
      "IK hierarchy RED: thigh → shin → foot"
    );
  }

  skeleton =
    skin.skeleton;

  const thighIndex =
    skeleton.bones.indexOf(
      thigh
    );

  const shinIndex =
    skeleton.bones.indexOf(
      shin
    );

  const footIndex =
    skeleton.bones.indexOf(
      foot
    );

  if (
    thighIndex < 0 ||
    shinIndex < 0 ||
    footIndex < 0
  ) {
    throw new Error(
      "IK bone indices invalid"
    );
  }

  root.updateMatrixWorld(
    true
  );

  const footWorld =
    new THREE.Vector3();

  foot.getWorldPosition(
    footWorld
  );

  ikTarget =
    new THREE.Object3D();

  ikTarget.name =
    "AstraWay_IK_Target_LeftFoot";

  ikTarget.position.copy(
    footWorld
  );

  ikTarget.position.x +=
    0.15;

  ikTarget.position.y +=
    0.05;

  scene.add(
    ikTarget
  );

  scene.updateMatrixWorld(
    true
  );

  ikTargetPosition =
    ikTarget.getWorldPosition(
      new THREE.Vector3()
    );

  ikMarker =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.035,
        12,
        12
      ),
      new THREE.MeshBasicMaterial({
        color: 0x33ff88,
      })
    );

  ikMarker.position.copy(
    ikTargetPosition
  );

  scene.add(
    ikMarker
  );

  root.updateMatrixWorld(
    true
  );

  ikInitialFoot =
    foot.getWorldPosition(
      new THREE.Vector3()
    );

  ikInitialError =
    ikInitialFoot.distanceTo(
      ikTargetPosition
    );

  ikSolver =
    new CCDIKSolver(
      skeleton
    );

  ikSolver.createChain(
    [
      footIndex,
      shinIndex,
      thighIndex,
    ],
    [
      null,
      null,
      null,
    ],
    ikTarget,
    "AstraWay_LeftLeg_Gate7"
  );

  ikSolver.setConfiguration({
    iterations:
      1,

    thresholdTargetSq:
      0.00000001,

    thresholdIterSqDist:
      0.00000001,
  });

  ikFrames =
    0;

  ikFinished =
    false;
}

/*
 * =======================================================
 * GATE 7 — UPDATE
 * =======================================================
 */

function updateIKGate() {
  if (
    !ikSolver ||
    !model ||
    ikFinished
  ) {
    return;
  }

  ikSolver.update();

  model.updateMatrixWorld(
    true
  );

  ikFrames++;

  if (
    ikFrames <
    IK_TEST_FRAMES
  ) {
    return;
  }

  ikFinished =
    true;

  const foot =
    findBone(
      model,
      "foot_L"
    );

  if (!foot) {
    setStatus(
      "IK GATE RED — foot missing"
    );

    return;
  }

  model.updateMatrixWorld(
    true
  );

  const finalFoot =
    foot.getWorldPosition(
      new THREE.Vector3()
    );

  const finalError =
    finalFoot.distanceTo(
      ikTargetPosition
    );

  const moved =
    finalFoot.distanceTo(
      ikInitialFoot
    );

  const improvement =
    ikInitialError -
    finalError;

  const pass =
    moved > 0.0001 &&
    improvement > 0.0001;

  console.log(
    "[AstraWay] IK GATE 7",
    {
      pass,
      initialError:
        ikInitialError,
      finalError,
      improvement,
      moved,
    }
  );

  if (pass) {
    console.log(
      "[AstraWay] IK GATE 7 GREEN"
    );
  } else {
    console.error(
      "[AstraWay] IK GATE 7 RED"
    );
  }
}

/*
 * =======================================================
 * PRODUCTION PIPELINE ASSERTION
 * =======================================================
 */

function assertProductionPipeline() {
  const required = {
    bodyState,
    bodyStateBinder,
    surfaceQuery,
    contactPerception,
    taskSet,
    contactTaskGenerator,
    taskResolver,
    constraintSet,
    taskConstraintBuilder,
    constraintSolver,
    poseWriter,
  };

  const missing =
    Object.entries(
      required
    )
      .filter(
        ([, value]) =>
          !value
      )
      .map(
        ([name]) =>
          name
      );

  if (
    missing.length > 0
  ) {
    throw new Error(
      `Production pipeline incomplete: ${missing.join(", ")}`
    );
  }
}

/*
 * =======================================================
 * BODY STATE INITIALIZATION
 * =======================================================
 */

function initializeBodyState(
  root
) {
  assertModelRoot(
    root
  );

  assertSkinnedMesh(
    skinnedMesh
  );

  assertSkeleton(
    skinnedMesh
  );

  root.updateMatrixWorld(
    true
  );

  const box =
    new THREE.Box3()
      .setFromObject(
        root
      );

  if (box.isEmpty()) {
    throw new Error(
      "Cannot initialize BodyState: model bounds empty"
    );
  }

  bodyState =
    new BodyState();

  /*
   * Initial world reference.
   *
   * This is only the initial flat-ground backend
   * height. It is NOT the runtime contact authority.
   */
  const groundY =
    box.min.y;

  surfaceQuery =
    new SurfaceQuery({
      groundY,

      defaultSurfaceId:
        "ground",

      defaultSurfaceType:
        "unknown",
    });

  contactPerception =
    new ContactPerception({
      root,

      skeleton,

      skinnedMesh,

      surfaceQuery,

      contactSeparation:
        0.035,

      minConfidence:
        0.4,
    });

  /*
   * Full mesh analysis / probe baking belongs
   * to initialization, not the frame hot loop.
   */
  contactPerception.initialize();

  bodyStateBinder =
    new BodyStateBinder({
      root,

      skeleton,

      skinnedMesh,

      bodyState,

      groundY,

      contactDistance:
        0.08,

      contactVelocityThreshold:
        0.35,

      contactPerception,
    });

  taskSet =
    new TaskSet();

  contactTaskGenerator =
    new ContactTaskGenerator({
      taskSet,
    });

  taskResolver =
    new TaskResolver();

  constraintSet =
    new ConstraintSet();

  taskConstraintBuilder =
    new TaskConstraintBuilder({
      constraintSet,
    });

  constraintSolver =
    new ConstraintSolver({
      skeleton,

      damping:
        0.12,

      maxAngleStep:
        0.18,

      positionTolerance:
        0.001,

      enabled:
        true,
    });

  poseWriter =
    new PoseWriter({
      skeleton,

      enabled:
        true,

      maxRotationPerBone:
        0.18,
    });

  resolvedTaskPlan =
    null;

  solverResult =
    null;

  poseWriteResult =
    null;

  bodyStateFrames =
    0;

  bodyStateLastReport =
    0;

  assertProductionPipeline();

  console.log(
    "[AstraWay] Production runtime initialized",
    {
      skeletonBones:
        skeleton.bones.length,

      groundY,

      solver:
        constraintSolver.getStats(),

      writer:
        poseWriter.snapshot(),

      perception:
        "ContactPerception + SurfaceQuery",
    }
  );
}

/*
 * =======================================================
 * DIAGNOSTIC FORMATTERS
 * =======================================================
 */

function formatDiagnostic(diagnostic) {
  const safe = diagnostic || {};

  const probeCount = Number.isFinite(safe.probeCount)
    ? safe.probeCount
    : 0;

  const nearProbeCount = Number.isFinite(safe.nearProbeCount)
    ? safe.nearProbeCount
    : 0;

  const validProbeCount = Number.isFinite(safe.validProbeCount)
    ? safe.validProbeCount
    : 0;

  const spread = Number.isFinite(safe.spread)
    ? safe.spread.toFixed(3)
    : "INF";

  const confidence = Number.isFinite(safe.confidence)
    ? safe.confidence.toFixed(2)
    : "0.00";

  return (
    `near ${nearProbeCount}/${probeCount} ` +
    `valid ${validProbeCount}/${probeCount} ` +
    `spread ${spread} ` +
    `conf ${confidence}`
  );
}

/*
 * =======================================================
 * PRODUCTION FRAME
 *
 * The pipeline is intentionally linear.
 *
 * No gameplay decisions live here.
 * No bone transforms are written here.
 * =======================================================
 */

function updateBodyState(
  dt
) {
  if (
    runtimePhase !==
    RUNTIME_PHASE.READY
  ) {
    return;
  }

  assertProductionPipeline();

  bodyStateBinder.update(
    dt
  );

  contactTaskGenerator.update(
    bodyState
  );

  resolvedTaskPlan =
    taskResolver.resolve(
      taskSet
    );

  taskConstraintBuilder.update(
    resolvedTaskPlan
  );

  solverResult =
    constraintSolver.solve(
      constraintSet
    );

  poseWriteResult =
    poseWriter.write(
      solverResult
    );

  /*
   * The solver returns a delta.
   * PoseWriter applies it.
   *
   * Only after writing the pose do we refresh
   * world matrices for the next perception pass.
   */
  if (model) {
    model.updateMatrixWorld(
      true
    );
  }

  bodyStateFrames++;

  const now =
    performance.now();

  /*
   * Runtime status is deliberately throttled.
   * The simulation itself is NOT throttled.
   */
  if (
    now -
      bodyStateLastReport <
    100
  ) {
    return;
  }

  bodyStateLastReport =
    now;

  const leftFoot =
    bodyStateBinder.getContact?.(
      "contact_foot_L"
    );

  const rightFoot =
    bodyStateBinder.getContact?.(
      "contact_foot_R"
    );

  const leftPhase =
    leftFoot?.phase ??
    "missing";

  const rightPhase =
    rightFoot?.phase ??
    "missing";

  const diagnostics =
    bodyStateBinder.getDiagnostics?.() ??
    {};

  const leftDiagnostics =
    diagnostics.left ??
    {};

  const rightDiagnostics =
    diagnostics.right ??
    {};

  const support =
    bodyState.getSupportCount?.() ??
    0;

  const balance =
    bodyState.getBalanceError?.() ??
    0;

  const balanceText =
    Number.isFinite(
      balance
    )
      ? balance.toFixed(3)
      : "INF";

  const com =
    bodyState.com;

  const solverStatus =
    solverResult?.status ??
    "none";

  const poseDelta =
    solverResult?.deltaPose?.length ??
    0;

  const conflicts =
    resolvedTaskPlan
      ?.conflicts
      ?.length ??
    0;

  const written =
    poseWriteResult?.applied ??
    0;

  const tasks =
    taskSet.enabledCount?.() ??
    0;

  const hard =
    resolvedTaskPlan?.hard
      ?.length ??
    0;

  const soft =
    resolvedTaskPlan?.soft
      ?.length ??
    0;

  const constraints =
    constraintSet.enabledCount?.() ??
    0;

  setStatus(
    `DLS ${String(
      solverStatus
    ).toUpperCase()} | ` +
    `tasks ${tasks} | ` +
    `hard ${hard} | ` +
    `soft ${soft} | ` +
    `constraints ${constraints} | ` +
    `conflicts ${conflicts} | ` +
    `poseDelta ${poseDelta} | ` +
    `written ${written} | ` +
    `COM ${com.x.toFixed(2)},${com.y.toFixed(2)},${com.z.toFixed(2)} | ` +
    `L ${leftPhase} ${formatDiagnostic(leftDiagnostics)} | ` +
    `R ${rightPhase} ${formatDiagnostic(rightDiagnostics)} | ` +
    `ground ${bodyStateBinder.groundY.toFixed(3)} | ` +
    `support ${support} | ` +
    `balance ${balanceText}`
  );

  if (
    bodyStateFrames === 1 ||
    bodyStateFrames % 60 === 0
  ) {
    console.log(
      "[AstraWay] CONTACT DIAGNOSTICS",
      {
        frame:
          bodyStateFrames,

        groundY:
          bodyStateBinder.groundY,

        left:
          {
            ...leftDiagnostics,
          },

        right:
          {
            ...rightDiagnostics,
          },
      }
    );

    console.log(
      "[AstraWay] PRODUCTION SOLVER",
      {
        frame:
          bodyStateFrames,

        tasks:
          taskSet.snapshot(),

        taskPlan:
          taskResolver.snapshot(),

        constraints:
          constraintSet.snapshot(),

        solver:
          constraintSolver.getStats(),

        solverResult,

        writer:
          poseWriter.snapshot(),
      }
    );
  }
}

/*
 * =======================================================
 * MODEL LOADING
 * =======================================================
 */

async function loadModel() {
  try {
    setRuntimePhase(
      RUNTIME_PHASE.LOADING
    );

    setStatus(
      "1/10 — Loading XBot…"
    );

    /*
     * ---------------------------------------------------
     * 1. Fetch
     * ---------------------------------------------------
     */

    const response =
      await timeout(
        fetch(
          MODEL_URL,
          {
            cache:
              "no-store",
          }
        ),
        10000,
        "Fetch XBot"
      );

    if (!response.ok) {
      throw new Error(
        `XBot HTTP ${response.status}`
      );
    }

    const buffer =
      await timeout(
        response.arrayBuffer(),
        10000,
        "Read GLB"
      );

    if (
      !buffer ||
      buffer.byteLength === 0
    ) {
      throw new Error(
        "XBot GLB buffer is empty"
      );
    }

    /*
     * ---------------------------------------------------
     * 2. Canonical skeleton
     * ---------------------------------------------------
     */

    setStatus(
      "2/10 — Canonicalizing skeleton…"
    );

    const canonical =
      await timeout(
        canonicalizeGLBBones(
          buffer
        ),
        10000,
        "Canonicalization"
      );

    const canonicalBuffer =
      toArrayBuffer(
        canonical
      );

    if (
      !canonicalBuffer ||
      canonicalBuffer.byteLength === 0
    ) {
      throw new Error(
        "Canonical GLB buffer invalid"
      );
    }

    /*
     * ---------------------------------------------------
     * 3. Parse GLB
     * ---------------------------------------------------
     */

    setStatus(
      "3/10 — Parsing GLB…"
    );

    const gltf =
      await timeout(
        loader.parseAsync(
          canonicalBuffer,
          ""
        ),
        10000,
        "GLTF parse"
      );

    if (!gltf?.scene) {
      throw new Error(
        "GLTF scene missing"
      );
    }

    model =
      gltf.scene;

    /*
     * ---------------------------------------------------
     * 4. Find SkinnedMesh
     * ---------------------------------------------------
     */

    skinnedMesh =
      null;

    model.traverse(
      (object) => {
        if (
          object.isSkinnedMesh &&
          !skinnedMesh
        ) {
          skinnedMesh =
            object;
        }
      }
    );

    assertModelRoot(
      model
    );

    assertSkinnedMesh(
      skinnedMesh
    );

    assertSkeleton(
      skinnedMesh
    );

    skeleton =
      skinnedMesh.skeleton;

    scene.add(
      model
    );

    model.updateMatrixWorld(
      true
    );

    /*
     * ---------------------------------------------------
     * 5. Frame model
     * ---------------------------------------------------
     */

    const modelBox =
      frameModel(
        model
      );

    setRuntimePhase(
      RUNTIME_PHASE.VALIDATING
    );

    /*
     * ---------------------------------------------------
     * 6. Skeleton inspection
     * ---------------------------------------------------
     */

    setStatus(
      "4/10 — Inspecting skeleton…"
    );

    const report =
      inspectBones(
        model
      );

    console.log(
      "[AstraWay] Bone report",
      report
    );

    renderBoneReport(
      report
    );

    if (
      report.canonicalFound !==
      report.canonicalTotal
    ) {
      throw new Error(
        `Canonical skeleton RED: ${report.canonicalFound}/${report.canonicalTotal}`
      );
    }

    /*
     * ---------------------------------------------------
     * 7. Pose Gate
     * ---------------------------------------------------
     */

    setStatus(
      "5/10 — Pose Gate…"
    );

    const pose =
      runPoseGate(
        model
      );

    if (!pose.pass) {
      throw new Error(
        `POSE GATE RED — ${pose.passed}/${pose.total}`
      );
    }

    console.log(
      "[AstraWay] POSE GATE GREEN",
      pose
    );

    setStatus(
      `6/10 — Pose Gate GREEN ${pose.passed}/${pose.total}`
    );

    /*
     * ---------------------------------------------------
     * 8. Controlled FK propagation
     * ---------------------------------------------------
     */

    const controlled =
      runControlledPoseTest(
        model
      );

    if (
      !controlled.pass
    ) {
      throw new Error(
        `CONTROLLED POSE RED — ${controlled.passed}/${controlled.total}`
      );
    }

    console.log(
      "[AstraWay] CONTROLLED POSE GREEN",
      controlled
    );

    setStatus(
      `7/10 — Controlled Pose GREEN ${controlled.passed}/${controlled.total}`
    );

    /*
     * ---------------------------------------------------
     * 9. Production Character Core
     * ---------------------------------------------------
     */

    setRuntimePhase(
      RUNTIME_PHASE.INITIALIZING
    );

    initializeBodyState(
      model
    );

    /*
     * ---------------------------------------------------
     * 10. Optional solver bake-off
     *
     * These are explicit test modes.
     * They do not alter production initialization.
     * ---------------------------------------------------
     */

    const params =
      new URLSearchParams(
        window.location.search
      );

    if (
      params.get(
        "gate8a"
      ) === "1"
    ) {
      setStatus(
        "10/10 — Running Gate 8A…"
      );

      const result =
        runClosedChainViability({
          skeleton,

          statusElement:
            status,
        });

      console.log(
        "[AstraWay] GATE 8A",
        result
      );

      return;
    }

    if (
      params.get(
        "gate8b"
      ) === "1"
    ) {
      setStatus(
        "10/10 — Running Gate 8B…"
      );

      const result =
        runClosedChainMultiEffector({
          skeleton,

          statusElement:
            status,
        });

      console.log(
        "[AstraWay] GATE 8B",
        result
      );

      return;
    }

    /*
     * ---------------------------------------------------
     * Production READY
     * ---------------------------------------------------
     */

    runtimePhase =
      RUNTIME_PHASE.READY;

    modelLoadedAt =
      performance.now();

    const loadTime =
      modelLoadedAt -
      runtimeStartedAt;

    setStatus(
      `DLS PRODUCTION READY — ` +
      `skeleton ${skeleton.bones.length} bones | ` +
      `damping ${constraintSolver.damping} | ` +
      `poseWriter ON | ` +
      `ground ${modelBox.min.y.toFixed(3)} | ` +
      `perception ON`
    );

    console.log(
      "[AstraWay] DLS PRODUCTION READY",
      {
        phase:
          runtimePhase,

        skeletonBones:
          skeleton.bones.length,

        loadTimeMs:
          Math.round(
            loadTime
          ),

        solver:
          constraintSolver.getStats(),

        writer:
          poseWriter.snapshot(),

        pipeline:
          [
            "WORLD",
            "SurfaceQuery",
            "ContactPerception",
            "ContactEvidence",
            "BodyStateBinder",
            "ContactState",
            "BodyState",
            "ContactTaskGenerator",
            "TaskResolver",
            "TaskConstraintBuilder",
            "ConstraintSolver",
            "PoseWriter",
            "Skeleton",
          ],
      }
    );

  } catch (error) {
    failRuntime(
      error,
      "Character Lab ERROR"
    );
  }
}

/*
 * =======================================================
 * RENDER LOOP
 * =======================================================
 */

function animate() {
  requestAnimationFrame(
    animate
  );

  const now =
    performance.now();

  let dt =
    (
      now -
      lastFrameTime
    ) /
    1000;

  lastFrameTime =
    now;

  /*
   * Prevent huge simulation jumps after
   * tab switching / browser throttling.
   */
  if (
    !Number.isFinite(dt) ||
    dt < 0
  ) {
    dt = 0;
  }

  if (
    dt > 0.05
  ) {
    droppedFrameCount++;
    dt = 0.05;
  }

  frameCount++;

  /*
   * Gate 7 is intentionally independent
   * from production Character Core.
   */
  if (
    runtimePhase ===
    RUNTIME_PHASE.READY
  ) {
    updateIKGate();

    updateBodyState(
      dt
    );
  }

  renderer.render(
    scene,
    camera
  );
}

/*
 * =======================================================
 * RESIZE
 * =======================================================
 */

function handleResize() {
  const width =
    Math.max(
      window.innerWidth,
      1
    );

  const height =
    Math.max(
      window.innerHeight,
      1
    );

  camera.aspect =
    width /
    height;

  camera.updateProjectionMatrix();

  renderer.setSize(
    width,
    height,
    false
  );

  renderer.setPixelRatio(
    Math.min(
      window.devicePixelRatio || 1,
      2
    )
  );
}

window.addEventListener(
  "resize",
  handleResize,
  {
    passive: true,
  }
);

/*
 * =======================================================
 * BOOT
 * =======================================================
 */

setRuntimePhase(
  RUNTIME_PHASE.BOOT
);

loadModel();

animate();
