
import * as THREE from "three";

const PREFIX = "AstraWay_TestOutfit";

const MATERIALS = {
  jacket: new THREE.MeshStandardMaterial({
    color: 0x245d91,
    roughness: 0.82,
    side: THREE.DoubleSide,
  }),
  pants: new THREE.MeshStandardMaterial({
    color: 0x9a7545,
    roughness: 0.9,
    side: THREE.DoubleSide,
  }),
  leather: new THREE.MeshStandardMaterial({
    color: 0x38271f,
    roughness: 0.86,
    side: THREE.DoubleSide,
  }),
};

function findBone(root, name) {
  let result = null;

  root.traverse((object) => {
    if (object.isBone && object.name === name) {
      result = object;
    }
  });

  return result;
}

function boneDistance(a, b) {
  if (!a || !b) return 0;

  const pa = a.getWorldPosition(new THREE.Vector3());
  const pb = b.getWorldPosition(new THREE.Vector3());

  return pa.distanceTo(pb);
}

function removePreviousOutfit(root) {
  const removals = [];

  root.traverse((object) => {
    if (object.isMesh && object.name.startsWith(PREFIX)) {
      removals.push(object);
    }
  });

  for (const mesh of removals) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
  }
}

function addSegment(root, startName, endName, ratio, material) {
  const start = findBone(root, startName);
  const end = findBone(root, endName);

  if (!start || !end) return false;

  root.updateMatrixWorld(true);

  const endWorld = end.getWorldPosition(new THREE.Vector3());
  const endLocal = start.worldToLocal(endWorld.clone());

  const length = endLocal.length();

  if (!Number.isFinite(length) || length < 0.005) {
    return false;
  }

  const radius = Math.min(length * ratio, length * 0.42);
  const cylinderLength = Math.max(length - radius * 2, 0.001);

  const geometry = new THREE.CapsuleGeometry(
    radius,
    cylinderLength,
    5,
    12
  );

  const mesh = new THREE.Mesh(geometry, material);

  mesh.name = `${PREFIX}_${startName}_${endName}`;
  mesh.position.copy(endLocal).multiplyScalar(0.5);

  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    endLocal.clone().normalize()
  );

  mesh.scale.z = 0.82;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  start.add(mesh);

  return true;
}

function addTorsoSection(root, startName, endName, width, material) {
  const start = findBone(root, startName);
  const end = findBone(root, endName);

  if (!start || !end || width <= 0) return false;

  root.updateMatrixWorld(true);

  const endWorld = end.getWorldPosition(new THREE.Vector3());
  const endLocal = start.worldToLocal(endWorld.clone());
  const length = endLocal.length();

  if (length < 0.005) return false;

  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const mesh = new THREE.Mesh(geometry, material);

  mesh.name = `${PREFIX}_Torso_${startName}`;
  mesh.position.copy(endLocal).multiplyScalar(0.5);

  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    endLocal.clone().normalize()
  );

  mesh.scale.set(
    width * 0.46,
    length * 0.72,
    width * 0.34
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  start.add(mesh);

  return true;
}

export function attachXbotOutfit(root) {
  if (!root) {
    throw new Error("XBot outfit: model root is missing");
  }

  root.updateMatrixWorld(true);
  removePreviousOutfit(root);

  const required = [
    "Hips",
    "Spine",
    "Spine2",
    "LeftUpLeg",
    "RightUpLeg",
    "LeftLeg",
    "RightLeg",
    "LeftFoot",
    "RightFoot",
  ];

  const missing = required.filter((name) => !findBone(root, name));

  if (missing.length) {
    throw new Error(
      `XBot outfit: missing bones: ${missing.join(", ")}`
    );
  }

  const leftShoulder = findBone(root, "LeftShoulder");
  const rightShoulder = findBone(root, "RightShoulder");

  const shoulderWidth = boneDistance(
    leftShoulder,
    rightShoulder
  );

  const leftUpperLegLength = boneDistance(
    findBone(root, "LeftUpLeg"),
    findBone(root, "LeftLeg")
  );

  const rightUpperLegLength = boneDistance(
    findBone(root, "RightUpLeg"),
    findBone(root, "RightLeg")
  );

  const referenceWidth = shoulderWidth > 0.01
    ? shoulderWidth
    : Math.max(leftUpperLegLength, rightUpperLegLength) * 0.85;

  let created = 0;

  const add = (...args) => {
    if (addSegment(root, ...args)) created++;
  };

  // Куртка: ширина рассчитывается по плечевому поясу.
  if (addTorsoSection(
    root, "Hips", "Spine", referenceWidth, MATERIALS.jacket
  )) created++;

  if (addTorsoSection(
    root, "Spine", "Spine2", referenceWidth, MATERIALS.jacket
  )) created++;

  // Рукава.
  add("LeftShoulder", "LeftArm", 0.19, MATERIALS.jacket);
  add("RightShoulder", "RightArm", 0.19, MATERIALS.jacket);

  add("LeftArm", "LeftForeArm", 0.17, MATERIALS.jacket);
  add("RightArm", "RightForeArm", 0.17, MATERIALS.jacket);

  // Кожаные манжеты и перчатки.
  add("LeftForeArm", "LeftHand", 0.15, MATERIALS.leather);
  add("RightForeArm", "RightHand", 0.15, MATERIALS.leather);

  // Брюки.
  add("LeftUpLeg", "LeftLeg", 0.19, MATERIALS.pants);
  add("RightUpLeg", "RightLeg", 0.19, MATERIALS.pants);

  add("LeftLeg", "LeftFoot", 0.16, MATERIALS.pants);
  add("RightLeg", "RightFoot", 0.16, MATERIALS.pants);

  // Обувь — по реальной длине стопы.
  add("LeftFoot", "LeftToeBase", 0.25, MATERIALS.leather);
  add("RightFoot", "RightToeBase", 0.25, MATERIALS.leather);

  root.updateMatrixWorld(true);

  console.log("[AstraWay Outfit] ATTACHED", {
    createdParts: created,
    shoulderWidth: Number(shoulderWidth.toFixed(4)),
    leftUpperLegLength: Number(leftUpperLegLength.toFixed(4)),
    rightUpperLegLength: Number(rightUpperLegLength.toFixed(4)),
  });

  return created > 0;
}
