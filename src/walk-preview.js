// src/walk-preview.js

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { canonicalizeGLBBones } from "@three-ws/retarget";
import { createProceduralHuman } from "three-procedural-locomotion";
import { WorldAdapter } from "./world/WorldAdapter.js";
import { AutonomyAgent } from "./character/AutonomyAgent.js";
import { attachXbotOutfit } from "./character/XbotOutfit.js";
import { buildNightPlaza } from "./world/NightPlazaLocation.js";

const canvas = document.querySelector("#viewer");
const status = document.querySelector("#status");

canvas.style.touchAction = "none";

function setStatus(message) {
  status.textContent = message;
  console.log("[AstraWay]", message);
}

/* =========================================================
   XBOT RIG
========================================================= */

const xbotMapping = {
  hips: "Hips",
  left: {
    thigh: "LeftUpLeg",
    shin: "LeftLeg",
    foot: "LeftFoot",
    toe: "LeftToeBase",
  },
  right: {
    thigh: "RightUpLeg",
    shin: "RightLeg",
    foot: "RightFoot",
    toe: "RightToeBase",
  },
  spine: "Spine",
  chest: "Spine2",
  neck: "Neck",
  head: "Head",
  leftArm: {
    shoulder: "LeftShoulder",
    upperArm: "LeftArm",
    forearm: "LeftForeArm",
    hand: "LeftHand",
    fingers: {
      thumb: ["LeftHandThumb1", "LeftHandThumb2", "LeftHandThumb3"],
      index: ["LeftHandIndex1", "LeftHandIndex2", "LeftHandIndex3"],
      middle: ["LeftHandMiddle1", "LeftHandMiddle2", "LeftHandMiddle3"],
      ring: ["LeftHandRing1", "LeftHandRing2", "LeftHandRing3"],
      pinky: ["LeftHandPinky1", "LeftHandPinky2", "LeftHandPinky3"],
    },
  },
  rightArm: {
    shoulder: "RightShoulder",
    upperArm: "RightArm",
    forearm: "RightForeArm",
    hand: "RightHand",
    fingers: {
      thumb: ["RightHandThumb1", "RightHandThumb2", "RightHandThumb3"],
      index: ["RightHandIndex1", "RightHandIndex2", "RightHandIndex3"],
      middle: ["RightHandMiddle1", "RightHandMiddle2", "RightHandMiddle3"],
      ring: ["RightHandRing1", "RightHandRing2", "RightHandRing3"],
      pinky: ["RightHandPinky1", "RightHandPinky2", "RightHandPinky3"],
    },
  },
};

/* =========================================================
   RENDERER / SCENE
========================================================= */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a12);

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / Math.max(window.innerHeight, 1),
  0.01,
  150
);

/* =========================================================
   BASE GROUND (fallback under plaza)
========================================================= */

const groundMeshes = [];
const obstacleMeshes = [];

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({
    color: 0x0b0e16,
    roughness: 0.95,
  })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.name = "WalkableGround";
ground.visible = true;
scene.add(ground);
groundMeshes.push(ground);

/* =========================================================
   TARGET MARKER
========================================================= */

const targetMarker = new THREE.Group();
targetMarker.visible = false;

