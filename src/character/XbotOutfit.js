
import * as THREE from "three";

const MAT = {
  jacket: new THREE.MeshStandardMaterial({
    color: 0x34483f, roughness: 0.92
  }),
  pants: new THREE.MeshStandardMaterial({
    color: 0x9a8060, roughness: 0.96
  }),
  leather: new THREE.MeshStandardMaterial({
    color: 0x493326, roughness: 0.85
  }),
  metal: new THREE.MeshStandardMaterial({
    color: 0x9b8150, metalness: 0.55, roughness: 0.5
  })
};

function bone(root, name) {
  let found = null;
  root.traverse(o => {
    if (o.isBone && o.name === name) found = o;
  });
  return found;
}

function segment(root, aName, bName, radius, material, sides = 10) {
  const a = bone(root, aName);
  const b = bone(root, bName);
  if (!a || !b) return;

  root.updateMatrixWorld(true);

  const start = a.getWorldPosition(new THREE.Vector3());
  const end = b.getWorldPosition(new THREE.Vector3());
  const delta = end.clone().sub(start);
  const length = delta.length();

  if (length < 0.001) return;

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.88, radius, length, sides),
    material
  );

  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize()
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "AstraWay_TestOutfit";

  root.add(mesh);
}

function fittedPart(root, boneName, geometry, material, offset, scale) {
  const b = bone(root, boneName);
  if (!b) return;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(offset);
  mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "AstraWay_TestOutfit";

  b.add(mesh);
}

export function attachXbotOutfit(root) {
  const hips = bone(root, "Hips");
  const spine = bone(root, "Spine");
  const chest = bone(root, "Spine2");

  if (!hips || !spine || !chest) {
    throw new Error("XBot outfit: required torso bones missing");
  }

  root.updateMatrixWorld(true);

  // Куртка: короткий корпус на центральной части скелета.
  fittedPart(
    root,
    "Spine",
    new THREE.CapsuleGeometry(0.205, 0.30, 5, 10),
    MAT.jacket,
    new THREE.Vector3(0, 0.13, 0),
    new THREE.Vector3(1.0, 1.0, 0.78)
  );

  fittedPart(
    root,
    "Spine2",
    new THREE.CapsuleGeometry(0.205, 0.12, 4, 10),
    MAT.jacket,
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Vector3(1.08, 0.85, 0.82)
  );

  // Пояс.
  fittedPart(
    root,
    "Hips",
    new THREE.TorusGeometry(0.19, 0.025, 6, 24),
    MAT.leather,
    new THREE.Vector3(0, 0.035, 0),
    new THREE.Vector3(1.15, 1, 0.82)
  );

  // Пряжка.
  fittedPart(
    root,
    "Hips",
    new THREE.BoxGeometry(0.075, 0.065, 0.035),
    MAT.metal,
    new THREE.Vector3(0, 0.035, 0.19),
    new THREE.Vector3(1, 1, 1)
  );

  // Рукава.
  segment(root, "LeftArm", "LeftForeArm", 0.075, MAT.jacket);
  segment(root, "RightArm", "RightForeArm", 0.075, MAT.jacket);
  segment(root, "LeftForeArm", "LeftHand", 0.065, MAT.leather);
  segment(root, "RightForeArm", "RightHand", 0.065, MAT.leather);

  // Штаны.
  segment(root, "LeftUpLeg", "LeftLeg", 0.105, MAT.pants);
  segment(root, "RightUpLeg", "RightLeg", 0.105, MAT.pants);
  segment(root, "LeftLeg", "LeftFoot", 0.075, MAT.pants);
  segment(root, "RightLeg", "RightFoot", 0.075, MAT.pants);

  // Высокие ботинки.
  fittedPart(
    root, "LeftFoot",
    new THREE.BoxGeometry(0.14, 0.12, 0.25),
    MAT.leather,
    new THREE.Vector3(0, -0.015, 0.07),
    new THREE.Vector3(1, 1, 1)
  );

  fittedPart(
    root, "RightFoot",
    new THREE.BoxGeometry(0.14, 0.12, 0.25),
    MAT.leather,
    new THREE.Vector3(0, -0.015, 0.07),
    new THREE.Vector3(1, 1, 1)
  );

  root.updateMatrixWorld(true);
  return true;
}
