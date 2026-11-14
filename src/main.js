
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
import { Reachability } from "./character/Reachability.js";
import { TerrainPerception } from "./character/TerrainPerception.js";

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

let terrainPerception = null;

const terrainOrigin =
  new THREE.Vector3();

const terrainForward =
  new THREE.Vector3();

const terrainQuaternion =
  new THREE.Quaternion();

let terrainLastScanAt = 0;

let terrainLastLogAt = 0;

let reachability = null;

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
    !foot
  ) {
    throw new Error(
      "IK hierarchy RED: thigh → shin → foot"
    );
  }

  const bones =
    skin.skeleton.bones;

  const thighIndex =
    bones.indexOf(
      thigh
    );

  const shinIndex =
    bones.indexOf(
      shin
    );

  const footIndex =
    bones.indexOf(
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

  ikTarget.position.y +=
    0.12;

  ikTarget.position.z +=
    0.08;

  scene.add(
    ikTarget
  );

  scene.updateMatrixWorld(
    true
  );

  ikMarker =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.03,
        12,
        12
      ),
      new THREE.MeshBasicMaterial({
        color:
          0xff3355,
      })
    );

  ikMarker.position.copy(
    ikTarget.position
  );

  scene.add(
    ikMarker
  );

  root.updateMatrixWorld(
    true
  );

  ikInitialFoot =
    footWorld.clone();

  ikTargetPosition =
    ikTarget.position.clone();

  ikInitialError =
    ikInitialFoot.distanceTo(
      ikTargetPosition
    );

  ikSolver =
    new CCDIKSolver(
      skin
    );

  ikSolver.createChain(
    [
      thighIndex,
      shinIndex,
      footIndex,
    ],
    ikTarget
  );

  ikSolver.setConfiguration({
    iteration:
      10,
    damping:
      0.5,
  });

  ikFrames =
    0;

  ikFinished =
    false;

  console.log(
    "[AstraWay] IK GATE 7 prepared",
    {
      initialError:
        ikInitialError.toFixed(
          4
        ),
    }
  );
}

function updateIKGate() {
  if (
    !ikSolver ||
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

  const foot =
    findBone(
      model,
      "foot_L"
    );

  if (!foot) {
    console.error(
      "IK GATE RED — foot missing"
    );
    ikFinished =
      true;
    return;
  }

  model.updateMatrixWorld(
    true
  );

  const current =
    new THREE.Vector3();

  foot.getWorldPosition(
    current
  );

  const error =
    current.distanceTo(
      ikTargetPosition
    );

  const improved =
    error <
    ikInitialError *
      0.35;

  console.log(
    "[AstraWay] IK GATE 7",
    {
      frames:
        ikFrames,
      initialError:
        ikInitialError.toFixed(
          4
        ),
      finalError:
        error.toFixed(
          4
        ),
      improved,
    }
  );

  if (
    improved
  ) {
    console.log(
      "[AstraWay] IK GATE 7 GREEN"
    );
  } else {
    console.warn(
      "[AstraWay] IK GATE 7 RED"
    );
  }

  ikFinished =
    true;
}

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

  // Perception V1: регистрируем геометрию мира.
  // Пока регистрируем существующий визуальный ground.
  // Позже сюда будут добавляться платформы, ступени, стены и т.д.
  if (typeof ground !== "undefined" && ground) {
    surfaceQuery.addMesh(ground);
  }

  /*
   * Terrain perception observes local geometry.
   * It does not participate in the movement pipeline yet.
   */
  terrainPerception =
    new TerrainPerception({
      surfaceQuery,
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

  reachability =
    new Reachability({
      root,
      skeleton,
    });

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
        "ContactPerception + TerrainPerception + SurfaceQuery",
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

  /*
   * =====================================================
   * TERRAIN PERCEPTION
   *
   * Observation only.
   *
   * No movement decisions.
   * No tasks.
   * No bone writes.
   *
   * Scan frequency: 4 Hz.
   * =====================================================
   */

  const terrainNow =
    performance.now();

  if (
    terrainPerception &&
    model &&
    terrainNow - terrainLastScanAt >= 250
  ) {
    terrainLastScanAt =
      terrainNow;

    model.getWorldPosition(
      terrainOrigin
    );

    model.getWorldQuaternion(
      terrainQuaternion
    );

    /*
     * Provisional forward direction: local +Z.
     * This orientation must be verified in runtime.
     */
    terrainForward
      .set(0, 0, 1)
      .applyQuaternion(
        terrainQuaternion
      )
      .setY(0)
      .normalize();

    const terrain =
      terrainPerception.scan({
        origin: terrainOrigin,
        forward: terrainForward,
      });

    if (
      terrainNow - terrainLastLogAt >= 1000
    ) {
      terrainLastLogAt =
        terrainNow;

      let minHeight = Infinity;
      let maxHeight = -Infinity;

      for (const sample of terrain.samples) {
        if (!sample.valid) {
          continue;
        }

        minHeight = Math.min(
          minHeight,
          sample.height
        );

        maxHeight = Math.max(
          maxHeight,
          sample.height
        );
      }

      console.log(
        "[AstraWay] TERRAIN PERCEPTION",
        {
          valid:
            terrain.validCount,

          missing:
            terrain.missingCount,

          steep:
            terrain.steepCount,

          discontinuities:
            terrain.discontinuityCount,

          minHeight:
            Number.isFinite(minHeight)
              ? minHeight.toFixed(3)
              : null,

          maxHeight:
            Number.isFinite(maxHeight)
              ? maxHeight.toFixed(3)
              : null,

          forward:
            terrainForward
              .toArray()
              .map(
                (value) => value.toFixed(2)
              ),
        }
      );
    }
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

    const modelBox =
      frameModel(
        model
      );

    setRuntimePhase(
      RUNTIME_PHASE.VALIDATING
    );

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

    setRuntimePhase(
      RUNTIME_PHASE.INITIALIZING
    );

    initializeBodyState(
      model
    );

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
