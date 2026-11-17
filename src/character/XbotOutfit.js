// src/character/XbotOutfit.js
import * as THREE from "three";

const TAG = "AstraWay_Ranger_";

const MAT = {
  jacket: new THREE.MeshStandardMaterial({
    color: 0x465b38,
    roughness: 0.88,
    side: THREE.DoubleSide,
  }),
  jacketLight: new THREE.MeshStandardMaterial({
    color: 0x718052,
    roughness: 0.9,
    side: THREE.DoubleSide,
  }),
  trousers: new THREE.MeshStandardMaterial({
    color: 0x34352d,
    roughness: 0.95,
    side: THREE.DoubleSide,
  }),
  leather: new THREE.MeshStandardMaterial({
    color: 0x543622,
    roughness: 0.9,
    side: THREE.DoubleSide,
  }),
  dark: new THREE.MeshStandardMaterial({
    color: 0x211d19,
    roughness: 0.92,
    side: THREE.DoubleSide,
  }),
  metal: new THREE.MeshStandardMaterial({
    color: 0xa58b59,
    metalness: 0.35,
    roughness: 0.5,
  }),
  hair: new THREE.MeshStandardMaterial({
    color: 0x30251f,
    roughness: 0.95,
  }),
  skin: new THREE.MeshStandardMaterial({
    color: 0xb77d5b,
    roughness: 0.9,
  }),
  eyes: new THREE.MeshStandardMaterial({
    color: 0x17130f,
    roughness: 0.5,
  }),
};

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_FORWARD = new THREE.Vector3(0, 0, -1);

// Насколько вывести одежду наружу относительно «анатомической» толщины.
const OUTER_INFLATE = 1.18;

function findBone(root, name) {
  let result = null;
  root.traverse((o) => {
    if (o.isBone && o.name === name) result = o;
  });
  return result;
}

function worldPosition(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

function boneDistance(boneA, boneB) {
  if (!boneA || !boneB) return 0;
  const a = worldPosition(boneA);
  const b = worldPosition(boneB);
  const d = a.distanceTo(b);
  return Number.isFinite(d) ? d : 0;
}

function removeOldOutfit(root) {
  const old = [];

  root.traverse((o) => {
    if (o.name && o.name.startsWith(TAG)) old.push(o);
  });

  for (const o of old) {
    o.parent?.remove(o);
    if (o.geometry) o.geometry.dispose();
  }
}

function addWorldEllipsoid(root, parentBone, position, scale, material, name) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), material);

  mesh.name = TAG + name;
  mesh.position.copy(root.worldToLocal(position.clone()));
  mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;

  root.add(mesh);
  root.updateMatrixWorld(true);

  if (parentBone) {
    parentBone.attach(mesh);
  }

  return mesh;
}

/**
 * Сегмент одежды между двумя костями.
 * Толщина = доля длины сегмента (не bbox T-позы).
 */
function addSegment(
  root,
  boneA,
  boneB,
  radiusFracX,
  radiusFracZ,
  material,
  name
) {
  if (!boneA || !boneB) return false;

  root.updateMatrixWorld(true);

  const a = worldPosition(boneA);
  const b = worldPosition(boneB);
  const direction = b.clone().sub(a);
  const length = direction.length();

  if (!Number.isFinite(length) || length < 0.015) return false;

  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const worldQuaternion = new THREE.Quaternion().setFromUnitVectors(
    UP,
    direction.normalize()
  );

  const rootQuaternion = root.getWorldQuaternion(new THREE.Quaternion());
  const localQuaternion = rootQuaternion.clone().invert().multiply(worldQuaternion);

  const radiusX = Math.max(length * radiusFracX, 0.02) * OUTER_INFLATE;
  const radiusZ = Math.max(length * radiusFracZ, 0.02) * OUTER_INFLATE;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), material);

  mesh.name = TAG + name;
  mesh.position.copy(root.worldToLocal(midpoint));
  mesh.quaternion.copy(localQuaternion);
  mesh.scale.set(radiusX, length * 0.5 + radiusX * 0.28, radiusZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;

  root.add(mesh);
  root.updateMatrixWorld(true);
  boneA.attach(mesh);

  return true;
}

function addDetail(root, bone, worldPositionValue, scale, material, name) {
  return addWorldEllipsoid(
    root,
    bone,
    worldPositionValue,
    scale,
    material,
    name
  );
}

function addFallbackTorso(root, bounds, height) {
  const center = bounds.getCenter(new THREE.Vector3());
  center.y = bounds.min.y + height * 0.67;

  const hx = height * 0.12 * OUTER_INFLATE;
  const hy = height * 0.18 * OUTER_INFLATE;
  const hz = height * 0.09 * OUTER_INFLATE;

  addWorldEllipsoid(
    root,
    null,
    center,
    new THREE.Vector3(hx, hy, hz),
    MAT.jacket,
    "FallbackJacket"
  );
}

