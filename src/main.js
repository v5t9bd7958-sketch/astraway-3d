import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { canonicalizeGLBBones } from "@three-ws/retarget";

import { inspectBones, renderBoneReport } from "./bone-inspector.js";

const canvas = document.querySelector("#viewer");
const status = document.querySelector("#status");

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
    metalness: 0.0,
  })
);

ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const MODEL_URL = "https://three.ws/avatars/xbot.glb";

let model = null;

function frameModel(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxSize = Math.max(size.x, size.y, size.z);
  const distance =
    maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));

  camera.position.set(
    center.x,
    center.y + maxSize * 0.08,
    center.z + distance * 1.25
  );

  camera.lookAt(center.x, center.y, center.z);

  ground.position.y = box.min.y;
}

async function loadModel() {
  status.textContent = "Загружаем X Bot…";

  const response = await fetch(MODEL_URL);

  if (!response.ok) {
    throw new Error(
      `Не удалось загрузить X Bot: HTTP ${response.status}`
    );
  }

  const buffer = await response.arrayBuffer();

  status.textContent = "Канонизируем скелет…";

  const canonicalBuffer = await canonicalizeGLBBones(buffer);

  status.textContent = "Парсим GLB…";

  const gltf = await loader.parseAsync(canonicalBuffer, "");

  model = gltf.scene;

  scene.add(model);

  frameModel(model);

  const report = inspectBones(model);

  renderBoneReport(report);

  if (report.canonicalMissing.length > 0) {
    status.textContent =
      `❌ Canonical joints: ${report.canonicalFound}/52`;
    return;
  }

  status.textContent =
    `GREEN — 52/52 canonical joints | logical: ${report.logicalFound}/22`;
}

function animate() {
  requestAnimationFrame(animate);

  if (model) {
    model.rotation.y += 0.0025;
  }

  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

loadModel().catch((error) => {
  console.error(error);
  status.textContent = `❌ ${error.message}`;
});

animate();
