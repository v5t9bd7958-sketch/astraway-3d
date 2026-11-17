import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { canonicalizeGLBBones } from "@three-ws/retarget";
import { createProceduralHuman } from "three-procedural-locomotion";
import { WorldAdapter } from "./world/WorldAdapter.js";
import { AutonomyAgent } from "./character/AutonomyAgent.js";

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
   SCENE
========================================================= */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b10);

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / Math.max(window.innerHeight, 1),
  0.01,
  150
);

scene.add(
  new THREE.HemisphereLight(0xdde8ff, 0x20232b, 2.2)
);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(3, 7, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8fa8ff, 0.9);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

/* =========================================================
   GROUND
========================================================= */

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({
    color: 0x151922,
    roughness: 0.92,
  })
);

ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.name = "WalkableGround";
scene.add(ground);

const groundMeshes = [ground];

/* =========================================================
   TARGET MARKER
========================================================= */

const targetMarker = new THREE.Group();
targetMarker.visible = false;

const markerRing = new THREE.Mesh(
  new THREE.RingGeometry(0.13, 0.19, 40),
  new THREE.MeshBasicMaterial({
    color: 0x63d9ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
);

markerRing.rotation.x = -Math.PI / 2;
markerRing.position.y = 0.025;
targetMarker.add(markerRing);

const markerCenter = new THREE.Mesh(
  new THREE.CircleGeometry(0.045, 24),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
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

let human = null;
let autonomyAgent = null;
let characterRoot = null;
let worldAdapter = null;

const UP = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3(0, 0, -1);
const right = new THREE.Vector3(1, 0, 0);

const cameraOffset = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;

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
   ADAPTIVE WORLD GEOMETRY
========================================================= */

const obstacleMeshes = [];

function createColumn(position, radius = 0.38, height = 1.8) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 24),
    new THREE.MeshStandardMaterial({
      color: 0x92704e,
      roughness: 0.7,
      metalness: 0.16,
    })
  );

  mesh.position.set(
    position.x,
    height / 2,
    position.z
  );

  mesh.name = "TouchableNavigationColumn";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  mesh.userData.astraWay = {
    role: "obstacle",
  };

  scene.add(mesh);
  obstacleMeshes.push(mesh);

  return mesh;
}

function createStaircase(start, stairYaw) {
  const count = 5;
  const tread = 0.34;
  const rise = 0.12;
  const width = 2.6;

  const material = new THREE.MeshStandardMaterial({
    color: 0x394454,
    roughness: 0.86,
  });

  for (let i = 0; i < count; i++) {
    const height = rise * (i + 1);

    const step = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, tread),
      material
    );

    const position = start
      .clone()
      .add(forward.clone().multiplyScalar((i + 0.5) * tread));

    step.position.set(
      position.x,
      height / 2,
      position.z
    );

    step.rotation.y = stairYaw;
    step.name = `AdaptiveStair_${i + 1}`;

    scene.add(step);
    groundMeshes.push(step);
  }

  const totalHeight = count * rise;

  const landing = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.2, 1.5),
    material
  );

  const landingPosition = start
    .clone()
    .add(forward.clone().multiplyScalar(count * tread + 0.75));

  landing.position.set(
    landingPosition.x,
    totalHeight - 0.1,
    landingPosition.z
  );

  landing.rotation.y = stairYaw;
  landing.name = "StairLanding";

  scene.add(landing);
  groundMeshes.push(landing);

  return {
    height: totalHeight,
    length: count * tread,
  };
}

function createRamp(start, rampYaw, rampHeight = 0.36, rampLength = 2.2) {
  const width = 1.35;

  const geometry = new THREE.BufferGeometry();

  const vertices = new Float32Array([
    -width / 2, 0, 0,
     width / 2, 0, 0,
    -width / 2, rampHeight, -rampLength,

     width / 2, 0, 0,
     width / 2, rampHeight, -rampLength,
    -width / 2, rampHeight, -rampLength,
  ]);

  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(vertices, 3)
  );

  geometry.computeVertexNormals();

  const ramp = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x45616b,
      roughness: 0.82,
      side: THREE.FrontSide,
    })
  );

  ramp.position.copy(start);
  ramp.rotation.y = rampYaw;
  ramp.name = "AdaptiveSlope";

  scene.add(ramp);
  groundMeshes.push(ramp);

  const landing = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.18, 0.9),
    new THREE.MeshStandardMaterial({
      color: 0x394454,
      roughness: 0.86,
    })
  );

  const landingPosition = start
    .clone()
    .add(forward.clone().multiplyScalar(rampLength + 0.45));

  landing.position.set(
    landingPosition.x,
    rampHeight - 0.09,
    landingPosition.z
  );

  landing.rotation.y = rampYaw;
  landing.name = "RampLanding";

  scene.add(landing);
  groundMeshes.push(landing);
}

/* =========================================================
   CAMERA
========================================================= */

function updateCamera() {
  if (!human) return;

  cameraOffset
    .copy(forward)
    .negate()
    .multiplyScalar(5.1);

  cameraOffset.y = 2.25;

  camera.position
    .copy(human.position)
    .add(cameraOffset);

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

  setStatus(
    runEnabled
      ? "РЕЖИМ БЕГА ВКЛЮЧЁН"
      : "РЕЖИМ ХОДЬБЫ"
  );
});