const markerRing = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.32, 32),
  new THREE.MeshBasicMaterial({
    color: 0x2ee6ff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
);
markerRing.rotation.x = -Math.PI / 2;
targetMarker.add(markerRing);

const markerCenter = new THREE.Mesh(
  new THREE.CircleGeometry(0.08, 20),
  new THREE.MeshBasicMaterial({
    color: 0xff3d9a,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
);
markerCenter.rotation.x = -Math.PI / 2;
markerCenter.position.y = 0.03;
targetMarker.add(markerCenter);

scene.add(targetMarker);

/* =========================================================
   MODEL STATE
========================================================= */

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const MODEL_URL = `${import.meta.env.BASE_URL}models/Xbot.glb`;

const UP = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3(0, 0, -1);
const right = new THREE.Vector3(1, 0, 0);
const cameraOffset = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

let characterRoot = null;
let human = null;
let worldAdapter = null;
let autonomyAgent = null;

function toArrayBuffer(value) {
  if (!value) return null;

  if (value instanceof ArrayBuffer) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength
    );
  }

  if (value?.buffer) {
    return toArrayBuffer(value.buffer);
  }

  return null;
}

function findBone(root, name) {
  let result = null;

  root.traverse((object) => {
    if (object.isBone && object.name === name) {
      result = object;
    }
  });

  return result;
}

/* =========================================================
   CAMERA
========================================================= */

function updateCamera() {
  if (!human) return;

  cameraOffset.copy(forward).negate().multiplyScalar(5.1);
  cameraOffset.y = 2.25;

  camera.position.copy(human.position).add(cameraOffset);

  lookTarget.copy(human.position);
  lookTarget.y += 1.0;

  camera.lookAt(lookTarget);
}

/* =========================================================
   IPHONE CONTROLS
========================================================= */

const controls = document.createElement("div");
controls.id = "astra-controls";

controls.style.cssText = `
  position: fixed;
  z-index: 20;
  top: calc(env(safe-area-inset-top) + 9px);
  left: 9px;
  right: 9px;
  max-width: 440px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  justify-content: center;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
`;

document.body.appendChild(controls);

function makeButton(label, callback) {
  const button = document.createElement("button");

  button.type = "button";
  button.textContent = label;

  button.style.cssText = `
    flex: 1 1 29%;
    min-width: 92px;
    height: 43px;
    border: 1px solid rgba(150,180,220,0.28);
    border-radius: 11px;
    background: rgba(15,21,32,0.92);
    color: #e5efff;
    font: 600 11px -apple-system, sans-serif;
    letter-spacing: 0.35px;
    touch-action: manipulation;
  `;

  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    callback();
  });

  controls.appendChild(button);

  return {
    setLabel(value) {
      button.textContent = value;
    },
  };
}

let runEnabled = false;
let crouchEnabled = false;
let autoTouchEnabled = true;

const styles = ["athletic", "sneaky", "heavy"];
let styleIndex = 0;

const runButton = makeButton("БЕГ: OFF", () => {
  runEnabled = !runEnabled;

  if (autonomyAgent) {
    autonomyAgent.setMode(runEnabled ? "run" : "walk");
  }

  runButton.setLabel(runEnabled ? "БЕГ: ON" : "БЕГ: OFF");

  setStatus(runEnabled ? "РЕЖИМ БЕГА ВКЛЮЧЁН" : "РЕЖИМ ХОДЬБЫ");
});

const crouchButton = makeButton("ПРИСЕСТЬ", () => {
  if (!human) return;

  crouchEnabled = !crouchEnabled;
  human.targetCrouch = crouchEnabled ? 1 : 0;

  crouchButton.setLabel(crouchEnabled ? "ВСТАТЬ" : "ПРИСЕСТЬ");
});

const jumpButton = makeButton("ПРЫЖОК", () => {
  if (!human) return;

  const accepted = human.jump();

  setStatus(
    accepted ? "ПРЫЖОК: ПОДГОТОВКА" : "ПРЫЖОК СЕЙЧАС НЕДОСТУПЕН"
  );
});

const stopButton = makeButton("СТОП", () => {
  if (!human) return;

  if (autonomyAgent) {
    autonomyAgent.stop();
  } else {
    human.stop();
  }

  setStatus("ОСТАНОВКА");
});

const touchButton = makeButton("КАСАНИЯ: ON", () => {
  if (!human) return;

  autoTouchEnabled = !autoTouchEnabled;
  human.autoTouch = autoTouchEnabled;

  if (!autoTouchEnabled) {
    human.releaseTouch();
  }

  touchButton.setLabel(autoTouchEnabled ? "КАСАНИЯ: ON" : "КАСАНИЯ: OFF");
});

const styleButton = makeButton("СТИЛЬ: ATHLETIC", () => {
  if (!human) return;

  styleIndex = (styleIndex + 1) % styles.length;

  const selected = styles[styleIndex];

  human.applyPreset(selected);

  styleButton.setLabel(`СТИЛЬ: ${selected.toUpperCase()}`);

  setStatus(`СТИЛЬ ДВИЖЕНИЯ: ${selected.toUpperCase()}`);
});

/* =========================================================
   LOAD CHARACTER + NIGHT PLAZA
========================================================= */

