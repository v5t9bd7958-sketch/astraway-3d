
import * as THREE from "three";

const TAG = "AstraWay_Ranger_";

const M = {
  jacket: new THREE.MeshStandardMaterial({ color: 0x354b39, roughness: 0.94 }),
  jacketLight: new THREE.MeshStandardMaterial({ color: 0x526448, roughness: 0.92 }),
  trousers: new THREE.MeshStandardMaterial({ color: 0x39372f, roughness: 0.96 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x493020, roughness: 0.88 }),
  leatherDark: new THREE.MeshStandardMaterial({ color: 0x211a16, roughness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xa58b59, metalness: 0.55, roughness: 0.45 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x30251f, roughness: 0.95 }),
  eyes: new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 0.5 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xb77d5b, roughness: 0.85 }),
};

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function findBone(root, name) {
  let found = null;
  root.traverse((o) => {
    if (o.isBone && o.name === name) found = o;
  });
  return found;
}

function worldPos(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

function worldDirToLocal(parent, direction) {
  const q = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  return direction.clone().applyQuaternion(q).normalize();
}

function localPoint(parent, worldPoint) {
  return parent.worldToLocal(worldPoint.clone());
}

function addMesh(parent, geometry, material, name, position, quaternion) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = TAG + name;
  mesh.position.copy(position);
  mesh.quaternion.copy(quaternion);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addSphere(parent, position, scale, material, name) {
  const mesh = addMesh(
    parent,
    new THREE.SphereGeometry(1, 20, 16),
    material,
    name,
    position,
    new THREE.Quaternion()
  );
  mesh.scale.copy(scale);
  return mesh;
}

/*
 * Создаёт объёмную деталь между двумя костями.
 * Геометрия хранится в локальном пространстве родительской кости.
 */
function garmentSegment(parent, boneA, boneB, radiusA, radiusB, material, name) {
  const start = localPoint(parent, worldPos(boneA));
  const end = localPoint(parent, worldPos(boneB));
  const direction = end.clone().sub(start);
  const length = direction.length();

  if (length < 0.002) return null;

  const quaternion = new THREE.Quaternion()
    .setFromUnitVectors(UP, direction.clone().normalize());

  const group = new THREE.Group();
  group.name = TAG + name;
  group.position.copy(start).add(end).multiplyScalar(0.5);
  group.quaternion.copy(quaternion);
  parent.add(group);

  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radiusB,
      radiusA,
      length,
      20,
      1,
      false
    ),
    material
  );

  cylinder.name = TAG + name + "_Body";
  cylinder.castShadow = true;
  cylinder.receiveShadow = true;
  group.add(cylinder);

  const capGeometry = new THREE.SphereGeometry(1, 16, 12);

  const capA = new THREE.Mesh(capGeometry, material);
  capA.name = TAG + name + "_Start";
  capA.scale.setScalar(radiusA);
  capA.position.y = -length * 0.5;
  capA.castShadow = true;
  group.add(capA);

  const capB = new THREE.Mesh(capGeometry, material);
  capB.name = TAG + name + "_End";
  capB.scale.setScalar(radiusB);
  capB.position.y = length * 0.5;
  capB.castShadow = true;
  group.add(capB);

  return group;
}

function addBox(parent, position, size, material, forward, name) {
  const localForward = worldDirToLocal(parent, forward);
  const quaternion = new THREE.Quaternion()
    .setFromUnitVectors(FORWARD, localForward);

  const mesh = addMesh(
    parent,
    new THREE.BoxGeometry(size.x, size.y, size.z),
    material,
    name,
    position,
    quaternion
  );

  return mesh;
}

