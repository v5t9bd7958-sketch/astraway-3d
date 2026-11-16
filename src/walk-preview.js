
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { canonicalizeGLBBones } from "@three-ws/retarget";
import { createProceduralHuman } from "three-procedural-locomotion";

const canvas = document.querySelector("#viewer");
const status = document.querySelector("#status");

function setStatus(message) {
  status.textContent = message;
  console.log("[AstraWay]", message);
}

/*
 * XBOT RIG MAPPING
 */

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

/*
 * SCENE
 */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b10);

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / Math.max(window.innerHeight, 1),
  0.01,
  100
);

scene.add(new THREE.HemisphereLight(0xdde8ff, 0x20232b, 2.2));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(2, 4, 3);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8fa8ff, 1);
fillLight.position.set(-3, 2, -2);
scene.add(fillLight);

/*
 * GROUND
 */

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({
    color: 0x151922,
    roughness: 0.9,
  })
);

ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.name = "WalkableGround";
scene.add(ground);

/*
 * TARGET MARKER
 */

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

/*
 * MODEL
 */

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const MODEL_URL =
  `${import.meta.env.BASE_URL}models/Xbot.glb`;

let human = null;
let characterRoot = null;

const forward = new THREE.Vector3(0, 0, -1);
const lookTarget = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();

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

/*
 * OBSTACLE
 *
 * One visible column and one matching cylinder collider.
 * The collider is an explicit navigation input.
 */

const obstacleRadius = 0.48;
const obstacleHeight = 1.65;

let obstacleMesh = null;
let obstacleCollider = null;

function createObstacle() {
  const obstacleBase = forward
    .clone()
    .multiplyScalar(2.6);

  obstacleBase.y = 0;

  obstacleMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      obstacleRadius,
      obstacleRadius,
      obstacleHeight,
      32
    ),
    new THREE.MeshStandardMaterial({
      color: 0x9a7044,
      roughness: 0.72,
      metalness: 0.18,
    })
  );

  obstacleMesh.position.set(
    obstacleBase.x,
    obstacleHeight / 2,
    obstacleBase.z
  );

  obstacleMesh.castShadow = true;
  obstacleMesh.receiveShadow = true;
  obstacleMesh.name = "NavigationObstacle";

  scene.add(obstacleMesh);

  obstacleCollider = {
    center: obstacleBase.clone(),
    radius: obstacleRadius,
    height: obstacleHeight,
  };

  console.log("[AstraWay] OBSTACLE CREATED", {
    center: obstacleBase.toArray(),
    radius: obstacleRadius,
    height: obstacleHeight,
  });
}

/*
 * CAMERA
 */

function updateCamera() {
  if (!characterRoot) return;

  cameraOffset
    .copy(forward)
    .negate()
    .multiplyScalar(4.2);

  cameraOffset.y = 1.8;

  camera.position
    .copy(characterRoot.position)
    .add(cameraOffset);

  lookTarget.copy(characterRoot.position);
  lookTarget.y += 0.95;

  camera.lookAt(lookTarget);
}

/*
 * LOAD AND INITIALIZE
 */