async function loadCharacter() {
  try {
    setStatus("1/5 — Загрузка XBot…");

    const response = await fetch(MODEL_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`XBot HTTP ${response.status}`);
    }

    const sourceBuffer = await response.arrayBuffer();

    if (!sourceBuffer.byteLength) {
      throw new Error("XBot GLB пустой");
    }

    setStatus("2/5 — Подготовка скелета…");

    const canonical = await canonicalizeGLBBones(sourceBuffer);
    const canonicalBuffer = toArrayBuffer(canonical);

    if (!canonicalBuffer) {
      throw new Error("Canonical GLB buffer invalid");
    }

    const gltf = await loader.parseAsync(canonicalBuffer, "");

    if (!gltf?.scene) {
      throw new Error("GLTF scene missing");
    }

    const model = gltf.scene;
    model.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(model);

    if (bounds.isEmpty()) {
      throw new Error("Модель не имеет геометрии");
    }

    characterRoot = new THREE.Group();
    characterRoot.name = "AstraWay_AdaptiveRoot";

    model.position.y -= bounds.min.y;

    characterRoot.add(model);
    scene.add(characterRoot);

    scene.updateMatrixWorld(true);

    attachXbotOutfit(model);

    const leftFoot = findBone(model, "LeftFoot");
    const rightFoot = findBone(model, "RightFoot");
    const leftToe = findBone(model, "LeftToeBase");
    const rightToe = findBone(model, "RightToeBase");

    if (!leftFoot || !rightFoot || !leftToe || !rightToe) {
      throw new Error("Не найдена полная цепочка стоп XBot");
    }

    const leftFootPosition = leftFoot.getWorldPosition(new THREE.Vector3());
    const rightFootPosition = rightFoot.getWorldPosition(new THREE.Vector3());
    const leftToePosition = leftToe.getWorldPosition(new THREE.Vector3());
    const rightToePosition = rightToe.getWorldPosition(new THREE.Vector3());

    forward
      .copy(leftToePosition)
      .sub(leftFootPosition)
      .add(rightToePosition.clone().sub(rightFootPosition))
      .setY(0);

    if (forward.lengthSq() < 0.0001) {
      throw new Error("Не удалось определить направление XBot");
    }

    forward.normalize();
    right.crossVectors(forward, UP).normalize();

    setStatus("2.5/5 — Night Plaza…");

    const plaza = buildNightPlaza(scene, {
      forward,
      origin: new THREE.Vector3(0, 0, 0),
      enableShadows: false,
    });

    groundMeshes.push(...plaza.groundMeshes);
    obstacleMeshes.push(...plaza.obstacleMeshes);

    setStatus("3/5 — Подключение World Adapter…");

    worldAdapter = new WorldAdapter({
      scene,
      characterRoots: [characterRoot],
      ground: groundMeshes,
      obstacles: obstacleMeshes,
      touchables: obstacleMeshes,
      includeTaggedObjects: true,
    });

    const worldOptions = worldAdapter.toProceduralHumanOptions();
    const worldDiagnostics = worldAdapter.getDiagnostics();

    if (!worldDiagnostics.ready) {
      throw new Error("World Adapter: walkable world unavailable");
    }

    human = createProceduralHuman({
      model: characterRoot,
      mapping: xbotMapping,
      ...worldOptions,
      forward,
      preset: "athletic",
      bodyScale: "auto",
      speedScale: "auto",
      seed: 27,
      config: {
        maxStepUp: 0.45,
        maxStepDown: 0.45,
        maxExtraStepHeight: 0.35,
        toeClearance: 0.025,
      },
    });

    human.autoTouch = true;
    human.touchSlide = true;

    autonomyAgent = new AutonomyAgent({
      human,
      worldAdapter,
    });

    for (const warning of human.warnings) {
      console.warn("[AstraWay] MODEL WARNING:", warning);
    }

    human.on("arrive", () => {
      setStatus("ЦЕЛЬ ДОСТИГНУТА");
    });

    human.on("liftoff", () => {
      setStatus("ПРЫЖОК: ОТРЫВ ОТ ЗЕМЛИ");
    });

    human.on("land", ({ impactSpeed }) => {
      setStatus(`ПРИЗЕМЛЕНИЕ · УДАР ${impactSpeed.toFixed(2)} м/с`);
    });

    human.on("touch", ({ side }) => {
      console.log(`[AstraWay] CONTACT: ${side} hand`);
    });

    updateCamera();

    setStatus(
      "4/5 — NIGHT PLAZA ГОТОВА\nТапни на площадь, лестницу или арку"
    );

    console.log("[AstraWay] ADAPTIVE SYSTEM READY", {
      legLength: human.legLength,
      bodyScale: human.bodyScale,
      speedScale: human.speedScale,
      warnings: human.warnings,
      world: worldDiagnostics,
      autonomy: autonomyAgent.getState(),
      plazaGround: plaza.groundMeshes.length,
      plazaObstacles: plaza.obstacleMeshes.length,
    });
  } catch (error) {
    console.error("[AstraWay] INITIALIZATION ERROR", error);

    setStatus("ОШИБКА: " + (error?.message || String(error)));
  }
}