function addBelt(hips, height, forward) {
  const localUp = worldDirToLocal(hips, UP);

  const ring = addMesh(
    hips,
    new THREE.TorusGeometry(height * 0.067, height * 0.009, 10, 40),
    M.leather,
    "Belt",
    new THREE.Vector3(),
    new THREE.Quaternion().setFromUnitVectors(Z_AXIS, localUp)
  );

  ring.castShadow = true;

  const localForward = worldDirToLocal(hips, forward);
  const bucklePosition = localForward.clone().multiplyScalar(height * 0.069);

  addBox(
    hips,
    bucklePosition,
    new THREE.Vector3(height * 0.038, height * 0.032, height * 0.012),
    M.metal,
    forward,
    "BeltBuckle"
  );

  // Боковая сумка
  const localRight = worldDirToLocal(hips, new THREE.Vector3(1, 0, 0));

  addBox(
    hips,
    localRight.clone().multiplyScalar(height * 0.075),
    new THREE.Vector3(height * 0.055, height * 0.075, height * 0.045),
    M.leather,
    forward,
    "BeltPouch"
  );
}

function makeBoot(foot, height, forward) {
  const localForward = worldDirToLocal(foot, forward);
  const localUp = worldDirToLocal(foot, UP);

  const center = localForward.clone().multiplyScalar(height * 0.035)
    .addScaledVector(localUp, -height * 0.012);

  addBox(
    foot,
    center,
    new THREE.Vector3(height * 0.078, height * 0.065, height * 0.125),
    M.leather,
    forward,
    "Boot"
  );

  addBox(
    foot,
    center.clone().addScaledVector(localUp, -height * 0.038),
    new THREE.Vector3(height * 0.082, height * 0.014, height * 0.13),
    M.leatherDark,
    forward,
    "BootSole"
  );

  // Ремешок на голенище
  addBox(
    foot,
    center.clone().addScaledVector(localUp, height * 0.025),
    new THREE.Vector3(height * 0.081, height * 0.012, height * 0.13),
    M.metal,
    forward,
    "BootStrap"
  );
}

function makeFace(head, height, forward) {
  const radius = height * 0.064;
  const localForward = worldDirToLocal(head, forward);
  const localUp = worldDirToLocal(head, UP);
  const localRight = new THREE.Vector3()
    .crossVectors(localForward, localUp)
    .normalize();

  const face = localUp.clone().multiplyScalar(height * 0.035);

  // Волосы: шапка и передняя прядь
  addSphere(
    head,
    face.clone().addScaledVector(localUp, radius * 0.48),
    new THREE.Vector3(radius * 0.94, radius * 0.58, radius * 0.94),
    M.hair,
    "Hair"
  );

  addSphere(
    head,
    face.clone()
      .addScaledVector(localForward, radius * 0.58)
      .addScaledVector(localUp, radius * 0.46),
    new THREE.Vector3(radius * 0.65, radius * 0.2, radius * 0.36),
    M.hair,
    "HairFront"
  );

  for (const side of [-1, 1]) {
    const eye = face.clone()
      .addScaledVector(localForward, radius * 0.91)
      .addScaledVector(localRight, side * radius * 0.34)
      .addScaledVector(localUp, radius * 0.12);

    addSphere(
      head,
      eye,
      new THREE.Vector3(radius * 0.12, radius * 0.105, radius * 0.07),
      M.eyes,
      "Eye"
    );

    addSphere(
      head,
      eye.clone().addScaledVector(localUp, radius * 0.18),
      new THREE.Vector3(radius * 0.2, radius * 0.05, radius * 0.07),
      M.hair,
      "Eyebrow"
    );
  }

  addSphere(
    head,
    face.clone()
      .addScaledVector(localForward, radius * 1.02)
      .addScaledVector(localUp, -radius * 0.04),
    new THREE.Vector3(radius * 0.13, radius * 0.17, radius * 0.16),
    M.skin,
    "Nose"
  );

  addSphere(
    head,
    face.clone()
      .addScaledVector(localForward, radius * 0.96)
      .addScaledVector(localUp, -radius * 0.34),
    new THREE.Vector3(radius * 0.19, radius * 0.045, radius * 0.045),
    M.leatherDark,
    "Mouth"
  );
}

function removeOldOutfit(root) {
  const objects = [];

  root.traverse((object) => {
    if (
      object.name.startsWith(TAG) ||
      object.name.startsWith("AstraWay_SkinnedOutfit")
    ) {
      objects.push(object);
    }
  });

  for (const object of objects) {
    object.parent?.remove(object);

    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
  }
}

