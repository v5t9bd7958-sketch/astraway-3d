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

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b10);

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
  0.01,
  100
);

camera.position.set(0, 1.2, 4);

scene.add(
  new THREE.HemisphereLight(
    0xdde8ff,
    0x20232b,
    2.2
  )
);

const keyLight = new THREE.DirectionalLight(
  0xffffff,
  2.5
);

keyLight.position.set(2, 4, 3);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(
  0x8fa8ff,
  1
);

fillLight.position.set(-3, 2, -2);
scene.add(fillLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({
    color: 0x151922,
    roughness: 0.9,
  })
);

ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const MODEL_URL =
  `${import.meta.env.BASE_URL}models/Xbot.glb`;

let model = null;

function setStatus(message) {
  status.textContent = message;
  console.log(`[AstraWay] ${message}`);
}

function timeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(
          new Error(`${name}: timeout ${ms / 1000}s`)
        ),
        ms
      );
    }),
  ]);
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;

  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength
    );
  }

  return value?.buffer
    ? toArrayBuffer(value.buffer)
    : null;
}

function frameModel(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxSize = Math.max(
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
    center.y + maxSize * 0.08,
    center.z + distance * 1.25
  );

  camera.lookAt(center);
  ground.position.y = box.min.y;
}

/*
 * POSE GATE
 *
 * Проверяем реальный skeleton graph,
 * parent → child propagation,
 * quaternion,
 * skin,
 * BoneMap.
 */
function runPoseGate(root) {
  const results = [];

  const find = (logicalName) => {
    const canonicalName = BONE_MAP[logicalName];

    if (!canonicalName) return null;

    return root.getObjectByName(canonicalName);
  };

  /*
   * TEST 1
   * Все 22 logical bones существуют.
   */
  const logicalNames = Object.keys(BONE_MAP);

  const missingLogical = logicalNames.filter(
    (name) => !find(name)
  );

  results.push({
    name: "BoneMap 22/22",
    pass: missingLogical.length === 0,
    detail:
      missingLogical.length === 0
        ? "all logical bones found"
        : `missing: ${missingLogical.join(", ")}`,
  });

  /*
   * TEST 2
   * Реальная parent → child иерархия.
   */
  const thighL = find("thigh_L");
  const shinL = find("shin_L");
  const footL = find("foot_L");

  const hierarchyPass =
    !!thighL &&
    !!shinL &&
    !!footL &&
    shinL.parent === thighL &&
    footL.parent === shinL;

  results.push({
    name: "Leg hierarchy",
    pass: hierarchyPass,
    detail: hierarchyPass
      ? "thigh → shin → foot"
      : "hierarchy mismatch",
  });

  /*
   * TEST 3
   * Quaternion rotation родителя
   * реально двигает child в world space.
   */
  const upperArm = find("upperArm_L");
  const foreArm = find("foreArm_L");

  let propagationPass = false;
  let delta = 0;

  if (upperArm && foreArm) {
    root.updateMatrixWorld(true);

    const before =
      new THREE.Vector3();

    foreArm.getWorldPosition(before);

    const original =
      upperArm.quaternion.clone();

    upperArm.rotateZ(
      THREE.MathUtils.degToRad(30)
    );

    root.updateMatrixWorld(true);

    const after =
      new THREE.Vector3();

    foreArm.getWorldPosition(after);

    delta = before.distanceTo(after);

    upperArm.quaternion.copy(original);
    root.updateMatrixWorld(true);

    propagationPass = delta > 0.001;
  }

  results.push({
    name: "Quaternion propagation",
    pass: propagationPass,
    detail: `child world delta=${delta.toFixed(4)}`,
  });

  /*
   * TEST 4
   * SkinnedMesh реально существует.
   */
  let skinnedMesh = null;

  root.traverse((object) => {
    if (object.isSkinnedMesh && !skinnedMesh) {
      skinnedMesh = object;
    }
  });

  results.push({
    name: "SkinnedMesh",
    pass: !!skinnedMesh,
    detail: skinnedMesh
      ? "skin found"
      : "no SkinnedMesh",
  });

  /*
   * TEST 5
   * Spine → chest → neck → head
   * реально образуют цепь.
   */
  const spine01 = find("spine01");
  const spine02 = find("spine02");
  const chest = find("chest");
  const neck = find("neck");
  const head = find("head");

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
    name: "Spine hierarchy",
    pass: spinePass,
    detail: spinePass
      ? "spine → chest → neck → head"
      : "spine hierarchy mismatch",
  });

  const passCount =
    results.filter((r) => r.pass).length;

  const total = results.length;
  const pass = passCount === total;

  console.table(results);

  return {
    results,
    passCount,
    total,
    pass,
  };
}

async function loadModel() {
  try {
    setStatus("1/8 — Loading local XBot…");

    const response = await timeout(
      fetch(MODEL_URL, {
        cache: "no-store",
      }),
      10000,
      "Fetch XBot"
    );

    if (!response.ok) {
      throw new Error(
        `XBot HTTP ${response.status}`
      );
    }

    const buffer = await timeout(
      response.arrayBuffer(),
      10000,
      "Read GLB"
    );

    setStatus(
      `2/8 — GLB ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`
    );

    setStatus("3/8 — Canonicalizing skeleton…");

    const canonical =
      await timeout(
        canonicalizeGLBBones(buffer),
        10000,
        "Canonicalization"
      );

    const canonicalBuffer =
      toArrayBuffer(canonical);

    if (!canonicalBuffer) {
      throw new Error(
        "Canonical GLB buffer invalid"
      );
    }

    setStatus("4/8 — Parsing GLB…");

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

    model = gltf.scene;
    scene.add(model);

    frameModel(model);

    setStatus("5/8 — Inspecting skeleton…");

    const report =
      inspectBones(model);

    console.log(
      "[AstraWay] Bone report:",
      report
    );

    renderBoneReport(report);

    if (
      report.canonicalFound !==
      report.canonicalTotal
    ) {
      throw new Error(
        `Canonical skeleton RED: ${report.canonicalFound}/${report.canonicalTotal}`
      );
    }

    setStatus(
      "6/8 — Running Pose Gate…"
    );

    const pose =
      runPoseGate(model);

    if (!pose.pass) {
      console.error(
        "[AstraWay] POSE GATE FAILED",
        pose
      );

      status.textContent =
        `POSE GATE RED — ${pose.passCount}/${pose.total}`;

      return;
    }

    console.log(
      "[AstraWay] POSE GATE GREEN",
      pose
    );

    status.textContent =
      `POSE GATE GREEN — ${pose.passCount}/${pose.total}`;
  } catch (error) {
    console.error(
      "[AstraWay] Character Lab ERROR",
      error
    );

    status.textContent =
      `❌ ${error.message}`;
  }
}

function animate() {
  requestAnimationFrame(animate);

  if (model) {
    model.rotation.y += 0.0025;
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
