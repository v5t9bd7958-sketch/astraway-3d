
import * as THREE from "three";

const TAG = "AstraWay_Ranger_";

const MAT = {
  jacket: new THREE.MeshStandardMaterial({
    color: 0x465b38, roughness: 0.88, side: THREE.DoubleSide
  }),
  jacketLight: new THREE.MeshStandardMaterial({
    color: 0x718052, roughness: 0.9, side: THREE.DoubleSide
  }),
  trousers: new THREE.MeshStandardMaterial({
    color: 0x34352d, roughness: 0.95, side: THREE.DoubleSide
  }),
  leather: new THREE.MeshStandardMaterial({
    color: 0x543622, roughness: 0.9, side: THREE.DoubleSide
  }),
  dark: new THREE.MeshStandardMaterial({
    color: 0x211d19, roughness: 0.92, side: THREE.DoubleSide
  }),
  metal: new THREE.MeshStandardMaterial({
    color: 0xa58b59, metalness: 0.35, roughness: 0.5
  }),
  hair: new THREE.MeshStandardMaterial({
    color: 0x30251f, roughness: 0.95
  }),
  skin: new THREE.MeshStandardMaterial({
    color: 0xb77d5b, roughness: 0.9
  }),
  eyes: new THREE.MeshStandardMaterial({
    color: 0x17130f, roughness: 0.5
  })
};

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_FORWARD = new THREE.Vector3(0, 0, -1);

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

function removeOldOutfit(root) {
  const old = [];

  root.traverse((o) => {
    if (o.name.startsWith(TAG)) old.push(o);
  });

  for (const o of old) {
    o.parent?.remove(o);
    if (o.geometry) o.geometry.dispose();
  }
}

function addWorldEllipsoid(
  root,
  parentBone,
  position,
  scale,
  material,
  name
) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 18),
    material
  );

  mesh.name = TAG + name;
  mesh.position.copy(root.worldToLocal(position.clone()));
  mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;

  root.add(mesh);
  root.updateMatrixWorld(true);

  // Переподчиняем без скачка положения в мировом пространстве.
  if (parentBone) {
    parentBone.attach(mesh);
  }

  return mesh;
}

function addSegment(
  root,
  boneA,
  boneB,
  radiusX,
  radiusZ,
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
  const worldQuaternion = new THREE.Quaternion()
    .setFromUnitVectors(UP, direction.normalize());

  const rootQuaternion = root.getWorldQuaternion(
    new THREE.Quaternion()
  );

  const localQuaternion = rootQuaternion
    .invert()
    .multiply(worldQuaternion);

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 18),
    material
  );

  mesh.name = TAG + name;
  mesh.position.copy(root.worldToLocal(midpoint));
  mesh.quaternion.copy(localQuaternion);

  // Удлинённая объёмная форма поверх тела, а не внутри него.
  mesh.scale.set(
    radiusX,
    length * 0.5 + radiusX * 0.28,
    radiusZ
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;

  root.add(mesh);
  root.updateMatrixWorld(true);

  // Верхняя часть следует за родительской костью.
  boneA.attach(mesh);

  return true;
}

function addDetail(
  root,
  bone,
  worldPositionValue,
  scale,
  material,
  name
) {
  return addWorldEllipsoid(
    root,
    bone,
    worldPositionValue,
    scale,
    material,
    name
  );
}

