import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { canonicalizeGLBBones } from "@three-ws/retarget";
import { inspectBones, renderBoneReport } from "./bone-inspector.js";
const canvas = document.querySelector("#viewer");
const status = document.querySelector("#status");
if (!canvas) {
  throw new Error("Canvas #viewer не найден");
}
if (!status) {
  throw new Error("Элемент #status не найден");
}
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
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
const ambient = new THREE.HemisphereLight(0xdde8ff, 0x20232b, 2.2);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(2, 4, 3);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8fa8ff, 1.0);
fillLight.position.set(-3, 2, -2);
scene.add(fillLight);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({
    color: 0x151922,
    roughness: 0.9,
    metalness: 0,
  })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const MODEL_URL =
  "https://threejs.org/examples/models/gltf/Xbot.glb";
let model = null;
function setStatus(message) {
  status.textContent = message;
  console.log(`[AstraWay] ${message}`);
}
function withTimeout(promise, milliseconds, stage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `${stage}: таймаут ${milliseconds / 1000} сек.`
          )
        );
      }, milliseconds);
    }),
  ]);
}
function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength
    );
  }
  if (value && value.buffer) {
    return toArrayBuffer(value.buffer);
  }
  return null;
}
function describeValue(value) {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (value instanceof ArrayBuffer) {
    return `ArrayBuffer(${value.byteLength})`;
  }
  if (ArrayBuffer.isView(value)) {
    return `${value.constructor.name}(${value.byteLength})`;
  }
  if (typeof value === "object") {
    return `object keys=[${Object.keys(value).join(", ")}]`;
  }
  return typeof value;
}
function frameModel(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const distance =
    maxSize /
    (2 * Math.tan(
      THREE.MathUtils.degToRad(camera.fov * 0.5)
    ));
  camera.position.set(
    center.x,
    center.y + maxSize * 0.08,
    center.z + distance * 1.25
  );
  camera.lookAt(center);
  ground.position.y = box.min.y;
}
async function loadModel() {
  try {
    setStatus("1/7 — Запрос X Bot…");
    const response = await withTimeout(
      fetch(MODEL_URL, {
        cache: "no-store",
      }),
      10000,
      "Fetch X Bot"
    );
    setStatus(
      `2/7 — Ответ сервера: HTTP ${response.status}`
    );
    if (!response.ok) {
      throw new Error(
        `X Bot: HTTP ${response.status} ${response.statusText}`
      );
    }
    setStatus("3/7 — Читаем GLB…");
    const buffer = await withTimeout(
      response.arrayBuffer(),
      10000,
      "Чтение GLB"
    );
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error(
        `GLB имеет неожиданный тип: ${describeValue(buffer)}`
      );
    }
    if (buffer.byteLength === 0) {
      throw new Error("X Bot: получен пустой GLB");
    }
    setStatus(
      `4/7 — GLB получен: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`
    );
    console.log("[AstraWay] Raw GLB:", {
      type: describeValue(buffer),
      bytes: buffer.byteLength,
    });
    setStatus("5/7 — Канонизируем скелет…");
    const canonicalResult = await withTimeout(
      canonicalizeGLBBones(buffer),
      10000,
      "canonicalizeGLBBones"
    );
    console.log(
      "[AstraWay] canonicalize result:",
      canonicalResult
    );
    const canonicalBuffer = toArrayBuffer(canonicalResult);
    if (!canonicalBuffer) {
      throw new Error(
        `canonicalizeGLBBones вернул неподдерживаемый тип: ${describeValue(
          canonicalResult
        )}`
      );
    }
    if (canonicalBuffer.byteLength === 0) {
      throw new Error(
        "canonicalizeGLBBones вернул пустой буфер"
      );
    }
    setStatus(
      `6/7 — Канонический GLB готов: ${(
        canonicalBuffer.byteLength / 1024 / 1024
      ).toFixed(2)} MB`
    );
    const gltf = await withTimeout(
      loader.parseAsync(canonicalBuffer, ""),
      10000,
      "GLTFLoader.parseAsync"
    );
    if (!gltf || !gltf.scene) {
      throw new Error(
        "GLTFLoader не вернул scene"
      );
    }
    model = gltf.scene;
    scene.add(model);
    frameModel(model);
    setStatus("7/7 — Проверяем скелет…");
    const report = inspectBones(model);
    console.log("[AstraWay] Bone report:", report);
    renderBoneReport(report);
    if (report.canonicalMissing.length > 0) {
      status.textContent =
        `❌ Canonical joints: ${report.canonicalFound}/52`;
      console.error(
        "[AstraWay] Missing canonical joints:",
        report.canonicalMissing
      );
      return;
    }
    status.textContent =
      `GREEN — 52/52 canonical joints | logical: ${report.logicalFound}/22`;
    console.log(
      "[AstraWay] Character Lab GREEN",
      report
    );
  } catch (error) {
    console.error(
      "[AstraWay] Character Lab ERROR",
      error
    );
    status.textContent =
      `❌ ${error?.message || "Неизвестная ошибка"}`;
  }
}
function animate() {
  requestAnimationFrame(animate);
  if (model) {
    model.rotation.y += 0.0025;
  }
  renderer.render(scene, camera);
}
window.addEventListener("resize", () => {
  camera.aspect =
    window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 2)
  );
});
loadModel();
animate();