const crouchButton = makeButton("ПРИСЕСТЬ", () => {
  if (!human) return;

  crouchEnabled = !crouchEnabled;
  human.targetCrouch = crouchEnabled ? 1 : 0;

  crouchButton.setLabel(
    crouchEnabled ? "ВСТАТЬ" : "ПРИСЕСТЬ"
  );
});

const jumpButton = makeButton("ПРЫЖОК", () => {
  if (!human) return;

  const accepted = human.jump();

  setStatus(
    accepted
      ? "ПРЫЖОК: ПОДГОТОВКА"
      : "ПРЫЖОК СЕЙЧАС НЕДОСТУПЕН"
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

  touchButton.setLabel(
    autoTouchEnabled ? "КАСАНИЯ: ON" : "КАСАНИЯ: OFF"
  );
});

const styleButton = makeButton("СТИЛЬ: ATHLETIC", () => {
  if (!human) return;

  styleIndex = (styleIndex + 1) % styles.length;

  const selected = styles[styleIndex];

  human.applyPreset(selected);

  styleButton.setLabel(
    `СТИЛЬ: ${selected.toUpperCase()}`
  );

  setStatus(`СТИЛЬ ДВИЖЕНИЯ: ${selected.toUpperCase()}`);
});

/* =========================================================
   LOAD CHARACTER
========================================================= */

async function loadCharacter() {
  try {
    setStatus("1/5 — Загрузка XBot…");

    const response = await fetch(
      MODEL_URL,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(`XBot HTTP ${response.status}`);
    }

    const sourceBuffer = await response.arrayBuffer();

    if (!sourceBuffer.byteLength) {
      throw new Error("XBot GLB пустой");
    }

    setStatus("2/5 — Подготовка скелета…");

    const canonical =
      await canonicalizeGLBBones(sourceBuffer);

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

    const leftFoot = findBone(model, "LeftFoot");
    const rightFoot = findBone(model, "RightFoot");
    const leftToe = findBone(model, "LeftToeBase");
    const rightToe = findBone(model, "RightToeBase");

    if (!leftFoot || !rightFoot || !leftToe || !rightToe) {
      throw new Error("Не найдена полная цепочка стоп XBot");
    }

    const leftFootPosition = leftFoot.getWorldPosition(
      new THREE.Vector3()
    );

    const rightFootPosition = rightFoot.getWorldPosition(
      new THREE.Vector3()
    );

    const leftToePosition = leftToe.getWorldPosition(
      new THREE.Vector3()
    );

    const rightToePosition = rightToe.getWorldPosition(
      new THREE.Vector3()
    );

    forward
      .copy(leftToePosition)
      .sub(leftFootPosition)
      .add(
        rightToePosition.clone().sub(rightFootPosition)
      )
      .setY(0);

    if (forward.lengthSq() < 0.0001) {
      throw new Error("Не удалось определить направление XBot");
    }

    forward.normalize();

    right.crossVectors(forward, UP).normalize();

    const stairYaw = Math.atan2(-forward.x, -forward.z);

    const firstColumn = forward
      .clone()
      .multiplyScalar(2.35)
      .add(right.clone().multiplyScalar(0.1));

    const secondColumn = forward
      .clone()
      .multiplyScalar(3.55)
      .add(right.clone().multiplyScalar(-0.85));

    createColumn(firstColumn, 0.4, 1.8);
    createColumn(secondColumn, 0.34, 1.55);

    const stairStart = forward
      .clone()
      .multiplyScalar(5.0);

    const staircase = createStaircase(
      stairStart,
      stairYaw
    );

    const rampStart = stairStart
      .clone()
      .add(right.clone().multiplyScalar(2.0));

    createRamp(rampStart, stairYaw, 0.36, 2.2);

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
        maxStepUp: 0.35,
        maxStepDown: 0.35,
        maxExtraStepHeight: 0.3,
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
      setStatus(
        `ПРИЗЕМЛЕНИЕ · УДАР ${impactSpeed.toFixed(2)} м/с`
      );
    });

    human.on("touch", ({ side }) => {
      console.log(`[AstraWay] CONTACT: ${side} hand`);
    });

    updateCamera();

    setStatus(
      "4/5 — СЦЕНА ГОТОВА\n" +
      "Тапни за препятствиями или на лестницу"
    );

    console.log("[AstraWay] ADAPTIVE SYSTEM READY", {
      legLength: human.legLength,
      bodyScale: human.bodyScale,
      speedScale: human.speedScale,
      warnings: human.warnings,
      world: worldDiagnostics,
      stairHeight: staircase.height,
      stairLength: staircase.length,
      autonomy: autonomyAgent.getState(),
    });

  } catch (error) {
    console.error("[AstraWay] INITIALIZATION ERROR", error);

    setStatus(
      "ОШИБКА: " + (error?.message || String(error))
    );
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

  pointer.x =
    ((event.clientX - rect.left) / rect.width) * 2 - 1;

  pointer.y =
    -((event.clientY - rect.top) / rect.height) * 2 + 1;

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
      // AutonomyAgent — единственный владелец human.update(dt).
      // Реальный dt передаётся locomotion backend без внешнего clamp.
      autonomyAgent.update(dt);

      updateCamera();
      updateHUD(now);
    } catch (error) {
      console.error("[AstraWay] UPDATE ERROR", error);

      setStatus(
        "ОШИБКА ДВИЖЕНИЯ: " + error.message
      );

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
  camera.aspect =
    window.innerWidth / Math.max(window.innerHeight, 1);

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );
});

/* =========================================================
   START
========================================================= */

loadCharacter();
requestAnimationFrame(animate);