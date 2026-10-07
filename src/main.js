import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { canonicalizeGLBBones } from "@three-ws/retarget";

import {
  inspectBones,
  renderBoneReport,
} from "./bone-inspector.js";

import { BONE_MAP } from "./character/BoneMap.js";

const canvas = document.querySelector("#viewer");
const status = document.querySelector("#status");

if (!canvas) throw new Error("Canvas #viewer не найден");
if (!status) throw new Error("Элемент #status не найден");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});

renderer.setPixelRatio(
  Math.min(window.devicePixelRatio, 2)
);

renderer.setSize(
  window.innerWidth,
  window.innerHeight
);

renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

scene.background = new THREE.Color(
  0x090b10
);

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
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

function setStatus(message) {
  status.textContent = message;

  console.log(
    `[AstraWay] ${message}`
  );
}

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

function toArrayBuffer(value) {
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

function frameModel(root) {
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

  camera.lookAt(center);

  ground.position.y =
    box.min.y;
}

/*
 * ---------------------------------------------------------
 * POSE GATE
 * ---------------------------------------------------------
 */

function runPoseGate(root) {
  const results = [];

  const find = (
    logicalName
  ) => {
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
  };

  /*
   * TEST 1
   *
   * Все 22 logical joints
   * существуют в реальном skeleton.
   */

  const logicalNames =
    Object.keys(
      BONE_MAP
    );

  const missingLogical =
    logicalNames.filter(
      (name) => !find(name)
    );

  results.push({
    name:
      "BoneMap 22/22",

    pass:
      missingLogical.length === 0,

    detail:
      missingLogical.length === 0
        ? "all logical bones found"
        : `missing: ${missingLogical.join(", ")}`,
  });

  /*
   * TEST 2
   *
   * Реальная иерархия ноги.
   */

  const thighL =
    find("thigh_L");

  const shinL =
    find("shin_L");

  const footL =
    find("foot_L");

  const legHierarchyPass =
    !!thighL &&
    !!shinL &&
    !!footL &&
    shinL.parent === thighL &&
    footL.parent === shinL;

  results.push({
    name:
      "Leg hierarchy",

    pass:
      legHierarchyPass,

    detail:
      legHierarchyPass
        ? "thigh → shin → foot"
        : "hierarchy mismatch",
  });

  /*
   * TEST 3
   *
   * Parent rotation moves child
   * in world space.
   */

  const upperArm =
    find("upperArm_L");

  const foreArm =
    find("foreArm_L");

  let propagationPass =
    false;

  let armDelta = 0;

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

    armDelta =
      before.distanceTo(
        after
      );

    upperArm.quaternion.copy(
      original
    );

    root.updateMatrixWorld(
      true
    );

    propagationPass =
      armDelta > 0.001;
  }

  results.push({
    name:
      "Quaternion propagation",

    pass:
      propagationPass,

    detail:
      `child world delta=${armDelta.toFixed(4)}`,
  });

  /*
   * TEST 4
   *
   * Реальный SkinnedMesh.
   */

  let skinnedMesh =
    null;

  root.traverse(
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

  results.push({
    name:
      "SkinnedMesh",

    pass:
      !!skinnedMesh,

    detail:
      skinnedMesh
        ? "skin found"
        : "no SkinnedMesh",
  });

  /*
   * TEST 5
   *
   * Spine hierarchy.
   */

  const spine01 =
    find("spine01");

  const spine02 =
    find("spine02");

  const chest =
    find("chest");

  const neck =
    find("neck");

  const head =
    find("head");

  const spinePass =
    !!spine01 &&
    !!spine02 &&
    !!chest &&
    !!neck &&
    !!head &&
    spine02.parent === spine01 &&
    chest.parent === spine02 &&
    neck.parent === chest &&
    head.parent === neck;

  results.push({
    name:
      "Spine hierarchy",

    pass:
      spinePass,

    detail:
      spinePass
        ? "spine → chest → neck → head"
        : "spine hierarchy mismatch",
  });

  const passCount =
    results.filter(
      (r) => r.pass
    ).length;

  return {
    results,

    passCount,

    total:
      results.length,

    pass:
      passCount ===
      results.length,
  };
}

/*
 * ---------------------------------------------------------
 * CONTROLLED POSE TEST
 * ---------------------------------------------------------
 *
 * Это уже не просто проверка существования костей.
 *
 * Мы:
 *
 * 1. сохраняем исходную позу;
 * 2. изменяем parent;
 * 3. проверяем child;
 * 4. восстанавливаем;
 * 5. проверяем возврат.
 */

function runControlledPoseTest(
  root
) {
  const results = [];

  const find = (
    logicalName
  ) => {
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
  };

  /*
   * ARM TEST
   */

  const upperArm =
    find("upperArm_L");

  const foreArm =
    find("foreArm_L");

  let armPass =
    false;

  let armMove =
    0;

  let armRestoreError =
    0;

  if (
    upperArm &&
    foreArm
  ) {
    root.updateMatrixWorld(
      true
    );

    const originalRotation =
      upperArm.quaternion.clone();

    const originalChild =
      new THREE.Vector3();

    foreArm.getWorldPosition(
      originalChild
    );

    upperArm.rotateZ(
      THREE.MathUtils.degToRad(
        25
      )
    );

    root.updateMatrixWorld(
      true
    );

    const movedChild =
      new THREE.Vector3();

    foreArm.getWorldPosition(
      movedChild
    );

    armMove =
      originalChild.distanceTo(
        movedChild
      );

    upperArm.quaternion.copy(
      originalRotation
    );

    root.updateMatrixWorld(
      true
    );

    const restoredChild =
      new THREE.Vector3();

    foreArm.getWorldPosition(
      restoredChild
    );

    armRestoreError =
      originalChild.distanceTo(
        restoredChild
      );

    armPass =
      armMove > 0.001 &&
      armRestoreError < 0.0001;
  }

  results.push({
    name:
      "Arm mutation",

    pass:
      armPass,

    detail:
      `move=${armMove.toFixed(4)}, restoreError=${armRestoreError.toFixed(6)}`,
  });

  /*
   * LEG TEST
   */

  const thigh =
    find("thigh_L");

  const shin =
    find("shin_L");

  const foot =
    find("foot_L");

  let legPass =
    false;

  let legMove =
    0;

  let legRestoreError =
    0;

  if (
    thigh &&
    shin &&
    foot
  ) {
    root.updateMatrixWorld(
      true
    );

    const originalRotation =
      thigh.quaternion.clone();

    const originalFoot =
      new THREE.Vector3();

    foot.getWorldPosition(
      originalFoot
    );

    thigh.rotateZ(
      THREE.MathUtils.degToRad(
        -18
      )
    );

    root.updateMatrixWorld(
      true
    );

    const movedFoot =
      new THREE.Vector3();

    foot.getWorldPosition(
      movedFoot
    );

    legMove =
      originalFoot.distanceTo(
        movedFoot
      );

    thigh.quaternion.copy(
      originalRotation
    );

    root.updateMatrixWorld(
      true
    );

    const restoredFoot =
      new THREE.Vector3();

    foot.getWorldPosition(
      restoredFoot
    );

    legRestoreError =
      originalFoot.distanceTo(
        restoredFoot
      );

    legPass =
      legMove > 0.001 &&
      legRestoreError < 0.0001;
  }

  results.push({
    name:
      "Leg mutation",

    pass:
      legPass,

    detail:
      `move=${legMove.toFixed(4)}, restoreError=${legRestoreError.toFixed(6)}`,
  });

  /*
   * SPINE TEST
   */

  const spine =
    find("spine01");

  const chest =
    find("chest");

  const head =
    find("head");

  let spineMutationPass =
    false;

  let headMove =
    0;

  let headRestoreError =
    0;

  if (
    spine &&
    chest &&
    head
  ) {
    root.updateMatrixWorld(
      true
    );

    const originalRotation =
      spine.quaternion.clone();

    const originalHead =
      new THREE.Vector3();

    head.getWorldPosition(
      originalHead
    );

    spine.rotateZ(
      THREE.MathUtils.degToRad(
        12
      )
    );

    root.updateMatrixWorld(
      true
    );

    const movedHead =
      new THREE.Vector3();

    head.getWorldPosition(
      movedHead
    );

    headMove =
      originalHead.distanceTo(
        movedHead
      );

    spine.quaternion.copy(
      originalRotation
    );

    root.updateMatrixWorld(
      true
    );

    const restoredHead =
      new THREE.Vector3();

    head.getWorldPosition(
      restoredHead
    );

    headRestoreError =
      originalHead.distanceTo(
        restoredHead
      );

    spineMutationPass =
      headMove > 0.001 &&
      headRestoreError < 0.0001;
  }

  results.push({
    name:
      "Spine mutation",

    pass:
      spineMutationPass,

    detail:
      `move=${headMove.toFixed(4)}, restoreError=${headRestoreError.toFixed(6)}`,
  });

  const passCount =
    results.filter(
      (r) => r.pass
    ).length;

  const total =
    results.length;

  console.table(
    results
  );

  return {
    results,

    passCount,

    total,

    pass:
      passCount === total,
  };
}

/*
 * ---------------------------------------------------------
 * LOAD
 * ---------------------------------------------------------
 */

async function loadModel() {
  try {
    setStatus(
      "1/10 — Loading local XBot…"
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
      `2/10 — GLB ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`
    );

    setStatus(
      "3/10 — Canonicalizing skeleton…"
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

    if (!canonicalBuffer) {
      throw new Error(
        "Canonical GLB buffer invalid"
      );
    }

    setStatus(
      "4/10 — Parsing GLB…"
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

    scene.add(
      model
    );

    frameModel(
      model
    );

    setStatus(
      "5/10 — Inspecting skeleton…"
    );

    const report =
      inspectBones(
        model
      );

    console.log(
      "[AstraWay] Bone report:",
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
      "6/10 — Running Pose Gate…"
    );

    const pose =
      runPoseGate(
        model
      );

    if (!pose.pass) {
      console.error(
        "[AstraWay] POSE GATE FAILED",
        pose
      );

      status.textContent =
        `POSE GATE RED — ${pose.passCount}/${pose.total}`;

      return;
    }

    setStatus(
      "7/10 — Pose Gate GREEN"
    );

    /*
     * Контролируемая мутация.
     */

    setStatus(
      "8/10 — Running Controlled Pose Test…"
    );

    const controlled =
      runControlledPoseTest(
        model
      );

    if (
      !controlled.pass
    ) {
      console.error(
        "[AstraWay] CONTROLLED POSE FAILED",
        controlled
      );

      status.textContent =
        `CONTROLLED POSE RED — ${controlled.passCount}/${controlled.total}`;

      return;
    }

    console.log(
      "[AstraWay] CONTROLLED POSE GREEN",
      controlled
    );

    setStatus(
      "9/10 — Pose mutation verified"
    );

    status.textContent =
      `POSE SYSTEM GREEN — hierarchy + mutation ${controlled.passCount}/${controlled.total}`;

    console.log(
      "[AstraWay] FINAL POSE GATE GREEN"
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
 * ---------------------------------------------------------
 * RENDER
 * ---------------------------------------------------------
 */

function animate() {
  requestAnimationFrame(
    animate
  );

  if (model) {
    model.rotation.y +=
      0.0025;
  }

  renderer.render(
    scene,
    camera
  );
}

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