export function attachXbotOutfit(root) {
  if (!root?.isObject3D) {
    throw new Error("Ranger: invalid XBot root");
  }

  root.updateMatrixWorld(true);
  removeOldOutfit(root);

  const required = [
    "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "LeftUpLeg", "LeftLeg", "LeftFoot",
    "RightUpLeg", "RightLeg", "RightFoot",
  ];

  const B = {};
  for (const name of required) B[name] = findBone(root, name);

  const missing = required.filter((name) => !B[name]);
  if (missing.length) {
    throw new Error("Ranger: missing bones: " + missing.join(", "));
  }

  const bounds = new THREE.Box3().setFromObject(root);
  const height = bounds.max.y - bounds.min.y;

  if (!Number.isFinite(height) || height < 0.1) {
    throw new Error("Ranger: invalid character dimensions");
  }

  const leftToe = findBone(root, "LeftToeBase");
  const rightToe = findBone(root, "RightToeBase");

  let forward = FORWARD.clone();

  if (leftToe && rightToe) {
    const leftDirection = worldPos(leftToe).sub(worldPos(B.LeftFoot));
    const rightDirection = worldPos(rightToe).sub(worldPos(B.RightFoot));

    forward.copy(leftDirection.add(rightDirection)).setY(0);

    if (forward.lengthSq() > 0.0001) forward.normalize();
    else forward.copy(FORWARD);
  }

  // КУРТКА
  garmentSegment(B.Hips, B.Hips, B.Spine,
    height * 0.105, height * 0.105, M.jacket, "JacketLower");

  garmentSegment(B.Spine, B.Spine, B.Spine1,
    height * 0.115, height * 0.11, M.jacket, "JacketMiddle");

  garmentSegment(B.Spine1, B.Spine1, B.Spine2,
    height * 0.105, height * 0.095, M.jacketLight, "JacketChest");

  garmentSegment(B.Spine2, B.Spine2, B.Neck,
    height * 0.065, height * 0.055, M.leather, "Collar");

  // Плечевые накладки
  for (const side of ["Left", "Right"]) {
    const shoulder = B[side + "Shoulder"];
    const p = new THREE.Vector3();

    addSphere(
      shoulder,
      p,
      new THREE.Vector3(height * 0.052, height * 0.045, height * 0.055),
      M.leather,
      side + "ShoulderGuard"
    );
  }

  // РУКАВА И ПЕРЧАТКИ
  for (const side of ["Left", "Right"]) {
    const shoulder = B[side + "Shoulder"];
    const arm = B[side + "Arm"];
    const forearm = B[side + "ForeArm"];
    const hand = B[side + "Hand"];

    garmentSegment(arm, shoulder, arm,
      height * 0.044, height * 0.043, M.jacket, side + "UpperSleeve");

    garmentSegment(forearm, arm, forearm,
      height * 0.043, height * 0.033, M.jacket, side + "ForeSleeve");

    garmentSegment(hand, forearm, hand,
      height * 0.031, height * 0.027, M.leatherDark, side + "Glove");

    garmentSegment(forearm, arm, forearm,
      height * 0.045, height * 0.034, M.leather, side + "ForearmGuard");
  }

  // ПОЯС И СУМКА
  addBelt(B.Hips, height, forward);

  // БРЮКИ И САПОГИ
  for (const side of ["Left", "Right"]) {
    const thigh = B[side + "UpLeg"];
    const shin = B[side + "Leg"];
    const foot = B[side + "Foot"];

    garmentSegment(thigh, thigh, shin,
      height * 0.068, height * 0.052, M.trousers, side + "Trousers");

    garmentSegment(shin, shin, foot,
      height * 0.052, height * 0.043, M.trousers, side + "LowerTrousers");

    // Кожаные голенища
    garmentSegment(shin, shin, foot,
      height * 0.054, height * 0.046, M.leather, side + "BootShaft");

    makeBoot(foot, height, forward);
  }

  // ЛИЦО И ВОЛОСЫ
  makeFace(B.Head, height, forward);

  root.updateMatrixWorld(true);

  console.log("[AstraWay] Ranger outfit attached", {
    height,
    version: "2.0",
    outfit: "Ranger",
  });

  return true;
}
