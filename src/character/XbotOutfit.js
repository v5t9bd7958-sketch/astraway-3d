
import * as THREE from "three";

const PREFIX = "AstraWay_Ranger_";

const MAT = {
  cloth: new THREE.MeshStandardMaterial({
    color: 0x344b3c, roughness: 0.92,
  }),
  clothLight: new THREE.MeshStandardMaterial({
    color: 0x637052, roughness: 0.9,
  }),
  trousers: new THREE.MeshStandardMaterial({
    color: 0x403b32, roughness: 0.94,
  }),
  leather: new THREE.MeshStandardMaterial({
    color: 0x493020, roughness: 0.84,
  }),
  darkLeather: new THREE.MeshStandardMaterial({
    color: 0x241b17, roughness: 0.86,
  }),
  metal: new THREE.MeshStandardMaterial({
    color: 0x9a8050, metalness: 0.65, roughness: 0.4,
  }),
  skin: new THREE.MeshStandardMaterial({
    color: 0xb77d5b, roughness: 0.82,
  }),
  hair: new THREE.MeshStandardMaterial({
    color: 0x30251f, roughness: 0.95,
  }),
  eyes: new THREE.MeshStandardMaterial({
    color: 0x211914, roughness: 0.4,
  }),
  white: new THREE.MeshStandardMaterial({
    color: 0xe6d9bd, roughness: 0.6,
  }),
};

const UP = new THREE.Vector3(0, 1, 0);

function bone(root, name) {
  let result = null;
  root.traverse((o) => {
    if (o.isBone && o.name === name) result = o;
  });
  return result;
}

function worldPosition(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

function attachWorld(parent, mesh, position, quaternion) {
  mesh.position.copy(position);
  mesh.quaternion.copy(quaternion);
  mesh.updateMatrix();
  parent.attach(mesh);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function segment(parent, a, b, radiusX, radiusZ, material, padding = 0.025) {
  const start = worldPosition(a);
  const end = worldPosition(b);
  const direction = end.clone().sub(start);
  const length = direction.length();

  if (length < 0.001) return null;

  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const mesh = new THREE.Mesh(geometry, material);

  mesh.name = PREFIX + "Segment";
  mesh.scale.set(radiusX, length * 0.5 + padding, radiusZ);

  const quaternion = new THREE.Quaternion()
    .setFromUnitVectors(UP, direction.normalize());

  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return attachWorld(
    parent,
    mesh,
    start.add(end).multiplyScalar(0.5),
    quaternion
  );
}

function cylinderBetween(parent, a, b, radiusTop, radiusBottom, material) {
  const start = worldPosition(a);
  const end = worldPosition(b);
  const direction = end.clone().sub(start);
  const length = direction.length();

  if (length < 0.001) return null;

  const geometry = new THREE.CylinderGeometry(
    radiusTop, radiusBottom, length * 1.08, 16, 1, false
  );

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = PREFIX + "Garment";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const quaternion = new THREE.Quaternion()
    .setFromUnitVectors(UP, direction.normalize());

  return attachWorld(
    parent,
    mesh,
    start.add(end).multiplyScalar(0.5),
    quaternion
  );
}

function sphere(parent, position, scale, material, name) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 16),
    material
  );

  mesh.name = PREFIX + name;
  mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return attachWorld(parent, mesh, position, new THREE.Quaternion());
}

function box(parent, position, size, material, forward, name) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    material
  );

  mesh.name = PREFIX + name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const quaternion = new THREE.Quaternion()
    .setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      forward
    );

  return attachWorld(parent, mesh, position, quaternion);
}

