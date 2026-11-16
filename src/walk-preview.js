
import * as THREE from "three";

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

import { canonicalizeGLBBones } from "@three-ws/retarget";

import {
  createProceduralHuman,
} from "three-procedural-locomotion";


const canvas = document.querySelector("#viewer");
const status = document.querySelector("#status");

function setStatus(message) {
  status.textContent = message;
  console.log("[AstraWay Walk]", message);
}


/*
 * XBOT → PROCEDURAL HUMAN RIG
 *
 * Names correspond to AstraWay canonical BoneMap.
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
      thumb: [
        "LeftHandThumb1",
        "LeftHandThumb2",
        "LeftHandThumb3",
      ],
      index: [
        "LeftHandIndex1",
        "LeftHandIndex2",
        "LeftHandIndex3",
      ],
      middle: [
        "LeftHandMiddle1",
        "LeftHandMiddle2",
        "LeftHandMiddle3",
      ],
      ring: [
        "LeftHandRing1",
        "LeftHandRing2",
        "LeftHandRing3",
      ],
      pinky: [
        "LeftHandPinky1",
        "LeftHandPinky2",
        "LeftHandPinky3",
      ],
    },
  },

  rightArm: {
    shoulder: "RightShoulder",
    upperArm: "RightArm",
    forearm: "RightForeArm",
    hand: "RightHand",

    fingers: {
      thumb: [
        "RightHandThumb1",
        "RightHandThumb2",
        "RightHandThumb3",
      ],
      index: [
        "RightHandIndex1",
        "RightHandIndex2",
        "RightHandIndex3",
      ],
      middle: [
        "RightHandMiddle1",
        "RightHandMiddle2",
        "RightHandMiddle3",
      ],
      ring: [
        "RightHandRing1",
        "RightHandRing2",
        "RightHandRing3",
      ],
      pinky: [
        "RightHandPinky1",
        "RightHandPinky2",
        "RightHandPinky3",
      ],
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

renderer.setPixelRatio(
  Math.min(window.devicePixelRatio || 1, 2)
);

renderer.setSize(
  window.innerWidth,
  window.innerHeight
);

renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b10);

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / Math.max(window.innerHeight, 1),
  0.01,
  100
);

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
scene.add(ground);


/*
 * MODEL AND LOCOMOTION
 */

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const MODEL_URL =
  `${import.meta.env.BASE_URL}models/Xbot.glb`;

let human = null;
let characterRoot = null;
let forward = new THREE.Vector3(0, 0, -1);

const lookTarget = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();
const toeLeftPosition = new THREE.Vector3();
const toeRightPosition = new THREE.Vector3();
const footLeftPosition = new THREE.Vector3();
const footRightPosition = new THREE.Vector3();


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


async function loadCharacter() {
  try {
    setStatus("1/4 — Загружаю XBot…");

    const response = await fetch(
      MODEL_URL,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(
        `XBot HTTP ${response.status}`
      );
    }

    const sourceBuffer =
      await response.arrayBuffer();

    if (!sourceBuffer.byteLength) {
      throw new Error("XBot GLB пустой");
    }

    setStatus("2/4 — Подготавливаю скелет…");

    const canonical =
      await canonicalizeGLBBones(sourceBuffer);

    const canonicalBuffer =
      toArrayBuffer(canonical);

    if (!canonicalBuffer) {
      throw new Error(
        "Canonical GLB buffer invalid"
      );
    }

    const gltf = await loader.parseAsync(
      canonicalBuffer,
      ""
    );

    if (!gltf?.scene) {
      throw new Error("GLTF scene missing");
    }

    const model = gltf.scene;

    model.updateMatrixWorld(true);

    const bounds = new THREE.Box3()
      .setFromObject(model);

    if (bounds.isEmpty()) {
      throw new Error("Модель не имеет геометрии");
    }

    /*
     * Отдельный корень с началом координат
     * на уровне подошв.
     *
     * Исходная модель не переписывается.
     */

    characterRoot = new THREE.Group();
    characterRoot.name = "AstraWay_WalkRoot";

    model.position.y -= bounds.min.y;

    characterRoot.add(model);
    scene.add(characterRoot);

    scene.updateMatrixWorld(true);

    /*
     * Направление движения вычисляем
     * по реальным костям стоп и пальцев.
     */

    const leftFoot = findBone(model, "LeftFoot");
    const rightFoot = findBone(model, "RightFoot");

    const leftToe = findBone(model, "LeftToeBase");
    const rightToe = findBone(model, "RightToeBase");

    if (
      !leftFoot ||
      !rightFoot ||
      !leftToe ||
      !rightToe
    ) {
      throw new Error(
        "Не найдена цепочка стоп XBot"
      );
    }

    leftFoot.getWorldPosition(footLeftPosition);
    rightFoot.getWorldPosition(footRightPosition);

    leftToe.getWorldPosition(toeLeftPosition);
    rightToe.getWorldPosition(toeRightPosition);

    forward
      .copy(toeLeftPosition)
      .sub(footLeftPosition)
      .add(
        toeRightPosition
          .clone()
          .sub(footRightPosition)
      )
      .setY(0);

    if (forward.lengthSq() < 0.0001) {
      throw new Error(
        "Не удалось определить направление XBot"
      );
    }

    forward.normalize();

    setStatus("3/4 — Подключаю процедурную походку…");

    human = createProceduralHuman({
      model: characterRoot,
      mapping: xbotMapping,
      ground: [ground],
      forward,
      preset: "athletic",
    });

    if (human.warnings?.length) {
      console.warn(
        "[AstraWay] Locomotion warnings",
        human.warnings
      );
    }

    /*
     * Камера следует за корнем персонажа.
     */

    cameraOffset
      .copy(forward)
      .negate()
      .multiplyScalar(4.2);

    cameraOffset.y = 1.8;

    camera.position
      .copy(characterRoot.position)
      .add(cameraOffset);

    lookTarget
      .copy(characterRoot.position);

    lookTarget.y += 0.95;

    camera.lookAt(lookTarget);

    /*
     * Первая цель — 4.5 метра впереди.
     * Донор сам планирует шаги и перенос веса.
     */

    const destination =
      characterRoot.position
        .clone()
        .addScaledVector(forward, 4.5);

    human.moveTo(destination, {
      run: false,
    });

    setStatus(
      "4/4 — WALKING | XBot | Procedural locomotion"
    );

    console.log(
      "[AstraWay] WALKING STARTED",
      {
        forward: forward.toArray(),
        destination: destination.toArray(),
        warnings: human.warnings,
      }
    );

  } catch (error) {
    console.error(
      "[AstraWay] WALK PREVIEW ERROR",
      error
    );

    setStatus(
      "ОШИБКА: " +
      (error?.message || String(error))
    );
  }
}


/*
 * FRAME LOOP
 *
 * В этом режиме PoseWriter не вызывается.
 * Донор временно управляет скелетом напрямую.
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
    human.update(dt);

    cameraOffset
      .copy(forward)
      .negate()
      .multiplyScalar(4.2);

    cameraOffset.y = 1.8;

    camera.position
      .copy(characterRoot.position)
      .add(cameraOffset);

    lookTarget
      .copy(characterRoot.position);

    lookTarget.y += 0.95;

    camera.lookAt(lookTarget);
  }

  renderer.render(scene, camera);
}


window.addEventListener("resize", () => {
  camera.aspect =
    window.innerWidth /
    Math.max(window.innerHeight, 1);

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );
});


loadCharacter();
animate();