function addFallbackTorso(root, bounds, width, depth, height) {
  const center = bounds.getCenter(new THREE.Vector3());
  center.y = bounds.min.y + height * 0.67;

  addWorldEllipsoid(
    root,
    null,
    center,
    new THREE.Vector3(width * 0.39, height * 0.17, depth * 0.58),
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

  const width = Math.max(size.x, height * 0.22);
  const depth = Math.max(size.z, height * 0.12);

  // Размеры одежды выводятся из реальных габаритов XBot.
  const torsoX = Math.max(width * 0.40, height * 0.095);
  const torsoZ = Math.max(depth * 0.62, height * 0.075);
  const armRadius = Math.max(width * 0.105, height * 0.038);
  const legRadius = Math.max(width * 0.145, height * 0.052);

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
    rightToe: findBone(root, "RightToeBase")
  };

  root.updateMatrixWorld(true);

  // Направление лица и обуви определяем по носкам.
  let forward = DEFAULT_FORWARD.clone();

  if (B.leftToe && B.rightToe && B.leftFoot && B.rightFoot) {
    const l = worldPosition(B.leftToe).sub(worldPosition(B.leftFoot));
    const r = worldPosition(B.rightToe).sub(worldPosition(B.rightFoot));

    forward.copy(l.add(r)).setY(0);

    if (forward.lengthSq() > 0.0001) forward.normalize();
    else forward.copy(DEFAULT_FORWARD);
  }

  // -------------------------------
  // КУРТКА
  // -------------------------------

  if (B.hips && B.spine2) {
    addSegment(
      root, B.hips, B.spine2,
      torsoX, torsoZ,
      MAT.jacket, "Jacket"
    );
  } else if (B.hips && B.spine) {
    addSegment(
      root, B.hips, B.spine,
      torsoX, torsoZ,
      MAT.jacket, "Jacket"
    );
  } else {
    addFallbackTorso(root, bounds, width, depth, height);
  }

  if (B.spine2 && B.neck) {
    addSegment(
      root, B.spine2, B.neck,
      torsoX * 0.53, torsoZ * 0.78,
      MAT.jacketLight, "UpperJacket"
    );
  }

  // Воротник.
  if (B.neck) {
    const p = worldPosition(B.neck);
    addDetail(
      root, B.neck,
      p,
      new THREE.Vector3(torsoX * 0.55, height * 0.035, torsoZ * 0.8),
      MAT.leather,
      "Collar"
    );
  }

  // -------------------------------
  // РУКАВА И НАКЛАДКИ
  // -------------------------------

  for (const side of ["left", "right"]) {
    const shoulder = B[side + "Shoulder"];
    const arm = B[side + "Arm"];
    const forearm = B[side + "ForeArm"];
    const hand = B[side + "Hand"];

    if (shoulder && arm) {
      addSegment(
        root, shoulder, arm,
        armRadius, armRadius * 0.92,
        MAT.jacket, side + "UpperSleeve"
      );

      const p = worldPosition(shoulder);
      addDetail(
        root, shoulder,
        p,
        new THREE.Vector3(armRadius * 1.28, armRadius * 1.12, armRadius * 1.28),
        MAT.leather,
        side + "ShoulderGuard"
      );
    }

    if (arm && forearm) {
      addSegment(
        root, arm, forearm,
        armRadius * 0.93, armRadius * 0.88,
        MAT.jacketLight, side + "ForeSleeve"
      );

      addSegment(
        root, arm, forearm,
        armRadius * 1.02, armRadius * 0.96,
        MAT.leather, side + "ForearmGuard"
      );
    }

    if (forearm && hand) {
      addSegment(
        root, forearm, hand,
        armRadius * 0.68, armRadius * 0.68,
        MAT.dark, side + "Glove"
      );
    }
  }

  // -------------------------------
  // БРЮКИ И САПОГИ
  // -------------------------------

  for (const side of ["left", "right"]) {
    const thigh = B[side + "UpLeg"];
    const shin = B[side + "Leg"];
    const foot = B[side + "Foot"];

    if (thigh && shin) {
      addSegment(
        root, thigh, shin,
        legRadius, legRadius * 0.88,
        MAT.trousers, side + "Trousers"
      );
    }

    if (shin && foot) {
      addSegment(
        root, shin, foot,
        legRadius * 0.76, legRadius * 0.76,
        MAT.trousers, side + "LowerTrousers"
      );

      addSegment(
        root, shin, foot,
        legRadius * 0.82, legRadius * 0.82,
        MAT.leather, side + "BootShaft"
      );
    }

    if (foot) {
      const p = worldPosition(foot);
      const bootPosition = p.clone()
        .add(forward.clone().multiplyScalar(height * 0.035))
        .add(new THREE.Vector3(0, -height * 0.012, 0));

      addDetail(
        root, foot,
        bootPosition,
        new THREE.Vector3(
          legRadius * 1.12,
          height * 0.045,
          height * 0.075
        ),
        MAT.leather,
        side + "Boot"
      );

      const solePosition = bootPosition.clone();
      solePosition.y -= height * 0.038;

      addDetail(
        root, foot,
        solePosition,
        new THREE.Vector3(
          legRadius * 1.16,
          height * 0.012,
          height * 0.078
        ),
        MAT.dark,
        side + "BootSole"
      );
    }
  }

  // -------------------------------
  // ПОЯС
  // -------------------------------

  if (B.hips) {
    const p = worldPosition(B.hips);

    addDetail(
      root, B.hips,
      p,
      new THREE.Vector3(torsoX * 1.02, height * 0.025, torsoZ * 1.08),
      MAT.leather,
      "Belt"
    );

    const bucklePosition = p.clone()
      .add(forward.clone().multiplyScalar(torsoZ * 1.02));

    addDetail(
      root, B.hips,
      bucklePosition,
      new THREE.Vector3(height * 0.035, height * 0.035, height * 0.018),
      MAT.metal,
      "BeltBuckle"
    );
  }

  // -------------------------------
  // ГОЛОВА, ВОЛОСЫ И ЛИЦО
  // -------------------------------

  if (B.head) {
    const headPosition = worldPosition(B.head);
    const headRadius = Math.max(height * 0.065, width * 0.12);

    const hairPosition = headPosition.clone()
      .add(new THREE.Vector3(0, headRadius * 0.48, 0));

    addDetail(
      root, B.head,
      hairPosition,
      new THREE.Vector3(headRadius * 0.98, headRadius * 0.62, headRadius * 0.98),
      MAT.hair,
      "Hair"
    );

    const faceCenter = headPosition.clone()
      .add(forward.clone().multiplyScalar(headRadius * 0.72));

    const rightVector = new THREE.Vector3()
      .crossVectors(forward, UP)
      .normalize();

    for (const side of [-1, 1]) {
      const eyePosition = faceCenter.clone()
        .add(rightVector.clone().multiplyScalar(side * headRadius * 0.32))
        .add(new THREE.Vector3(0, headRadius * 0.12, 0));

      addDetail(
        root, B.head,
        eyePosition,
        new THREE.Vector3(headRadius * 0.13, headRadius * 0.10, headRadius * 0.09),
        MAT.eyes,
        "Eye"
      );
    }

    addDetail(
      root, B.head,
      faceCenter.clone().add(forward.clone().multiplyScalar(headRadius * 0.12)),
      new THREE.Vector3(headRadius * 0.14, headRadius * 0.17, headRadius * 0.15),
      MAT.skin,
      "Nose"
    );
  }

  root.updateMatrixWorld(true);

  console.log("[AstraWay] Ranger outfit created", {
    height,
    bonesFound: Object.values(B).filter(Boolean).length,
    outfitParts: (() => {
      let count = 0;
      root.traverse((o) => {
        if (o.name.startsWith(TAG)) count++;
      });
      return count;
    })()
  });

  return true;
}