function makeFace(root, head, height, forward, right) {
  const center = worldPosition(head);
  const radius = height * 0.065;

  const faceCenter = center.clone().addScaledVector(UP, height * 0.035);

  // Волосы
  sphere(
    head,
    faceCenter.clone().addScaledVector(UP, radius * 0.48),
    new THREE.Vector3(radius * 0.92, radius * 0.57, radius * 0.92),
    MAT.hair,
    "Hair"
  );

  // Передняя прядь
  sphere(
    head,
    faceCenter.clone()
      .addScaledVector(forward, radius * 0.58)
      .addScaledVector(UP, radius * 0.47),
    new THREE.Vector3(radius * 0.66, radius * 0.2, radius * 0.35),
    MAT.hair,
    "HairFront"
  );

  // Глаза
  for (const side of [-1, 1]) {
    const eyePosition = faceCenter.clone()
      .addScaledVector(forward, radius * 0.91)
      .addScaledVector(right, side * radius * 0.34)
      .addScaledVector(UP, radius * 0.12);

    sphere(
      head, eyePosition,
      new THREE.Vector3(radius * 0.12, radius * 0.105, radius * 0.07),
      MAT.eyes, "Eye"
    );

    // Брови
    sphere(
      head,
      eyePosition.clone().addScaledVector(UP, radius * 0.19),
      new THREE.Vector3(radius * 0.2, radius * 0.055, radius * 0.07),
      MAT.hair,
      "Eyebrow"
    );
  }

  // Нос
  sphere(
    head,
    faceCenter.clone()
      .addScaledVector(forward, radius * 1.02)
      .addScaledVector(UP, -radius * 0.04),
    new THREE.Vector3(radius * 0.13, radius * 0.17, radius * 0.16),
    MAT.skin,
    "Nose"
  );

  // Рот
  sphere(
    head,
    faceCenter.clone()
      .addScaledVector(forward, radius * 0.96)
      .addScaledVector(UP, -radius * 0.34),
    new THREE.Vector3(radius * 0.19, radius * 0.045, radius * 0.045),
    MAT.darkLeather,
    "Mouth"
  );
}

function makeBoot(foot, height, forward) {
  const center = worldPosition(foot);
  const position = center.clone()
    .addScaledVector(forward, height * 0.035)
    .addScaledVector(UP, -height * 0.018);

  box(
    foot, position,
    new THREE.Vector3(height * 0.075, height * 0.065, height * 0.12),
    MAT.leather, forward, "Boot"
  );

  const solePosition = position.clone()
    .addScaledVector(UP, -height * 0.038);

  box(
    foot, solePosition,
    new THREE.Vector3(height * 0.078, height * 0.014, height * 0.125),
    MAT.darkLeather, forward, "BootSole"
  );
}

function removePrevious(root) {
  const remove = [];

  root.traverse((object) => {
    if (object.name.startsWith(PREFIX) ||
        object.name.startsWith("AstraWay_SkinnedOutfit")) {
      remove.push(object);
    }
  });

  for (const object of remove) {
    object.parent?.remove(object);
    object.geometry?.dispose();
  }
}