async function loadCharacter() {
  try {
    setStatus("1/4 — Загружаю XBot…");

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

    setStatus("2/4 — Подготавливаю скелет…");

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
    characterRoot.name = "AstraWay_WalkRoot";

    model.position.y -= bounds.min.y;

    characterRoot.add(model);
    scene.add(characterRoot);

    scene.updateMatrixWorld(true);

    const leftFoot = findBone(model, "LeftFoot");
    const rightFoot = findBone(model, "RightFoot");
    const leftToe = findBone(model, "LeftToeBase");
    const rightToe = findBone(model, "RightToeBase");

    if (!leftFoot || !rightFoot || !leftToe || !rightToe) {
      throw new Error("Не найдена цепочка стоп XBot");
    }

    const leftDirection = new THREE.Vector3();
    const rightDirection = new THREE.Vector3();

    leftFoot.getWorldPosition(leftDirection);
    leftToe.getWorldPosition(leftDirection.clone());

    const leftToePosition = new THREE.Vector3();
    const rightFootPosition = new THREE.Vector3();
    const rightToePosition = new THREE.Vector3();

    leftFoot.getWorldPosition(leftDirection);
    leftToe.getWorldPosition(leftToePosition);

    rightFoot.getWorldPosition(rightFootPosition);
    rightToe.getWorldPosition(rightToePosition);

    forward
      .copy(leftToePosition)
      .sub(leftDirection)
      .add(
        rightToePosition
          .clone()
          .sub(rightFootPosition)
      )
      .setY(0);

    if (forward.lengthSq() < 0.0001) {
      throw new Error("Не удалось определить направление XBot");
    }

    forward.normalize();

    /*
     * Create obstacle only after detecting the model's forward.
     */

    createObstacle();

    setStatus("3/4 — Подключаю навигацию и походку…");

    human = createProceduralHuman({
      model: characterRoot,
      mapping: xbotMapping,
      ground: [ground],
      colliders: [obstacleCollider],
      forward,
      preset: "athletic",
    });

    if (human.warnings?.length) {
      console.warn("[AstraWay] Locomotion warnings", human.warnings);
    }

    human.on("arrive", () => {
      setStatus(
        "ЦЕЛЬ ДОСТИГНУТА\n" +
        "Коснись земли для следующей цели"
      );
    });

    updateCamera();

    setStatus(
      "ГОТОВ | OBSTACLE TEST\n" +
      "Колонна впереди. Коснись земли за ней."
    );

    console.log("[AstraWay] OBSTACLE NAVIGATION READY", {
      forward: forward.toArray(),
      collider: obstacleCollider,
      warnings: human.warnings,
    });

  } catch (error) {
    console.error("[AstraWay] INITIALIZATION ERROR", error);

    setStatus(
      "ОШИБКА: " + (error?.message || String(error))
    );
  }
}

/*
 * TAP → WORLD TARGET → NAVIGATION
 */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function moveToScreenPoint(event) {
  if (!human || !characterRoot) {
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

  const intersections = raycaster.intersectObject(ground, false);

  if (!intersections.length) return;

  const target = intersections[0].point.clone();
  target.y = 0;

  const distance = new THREE.Vector2(
    target.x - characterRoot.position.x,
    target.z - characterRoot.position.z
  ).length();

  if (distance < 0.25) {
    setStatus("Цель слишком близко");
    return;
  }

  targetMarker.position.set(target.x, 0, target.z);
  targetMarker.visible = true;

  /*
   * The library plans the route around the collider.
   * We provide only the destination.
   */

  human.moveTo(target, {
    run: false,
  });

  setStatus(
    "МАРШРУТ ПРИНЯТ\n" +
    `До цели: ${distance.toFixed(2)} м\n` +
    "Проверяю обход препятствия…"
  );

  console.log("[AstraWay] NAVIGATION TARGET", {
    target: target.toArray(),
    distance,
    obstacle: obstacleCollider,
  });
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  moveToScreenPoint(event);
});

/*
 * FRAME LOOP
 *
 * Isolated preview. Production PoseWriter is untouched.
 */

let lastFrameTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();

  let dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  if (!Number.isFinite(dt) || dt < 0) {
    dt = 0;
  }

  dt = Math.min(dt, 0.05);

  if (human) {
    try {
      human.update(dt);
      updateCamera();
    } catch (error) {
      console.error("[AstraWay] UPDATE ERROR", error);
      setStatus("ОШИБКА ДВИЖЕНИЯ: " + error.message);
      human = null;
    }
  }

  renderer.render(scene, camera);
}

/*
 * RESIZE
 */

window.addEventListener("resize", () => {
  camera.aspect =
    window.innerWidth / Math.max(window.innerHeight, 1);

  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});

/*
 * START
 */

loadCharacter();
animate();
