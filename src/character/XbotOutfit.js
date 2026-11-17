import * as THREE from "three";

const MATERIALS = {
  jacket: new THREE.MeshStandardMaterial({
    color: 0x34483f,
    roughness: 0.92,
  }),
  pants: new THREE.MeshStandardMaterial({
    color: 0x9a8060,
    roughness: 0.96,
  }),
  leather: new THREE.MeshStandardMaterial({
    color: 0x493326,
    roughness: 0.85,
  }),
  metal: new THREE.MeshStandardMaterial({
    color: 0x9b8150,
    metalness: 0.55,
    roughness: 0.5,
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

function addFittedPart(
  root,
  boneName,
  geometry,
  material,
  position,
  scale
) {
  const parent = findBone(root, boneName);

  if (!parent) {
    console.warn(`[AstraWay Outfit] Bone missing: ${boneName}`);
    return false;
  }

  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(position);
  mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "AstraWay_TestOutfit";

  parent.add(mesh);

  return true;
}

function addBoneSegment(
  root,
  startName,
  endName,
  radius,
  material
) {
  const startBone = findBone(root, startName);
  const endBone = findBone(root, endName);

  if (!startBone || !endBone) {
    console.warn(
      `[AstraWay Outfit] Segment missing: ${startName} → ${endName}`
    );
    return false;
  }

  root.updateMatrixWorld(true);

  const endWorld = endBone.getWorldPosition(
    new THREE.Vector3()
  );

  const endLocal = startBone.worldToLocal(endWorld.clone());
  const length = endLocal.length();

  if (length < 0.001) return false;

  const direction = endLocal.clone().normalize();

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radius * 0.88,
      radius,
      length,
      12
    ),
    material
  );

  mesh.position.copy(endLocal).multiplyScalar(0.5);

  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "AstraWay_TestOutfit";

  // Деталь следует за родительской костью.
  startBone.add(mesh);

  return true;
}

export function attachXbotOutfit(root) {
  const requiredBones = [
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

  for (const name of requiredBones) {
    if (!findBone(root, name)) {
      throw new Error(`XBot outfit: required bone missing: ${name}`);
    }
  }

  root.updateMatrixWorld(true);

  // Куртка.
  addFittedPart(
    root,
    "Spine",
    new THREE.CapsuleGeometry(0.205, 0.30, 5, 12),
    MATERIALS.jacket,
    new THREE.Vector3(0, 0.13, 0),
    new THREE.Vector3(1, 1, 0.78)
  );

  addFittedPart(
    root,
    "Spine2",
    new THREE.CapsuleGeometry(0.205, 0.12, 4, 12),
    MATERIALS.jacket,
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Vector3(1.08, 0.85, 0.82)
  );

  // Пояс и пряжка.
  addFittedPart(
    root,
    "Hips",
    new THREE.TorusGeometry(0.19, 0.025, 8, 24),
    MATERIALS.leather,
    new THREE.Vector3(0, 0.035, 0),
    new THREE.Vector3(1.15, 1, 0.82)
  );

  addFittedPart(
    root,
    "Hips",
    new THREE.BoxGeometry(0.075, 0.065, 0.035),
    MATERIALS.metal,
    new THREE.Vector3(0, 0.035, 0.19),
    new THREE.Vector3(1, 1, 1)
  );

  // Рукава и предплечья.
  addBoneSegment(root, "LeftArm", "LeftForeArm", 0.075, MATERIALS.jacket);
  addBoneSegment(root, "RightArm", "RightForeArm", 0.075, MATERIALS.jacket);

  addBoneSegment(root, "LeftForeArm", "LeftHand", 0.065, MATERIALS.leather);
  addBoneSegment(root, "RightForeArm", "RightHand", 0.065, MATERIALS.leather);

  // Брюки.
  addBoneSegment(root, "LeftUpLeg", "LeftLeg", 0.105, MATERIALS.pants);
  addBoneSegment(root, "RightUpLeg", "RightLeg", 0.105, MATERIALS.pants);

  addBoneSegment(root, "LeftLeg", "LeftFoot", 0.075, MATERIALS.pants);
  addBoneSegment(root, "RightLeg", "RightFoot", 0.075, MATERIALS.pants);

  // Ботинки.
  addFittedPart(
    root,
    "LeftFoot",
    new THREE.BoxGeometry(0.14, 0.12, 0.25),
    MATERIALS.leather,
    new THREE.Vector3(0, -0.015, 0.07),
    new THREE.Vector3(1, 1, 1)
  );

  addFittedPart(
    root,
    "RightFoot",
    new THREE.BoxGeometry(0.14, 0.12, 0.25),
    MATERIALS.leather,
    new THREE.Vector3(0, -0.015, 0.07),
    new THREE.Vector3(1, 1, 1)
  );

  root.updateMatrixWorld(true);

  console.log("[AstraWay Outfit] TEST OUTFIT ATTACHED");

  return true;
}