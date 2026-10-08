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

import {
  runClosedChainViability,
} from "./solver-bakeoff/ClosedChainViability.js";

import {
  runClosedChainMultiEffector,
} from "./solver-bakeoff/ClosedChainMultiEffector.js";

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
    window.devicePixelRatio,
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
  new THREE.Color(0x090b10);

const camera =
  new THREE.PerspectiveCamera(
    35,
    window.innerWidth /
      window.innerHeight,
    0.01,
    100
  );

camera.position.set(
  0,
  1.2,
  4
);

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

scene.add(keyLight);

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

scene.add(fillLight);

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

scene.add(ground);

const loader =
  new GLTFLoader();

loader.setMeshoptDecoder(
  MeshoptDecoder
);

const MODEL_URL =
  `${import.meta.env.BASE_URL}models/Xbot.glb`;

let model = null;
let skinnedMesh = null;
let skeleton = null;

/*
 * -------------------------------------------------------
 * BODY STATE RUNTIME
 * -------------------------------------------------------
 */

let bodyState = null;
let bodyStateBinder = null;

let bodyStateFrames = 0;
let bodyStateLastReport = 0;

/*
 * -------------------------------------------------------
 * IK GATE 7
 * -------------------------------------------------------
 */

let ikSolver = null;
let ikTarget = null;
let ikMarker = null;

let ikFrames = 0;
let ikFinished = false;

let ikInitialError = 0;
let ikInitialFoot = null;
let ikTargetPosition = null;

const IK_TEST_FRAMES = 60;

/*
 * -------------------------------------------------------
 * STATUS
 * -------------------------------------------------------
 */

function setStatus(message) {
  status.textContent =
    message;

  console.log(
    `[AstraWay] ${message}`
  );
}

/*
 * -------------------------------------------------------
 * UTILS
 * -------------------------------------------------------
 */

function timeout(
  promise,
  ms,
  name
) {
  return Promise.race([
    promise,

    new Promise(
      (_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `${name}: timeout ${ms / 1000}s`
              )
            ),
          ms
        );
      }
    ),
  ]);
}