export function attachXbotOutfit(root) {
  if (!root?.isObject3D) {
    throw new Error("Ranger: invalid model root");
  }

  root.updateMatrixWorld(true);
  removeOldOutfit(root);

  const bounds = new THREE.Box3().setFromObject(root);

  if (bounds.isEmpty()) {
    throw new Error("Ranger: model bounds are empty");
  }

  const size = bounds.getSize(new THREE.Vector3());
  const height = size.y;

  if (!Number.isFinite(height) || height < 0.1) {
    throw new Error("Ranger: invalid model height");
  }

  const B = {
    hips: findBone(root, "Hips"),
    spine: findBone(root, "Spine"),
    spine1: findBone(root, "Spine1"),
    spine2: findBone(root, "Spine2"),
    neck: findBone(root, "Neck"),
    head: findBone(root, "Head"),

    leftShoulder: findBone(root, "LeftShoulder"),
    leftArm: findBone(root, "LeftArm"),
    leftForeArm: findBone(root, "LeftForeArm"),
    leftHand: findBone(root, "LeftHand"),

    rightShoulder: findBone(root, "RightShoulder"),
    rightArm: findBone(root, "RightArm"),
    rightForeArm: findBone(root, "RightForeArm"),
    rightHand: findBone(root, "RightHand"),

    leftUpLeg: findBone(root, "LeftUpLeg"),
    leftLeg: findBone(root, "LeftLeg"),
    leftFoot: findBone(root, "LeftFoot"),

    rightUpLeg: findBone(root, "RightUpLeg"),
    rightLeg: findBone(root, "RightLeg"),
    rightFoot: findBone(root, "RightFoot"),

    leftToe: findBone(root, "LeftToeBase"),
    rightToe: findBone(root, "RightToeBase"),
  };

  root.updateMatrixWorld(true);

  // Направление лица / носков.
  let forward = DEFAULT_FORWARD.clone();

  if (B.leftToe && B.rightToe && B.leftFoot && B.rightFoot) {
    const l = worldPosition(B.leftToe).sub(worldPosition(B.leftFoot));
    const r = worldPosition(B.rightToe).sub(worldPosition(B.rightFoot));
    forward.copy(l.add(r)).setY(0);

    if (forward.lengthSq() > 0.0001) forward.normalize();
    else forward.copy(DEFAULT_FORWARD);
  }

  // Метрики скелета (не bbox T-позы).
  const torsoLen =
    boneDistance(B.hips, B.spine2) ||
    boneDistance(B.hips, B.spine) ||
    height * 0.28;

  const shoulderSpan =
    boneDistance(B.leftShoulder, B.rightShoulder) || height * 0.22;

  // Толщина торса: доля длины торса + доля ширины плеч (узкая база).
  const torsoRadX = Math.max(torsoLen * 0.42, shoulderSpan * 0.28);
  const torsoRadZ = Math.max(torsoLen * 0.32, shoulderSpan * 0.18);

  // -------------------------------
  // КУРТКА
  // -------------------------------

  if (B.hips && B.spine2) {
    addSegment(root, B.hips, B.spine2, 0.42, 0.34, MAT.jacket, "Jacket");
  } else if (B.hips && B.spine) {
    addSegment(root, B.hips, B.spine, 0.45, 0.36, MAT.jacket, "Jacket");
  } else {
    addFallbackTorso(root, bounds, height);
  }

  if (B.spine2 && B.neck) {
    addSegment(
      root,
      B.spine2,
      B.neck,
      0.38,
      0.32,
      MAT.jacketLight,
      "UpperJacket"
    );
  }

  if (B.neck) {
    const p = worldPosition(B.neck);
    const collarR = Math.max(torsoRadX * 0.55, height * 0.04) * OUTER_INFLATE;
    addDetail(
      root,
      B.neck,
      p,
      new THREE.Vector3(collarR, height * 0.032 * OUTER_INFLATE, collarR * 0.85),
      MAT.leather,
      "Collar"
    );
  }

  // -------------------------------
  // РУКАВА
  // -------------------------------

  for (const side of ["left", "right"]) {
    const shoulder = B[`${side}Shoulder`];
    const arm = B[`${side}Arm`];
    const forearm = B[`${side}ForeArm`];
    const hand = B[`${side}Hand`];

    if (shoulder && arm) {
      // ~0.22 длины сегмента — радиус руки.
      addSegment(
        root,
        shoulder,
        arm,
        0.24,
        0.22,
        MAT.jacket,
        `${side}UpperSleeve`
      );

      const p = worldPosition(shoulder);
      const guard = Math.max(boneDistance(shoulder, arm) * 0.28, height * 0.03);
      addDetail(
        root,
        shoulder,
        p,
        new THREE.Vector3(
          guard * OUTER_INFLATE,
          guard * 0.95 * OUTER_INFLATE,
          guard * OUTER_INFLATE
        ),
        MAT.leather,
        `${side}ShoulderGuard`
      );
    }

    if (arm && forearm) {
      addSegment(
        root,
        arm,
        forearm,
        0.22,
        0.2,
        MAT.jacketLight,
        `${side}ForeSleeve`
      );
      addSegment(
        root,
        arm,
        forearm,
        0.26,
        0.24,
        MAT.leather,
        `${side}ForearmGuard`
      );
    }

    if (forearm && hand) {
      addSegment(root, forearm, hand, 0.2, 0.2, MAT.dark, `${side}Glove`);
    }
  }

  // -------------------------------
  // БРЮКИ И САПОГИ
  // -------------------------------

  for (const side of ["left", "right"]) {
    const thigh = B[`${side}UpLeg`];
    const shin = B[`${side}Leg`];
    const foot = B[`${side}Foot`];

    if (thigh && shin) {
      addSegment(root, thigh, shin, 0.22, 0.2, MAT.trousers, `${side}Trousers`);
    }

    if (shin && foot) {
      addSegment(
        root,
        shin,
        foot,
        0.2,
        0.19,
        MAT.trousers,
        `${side}LowerTrousers`
      );
      addSegment(
        root,
        shin,
        foot,
        0.24,
        0.22,
        MAT.leather,
        `${side}BootShaft`
      );
    }

    if (foot) {
      const p = worldPosition(foot);
      const shinLen = boneDistance(shin, foot) || height * 0.12;
      const bootR = Math.max(shinLen * 0.35, height * 0.035) * OUTER_INFLATE;

      const bootPosition = p
        .clone()
        .add(forward.clone().multiplyScalar(height * 0.03))
        .add(new THREE.Vector3(0, -height * 0.01, 0));

      addDetail(
        root,
        foot,
        bootPosition,
        new THREE.Vector3(bootR * 1.05, height * 0.04 * OUTER_INFLATE, bootR * 1.35),
        MAT.leather,
        `${side}Boot`
      );

      const solePosition = bootPosition.clone();
      solePosition.y -= height * 0.032;

      addDetail(
        root,
        foot,
        solePosition,
        new THREE.Vector3(
          bootR * 1.08,
          height * 0.012 * OUTER_INFLATE,
          bootR * 1.4
        ),
        MAT.dark,
        `${side}BootSole`
      );
    }
  }

  // -------------------------------
  // ПОЯС
  // -------------------------------

  if (B.hips) {
    const p = worldPosition(B.hips);
    const beltX = Math.max(torsoRadX * 0.95, height * 0.08) * OUTER_INFLATE;
    const beltZ = Math.max(torsoRadZ * 1.05, height * 0.06) * OUTER_INFLATE;

    addDetail(
      root,
      B.hips,
      p,
      new THREE.Vector3(beltX, height * 0.022 * OUTER_INFLATE, beltZ),
      MAT.leather,
      "Belt"
    );

    const bucklePosition = p
      .clone()
      .add(forward.clone().multiplyScalar(beltZ * 0.95));

    addDetail(
      root,
      B.hips,
      bucklePosition,
      new THREE.Vector3(
        height * 0.03 * OUTER_INFLATE,
        height * 0.03 * OUTER_INFLATE,
        height * 0.016 * OUTER_INFLATE
      ),
      MAT.metal,
      "BeltBuckle"
    );
  }

  // -------------------------------
  // ГОЛОВА
  // -------------------------------

  if (B.head) {
    const headPosition = worldPosition(B.head);
    const neckToHead = boneDistance(B.neck, B.head) || height * 0.08;
    const headRadius = Math.max(neckToHead * 0.85, height * 0.055) * OUTER_INFLATE;

    const hairPosition = headPosition
      .clone()
      .add(new THREE.Vector3(0, headRadius * 0.45, 0));

    addDetail(
      root,
      B.head,
      hairPosition,
      new THREE.Vector3(headRadius * 0.98, headRadius * 0.6, headRadius * 0.98),
      MAT.hair,
      "Hair"
    );

    const faceCenter = headPosition
      .clone()
      .add(forward.clone().multiplyScalar(headRadius * 0.7));

    const rightVector = new THREE.Vector3().crossVectors(forward, UP).normalize();

    for (const side of [-1, 1]) {
      const eyePosition = faceCenter
        .clone()
        .add(rightVector.clone().multiplyScalar(side * headRadius * 0.3))
        .add(new THREE.Vector3(0, headRadius * 0.1, 0));

      addDetail(
        root,
        B.head,
        eyePosition,
        new THREE.Vector3(
          headRadius * 0.12,
          headRadius * 0.09,
          headRadius * 0.08
        ),
        MAT.eyes,
        "Eye"
      );
    }

    addDetail(
      root,
      B.head,
      faceCenter.clone().add(forward.clone().multiplyScalar(headRadius * 0.1)),
      new THREE.Vector3(
        headRadius * 0.13,
        headRadius * 0.16,
        headRadius * 0.14
      ),
      MAT.skin,
      "Nose"
    );
  }

  root.updateMatrixWorld(true);

  let outfitParts = 0;
  root.traverse((o) => {
    if (o.name && o.name.startsWith(TAG)) outfitParts++;
  });

  console.log("[AstraWay] Ranger outfit created", {
    height,
    torsoLen,
    shoulderSpan,
    bonesFound: Object.values(B).filter(Boolean).length,
    outfitParts,
  });

  return true;
}