export function attachXbotOutfit(root) {
  if (!root?.isObject3D) {
    throw new Error("Ranger: invalid XBot root");
  }

  root.updateMatrixWorld(true);
  removePrevious(root);

  const names = [
    "Hips", "Spine", "Spine1", "Spine2",
    "Neck", "Head",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "LeftUpLeg", "LeftLeg", "LeftFoot",
    "RightUpLeg", "RightLeg", "RightFoot",
  ];

  const bones = {};
  for (const name of names) {
    bones[name] = bone(root, name);
  }

  const missing = names.filter((name) => !bones[name]);
  if (missing.length) {
    throw new Error("Ranger: missing bones: " + missing.join(", "));
  }

  const bounds = new THREE.Box3().setFromObject(root);
  const height = Math.max(bounds.max.y - bounds.min.y, 1);
  const width = height * 0.055;
  const depth = height * 0.045;

  // Направление лица — по направлению носков XBot.
  const leftToe = bone(root, "LeftToeBase");
  const rightToe = bone(root, "RightToeBase");

  let forward = new THREE.Vector3(0, 0, -1);

  if (leftToe && rightToe) {
    const leftFoot = worldPosition(bones.LeftFoot);
    const rightFoot = worldPosition(bones.RightFoot);

    forward.copy(worldPosition(leftToe).sub(leftFoot))
      .add(worldPosition(rightToe).sub(rightFoot))
      .setY(0);

    if (forward.lengthSq() > 0.0001) forward.normalize();
    else forward.set(0, 0, -1);
  }

  const right = new THREE.Vector3()
    .crossVectors(forward, UP)
    .normalize();

  // КУРТКА — три подвижных секции корпуса.
  segment(bones.Hips, bones.Hips, bones.Spine,
    width * 2.25, depth * 2.0, MAT.cloth, height * 0.025);

  segment(bones.Spine, bones.Spine, bones.Spine1,
    width * 2.35, depth * 2.05, MAT.cloth, height * 0.025);

  segment(bones.Spine1, bones.Spine1, bones.Spine2,
    width * 2.15, depth * 1.9, MAT.clothLight, height * 0.025);

  // Воротник
  segment(bones.Spine2, bones.Spine2, bones.Neck,
    width * 1.15, depth * 1.15, MAT.leather, height * 0.012);

  // РЕМЕНЬ
  const hipsPosition = worldPosition(bones.Hips);
  const belt = new THREE.Mesh(
    new THREE.TorusGeometry(height * 0.067, height * 0.009, 8, 28),
    MAT.leather
  );

  belt.name = PREFIX + "Belt";
  belt.rotation.x = Math.PI / 2;
  belt.position.copy(hipsPosition);
  attachWorld(bones.Hips, belt, hipsPosition, belt.quaternion.clone());

  // Пряжка
  box(
    bones.Hips,
    hipsPosition.clone().addScaledVector(forward, height * 0.071),
    new THREE.Vector3(height * 0.045, height * 0.035, height * 0.012),
    MAT.metal, forward, "Buckle"
  );

  // РУКАВА И НАРУЧИ
  for (const side of ["Left", "Right"]) {
    const shoulder = bones[side + "Shoulder"];
    const arm = bones[side + "Arm"];
    const forearm = bones[side + "ForeArm"];
    const hand = bones[side + "Hand"];

    segment(arm, shoulder, arm,
      height * 0.045, height * 0.045, MAT.cloth, height * 0.012);

    segment(forearm, arm, forearm,
      height * 0.038, height * 0.038, MAT.cloth, height * 0.012);

    cylinderBetween(forearm, arm, forearm,
      height * 0.039, height * 0.043, MAT.leather);

    segment(hand, forearm, hand,
      height * 0.032, height * 0.032, MAT.darkLeather, height * 0.008);
  }

  // БРЮКИ
  for (const side of ["Left", "Right"]) {
    const thigh = bones[side + "UpLeg"];
    const shin = bones[side + "Leg"];
    const foot = bones[side + "Foot"];

    segment(thigh, bones.Hips, thigh,
      height * 0.073, height * 0.073, MAT.trousers, height * 0.018);

    segment(shin, thigh, shin,
      height * 0.052, height * 0.052, MAT.trousers, height * 0.015);

    // Сапоги
    cylinderBetween(shin, shin, foot,
      height * 0.052, height * 0.057, MAT.leather);

    makeBoot(foot, height, forward);
  }

  // ЛИЦО И ВОЛОСЫ
  makeFace(root, bones.Head, height, forward, right);

  // Плечевые кожаные элементы
  for (const side of ["Left", "Right"]) {
    const shoulder = bones[side + "Shoulder"];
    const p = worldPosition(shoulder);

    sphere(
      shoulder,
      p.clone(),
      new THREE.Vector3(height * 0.052, height * 0.045, height * 0.055),
      MAT.leather,
      "ShoulderGuard"
    );
  }

  root.updateMatrixWorld(true);

  console.log("[AstraWay] RANGER OUTFIT CREATED", {
    height,
    outfit: "AstraWay Ranger",
    parts: "jacket, trousers, sleeves, gloves, boots, face, hair, belt",
  });

  return true;
}