/* =========================================================
   TAP → WORLD TARGET → AUTONOMY AGENT
========================================================= */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function moveToScreenPoint(event) {
  if (!human || !autonomyAgent || !characterRoot) {
    setStatus("Персонаж ещё загружается…");
    return;
  }

  const rect = canvas.getBoundingClientRect();

  if (!rect.width || !rect.height) return;

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const intersections = raycaster.intersectObjects(
    worldAdapter.getGround(),
    false
  );

  if (!intersections.length) return;

  const target = intersections[0].point.clone();

  const distance = new THREE.Vector2(
    target.x - human.position.x,
    target.z - human.position.z
  ).length();

  if (distance < 0.25) {
    setStatus("ЦЕЛЬ СЛИШКОМ БЛИЗКО");
    return;
  }

  targetMarker.position.copy(target);
  targetMarker.position.y += 0.025;
  targetMarker.visible = true;

  const agentState = autonomyAgent.setGoal(target, {
    run: runEnabled,
  });

  setStatus(
    `${runEnabled ? "БЕГ" : "ХОДЬБА"} · ЦЕЛЬ ПРИНЯТА\n` +
      `Расстояние: ${distance.toFixed(2)} м`
  );

  console.log("[AstraWay] AUTONOMY GOAL", {
    target: target.toArray(),
    distance,
    agentState,
    route: human.movePath?.map((p) => p.toArray()) ?? null,
  });
}

canvas.addEventListener(
  "pointerdown",
  (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    event.preventDefault();
    moveToScreenPoint(event);
  },
  { passive: false }
);

/* =========================================================
   LIVE ADAPTATION HUD
========================================================= */

let lastHudUpdate = 0;

function updateHUD(now) {
  if (!human || !autonomyAgent || now - lastHudUpdate < 180) {
    return;
  }

  lastHudUpdate = now;

  const route = human.movePath;
  const routeCount = route ? route.length : 0;
  const world = worldAdapter.getDiagnostics();
  const autonomy = autonomyAgent.getState();

  const warnings = human.warnings.length
    ? `\nПРЕДУПРЕЖДЕНИЯ: ${human.warnings.length}`
    : "";

  status.textContent = [
    `ASTRAWAY · ${styles[styleIndex].toUpperCase()}`,
    `Автономность: ${autonomy.state}`,
    `Цель: ${autonomy.goal ? "АКТИВНА" : "НЕТ"}`,
    `Режим: ${autonomy.mode.toUpperCase()}`,
    `Скорость: ${human.speed.toFixed(2)} м/с`,
    `Походка: ${human.gaitMode} · бег: ${Math.round(human.runBlend * 100)}%`,
    `Приседание: ${Math.round(human.crouch * 100)}%`,
    `Стопы: L ${human.footPhase("left")} · R ${human.footPhase("right")}`,
    `Прыжок: ${human.jumpPhase}`,
    `Руки: L ${human.touchPhase("left")} · R ${human.touchPhase("right")}`,
    `Точек маршрута: ${routeCount}`,
    `Попытки восстановления: ${autonomy.recoveryAttempts}`,
    `Мир: пол ${world.groundCount} · препятствия ${world.colliderCount}`,
    `Автокасание: ${human.autoTouch ? "ON" : "OFF"}`,
    warnings,
  ].join("\n");
}

/* =========================================================
   FRAME LOOP
========================================================= */

let lastFrameTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);

  let dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  if (!Number.isFinite(dt) || dt < 0) {
    dt = 0;
  }

  if (human && autonomyAgent) {
    try {
      autonomyAgent.update(dt);
      updateCamera();
      updateHUD(now);
    } catch (error) {
      console.error("[AstraWay] UPDATE ERROR", error);

      setStatus("ОШИБКА ДВИЖЕНИЯ: " + error.message);

      autonomyAgent = null;
      human = null;
    }
  }

  renderer.render(scene, camera);
}

/* =========================================================
   RESIZE
========================================================= */

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  camera.projectionMatrixNeedsUpdate = true;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* =========================================================
   START
========================================================= */

loadCharacter();
requestAnimationFrame(animate);