function toArrayBuffer(
  value
) {
  if (
    value instanceof ArrayBuffer
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

  return value?.buffer
    ? toArrayBuffer(
        value.buffer
      )
    : null;
}

function findBone(
  root,
  logicalName
) {
  const canonicalName =
    BONE_MAP[
      logicalName
    ];

  return canonicalName
    ? root.getObjectByName(
        canonicalName
      )
    : null;
}

/*
 * -------------------------------------------------------
 * CAMERA / MODEL FRAMING
 * -------------------------------------------------------
 */

function frameModel(
  root
) {
  const box =
    new THREE.Box3()
      .setFromObject(root);

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

  const distance =
    maxSize /
    (
      2 *
      Math.tan(
        THREE.MathUtils.degToRad(
          camera.fov * 0.5
        )
      )
    );

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

  ground.position.y =
    box.min.y;

  return box;
}

/*
 * -------------------------------------------------------
 * POSE GATE
 * -------------------------------------------------------
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
  };
}

/*
 * -------------------------------------------------------
 * CONTROLLED POSE TEST
 * -------------------------------------------------------
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
 * -------------------------------------------------------
 * GATE 7 — THREE.JS CCD IK
 * -------------------------------------------------------
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

  if (
    !skin?.skeleton
  ) {
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

  root.updateMatrixWorld(
    true
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
    iterations: 1,
    thresholdTargetSq:
      0.00000001,
    thresholdIterSqDist:
      0.00000001,
  });
}

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
    setStatus(
      `9/10 — IK Gate 7 ${ikFrames}/${IK_TEST_FRAMES}`
    );

    return;
  }

  ikFinished = true;

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

  setStatus(
    pass
      ? `IK GATE GREEN — foot moved ${moved.toFixed(4)} | error ${ikInitialError.toFixed(4)} → ${finalError.toFixed(4)}`
      : `IK GATE RED — moved ${moved.toFixed(4)} | error ${ikInitialError.toFixed(4)} → ${finalError.toFixed(4)}`
  );

  console.log(
    "[AstraWay] IK GATE 7",
    {
      initialError:
        ikInitialError,
      finalError,
      improvement,
      moved,
    }
  );
}

/*
 * -------------------------------------------------------
 * BODY STATE
 * -------------------------------------------------------
 */

function initializeBodyState(
  root
) {
  const box =
    new THREE.Box3()
      .setFromObject(root);

  bodyState =
    new BodyState();

  bodyStateBinder =
    new BodyStateBinder({
      root,
      skeleton,
      bodyState,
      groundY:
        box.min.y,
      contactDistance:
        0.08,
      contactVelocityThreshold:
        0.35,
    });

  bodyStateFrames = 0;
  bodyStateLastReport = 0;

  console.log(
    "[AstraWay] BodyState initialized",
    {
      groundY:
        box.min.y,
      contacts:
        [
          ...bodyState.contacts.keys(),
        ],
    }
  );
}

function updateBodyState(
  dt
) {
  if (
    !bodyStateBinder ||
    !bodyState
  ) {
    return;
  }

  bodyStateBinder.update(
    dt
  );

  bodyStateFrames++;

  /*
   * Не спамим DOM каждый кадр.
   * Диагностика обновляется
   * примерно 10 раз в секунду.
   */
  const now =
    performance.now();

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
    bodyStateBinder.getContact(
      "contact_foot_L"
    );

  const rightFoot =
    bodyStateBinder.getContact(
      "contact_foot_R"
    );

  const leftPhase =
    leftFoot?.phase ??
    "missing";

  const rightPhase =
    rightFoot?.phase ??
    "missing";

  const support =
    bodyState.getSupportCount();

  const balance =
    bodyState.getBalanceError();

  const balanceText =
    Number.isFinite(balance)
      ? balance.toFixed(3)
      : "INF";

  const com =
    bodyState.com;

  setStatus(
    `BODY STATE GREEN — ` +
    `COM ${com.x.toFixed(2)},${com.y.toFixed(2)},${com.z.toFixed(2)} | ` +
    `L ${leftPhase} | ` +
    `R ${rightPhase} | ` +
    `support ${support} | ` +
    `balance ${balanceText}`
  );

  if (
    bodyStateFrames ===
    1 ||
    bodyStateFrames % 60 ===
    0
  ) {
    console.log(
      "[AstraWay] BODY STATE",
      {
        frame:
          bodyStateFrames,
        position:
          bodyState.position.toArray(),
        velocity:
          bodyState.velocity.toArray(),
        com:
          bodyState.com.toArray(),
        comVelocity:
          bodyState.comVelocity.toArray(),
        supportCount:
          bodyState.supportCount,
        supportPolygon:
          bodyState.supportPolygon.map(
            (p) =>
              p.toArray()
          ),
        balanceError:
          bodyState.balanceError,
        grounded:
          bodyState.grounded,
        stable:
          bodyState.stable,
        leftFoot:
          leftPhase,
        rightFoot:
          rightPhase,
      }
    );
  }
}

/*
 * -------------------------------------------------------
 * MODEL
 * -------------------------------------------------------
 */

async function loadModel() {
  try {
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
      !canonicalBuffer
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

    if (
      !skinnedMesh?.skeleton
    ) {
      throw new Error(
        "SkinnedMesh/Skeleton missing"
      );
    }

    skeleton =
      skinnedMesh.skeleton;

    scene.add(
      model
    );

    const modelBox =
      frameModel(
        model
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

    setStatus(
      `7/10 — Controlled Pose GREEN ${controlled.passed}/${controlled.total}`
    );

    /*
     * BodyState подключается
     * ПОСЛЕ всех pose-проверок.
     *
     * Никакой IK здесь ещё
     * не меняет скелет.
     */
    initializeBodyState(
      model
    );

    /*
     * ---------------------------------------------------
     * OPTIONAL LAB GATES
     * -------------------------------------------------
     *
     * Старые solver gates сохраняем.
     * Они запускаются только
     * через query parameter.
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
     * NORMAL CHARACTER RUNTIME
     * -------------------------------------------------
     *
     * Здесь специально НЕТ:
     *
     * Gait
     * Tasks
     * IK
     * Solver
     *
     * Мы сначала измеряем тело.
     */

    setStatus(
      `BODY STATE GREEN — runtime initialized | ground ${modelBox.min.y.toFixed(3)}`
    );

  } catch (error) {
    console.error(
      "[AstraWay] Character Lab ERROR",
      error
    );

    status.textContent =
      `❌ ${error.message}`;
  }
}

/*
 * -------------------------------------------------------
 * RENDER / GAME LOOP
 * -------------------------------------------------------
 */

let lastTime =
  performance.now();

function animate() {
  requestAnimationFrame(
    animate
  );

  const now =
    performance.now();

  let dt =
    (now - lastTime) /
    1000;

  lastTime = now;

  /*
   * Защита от огромного dt
   * после сворачивания вкладки.
   */
  dt =
    Math.min(
      dt,
      0.05
    );

  /*
   * Старый IK Gate запускается
   * только если solver был
   * подготовлен.
   */
  updateIKGate();

  /*
   * Главный новый runtime:
   *
   * Skeleton
   *    ↓
   * Binder
   *    ↓
   * BodyState
   *    ↓
   * Contacts
   *    ↓
   * Support / Balance
   */
  updateBodyState(
    dt
  );

  renderer.render(
    scene,
    camera
  );
}

/*
 * -------------------------------------------------------
 * RESIZE
 * -------------------------------------------------------
 */

window.addEventListener(
  "resize",
  () => {
    camera.aspect =
      window.innerWidth /
      window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        2
      )
    );
  }
);

loadModel();
animate();
