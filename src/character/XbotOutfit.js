// src/character/XbotOutfit.js
// AstraWay — feminine black latex catsuit + hair / face
import * as THREE from "three";

const TAG = "AstraWay_Latex_";

const MAT = {
  latex: new THREE.MeshStandardMaterial({
    color: 0x0a0a0c,
    roughness: 0.18,
    metalness: 0.55,
    side: THREE.DoubleSide,
  }),
  latexSoft: new THREE.MeshStandardMaterial({
    color: 0x121216,
    roughness: 0.22,
    metalness: 0.45,
    side: THREE.DoubleSide,
  }),
  latexDeep: new THREE.MeshStandardMaterial({
    color: 0x050507,
    roughness: 0.15,
    metalness: 0.6,
    side: THREE.DoubleSide,
  }),
  gloss: new THREE.MeshStandardMaterial({
    color: 0x1a1a22,
    roughness: 0.1,
    metalness: 0.7,
    side: THREE.DoubleSide,
  }),
  hair: new THREE.MeshStandardMaterial({
    color: 0x1c1210,
    roughness: 0.72,
    metalness: 0.05,
    side: THREE.DoubleSide,
  }),
  hairShine: new THREE.MeshStandardMaterial({
    color: 0x2a1c18,
    roughness: 0.45,
    metalness: 0.12,
    side: THREE.DoubleSide,
  }),
  skin: new THREE.MeshStandardMaterial({
    color: 0xd4a88c,
    roughness: 0.78,
    metalness: 0.0,
  }),
  skinSoft: new THREE.MeshStandardMaterial({
    color: 0xe0b59a,
    roughness: 0.82,
    metalness: 0.0,
  }),
  lip: new THREE.MeshStandardMaterial({
    color: 0xb85a6a,
    roughness: 0.4,
    metalness: 0.08,
  }),
  eyeWhite: new THREE.MeshStandardMaterial({
    color: 0xf2ebe6,
    roughness: 0.55,
  }),
  iris: new THREE.MeshStandardMaterial({
    color: 0x3a4a5c,
    roughness: 0.35,
    metalness: 0.1,
  }),
  pupil: new THREE.MeshStandardMaterial({
    color: 0x0c0a0a,
    roughness: 0.3,
  }),
  brow: new THREE.MeshStandardMaterial({
    color: 0x2a1e1a,
    roughness: 0.85,
  }),
};

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_FORWARD = new THREE.Vector3(0, 0, -1);

// Обтяжка: чуть снаружи скина, без «мешка».
const FIT = 1.12;
// Женственный акцент бёдер / груди.
const FEM_BUST = 1.18;
const FEM_HIP = 1.22;
const FEM_WAIST = 0.92;

function findBone(root, name) {
  let result = null;
  root.traverse((o) => {
    if (o.isBone && o.name === name) result = o;
  });
  return result;
}

function worldPos(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

function boneLen(a, b) {
  if (!a || !b) return 0;
  const d = worldPos(a).distanceTo(worldPos(b));
  return Number.isFinite(d) ? d : 0;
}

function removeOldOutfit(root) {
  const old = [];
  root.traverse((o) => {
    if (
      o.name &&
      (o.name.startsWith(TAG) ||
        o.name.startsWith("AstraWay_Ranger_") ||
        o.name.startsWith("AstraWay_Pajama_"))
    ) {
      old.push(o);
    }
  });
  for (const o of old) {
    o.parent?.remove(o);
    if (o.geometry) o.geometry.dispose();
  }
}

function addEllipsoid(root, parentBone, worldCenter, scale, material, name) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), material);
  mesh.name = TAG + name;
  mesh.position.copy(root.worldToLocal(worldCenter.clone()));
  mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;

  root.add(mesh);
  root.updateMatrixWorld(true);
  if (parentBone) parentBone.attach(mesh);
  return mesh;
}

function addSegment(
  root,
  boneA,
  boneB,
  radiusFracX,
  radiusFracZ,
  material,
  name,
  scaleMul = 1
) {
  if (!boneA || !boneB) return false;

  root.updateMatrixWorld(true);

  const a = worldPos(boneA);
  const b = worldPos(boneB);
  const dir = b.clone().sub(a);
  const length = dir.length();
  if (!Number.isFinite(length) || length < 0.012) return false;

  const mid = a.clone().add(b).multiplyScalar(0.5);
  const wq = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  const rq = root.getWorldQuaternion(new THREE.Quaternion());
  const lq = rq.clone().invert().multiply(wq);

  const rx = Math.max(length * radiusFracX, 0.016) * FIT * scaleMul;
  const rz = Math.max(length * radiusFracZ, 0.016) * FIT * scaleMul;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), material);
  mesh.name = TAG + name;
  mesh.position.copy(root.worldToLocal(mid));
  mesh.quaternion.copy(lq);
  mesh.scale.set(rx, length * 0.48 + rx * 0.18, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;

  root.add(mesh);
  root.updateMatrixWorld(true);
  boneA.attach(mesh);
  return true;
}

export function attachXbotOutfit(root) {
  if (!root?.isObject3D) {
    throw new Error("Latex: invalid model root");
  }

  root.updateMatrixWorld(true);
  removeOldOutfit(root);

  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) throw new Error("Latex: empty bounds");

  const size = bounds.getSize(new THREE.Vector3());
  const height = size.y;
  if (!Number.isFinite(height) || height < 0.1) {
    throw new Error("Latex: invalid height");
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
    leftToe: findBone(root, "LeftToeBase"),

    rightUpLeg: findBone(root, "RightUpLeg"),
    rightLeg: findBone(root, "RightLeg"),
    rightFoot: findBone(root, "RightFoot"),
    rightToe: findBone(root, "RightToeBase"),
  };

  root.updateMatrixWorld(true);

  let forward = DEFAULT_FORWARD.clone();
  if (B.leftToe && B.rightToe && B.leftFoot && B.rightFoot) {
    const l = worldPos(B.leftToe).sub(worldPos(B.leftFoot));
    const r = worldPos(B.rightToe).sub(worldPos(B.rightFoot));
    forward.copy(l.add(r)).setY(0);
    if (forward.lengthSq() > 1e-4) forward.normalize();
    else forward.copy(DEFAULT_FORWARD);
  }

  const torsoLen =
    boneLen(B.hips, B.spine2) || boneLen(B.hips, B.spine) || height * 0.28;
  const shoulderSpan =
    boneLen(B.leftShoulder, B.rightShoulder) || height * 0.22;

  // =========================================================
  // BODYSUIT TORSO — обтяжка + женственный объём
  // =========================================================

  // Талия (уже)
  if (B.hips && B.spine) {
    addSegment(
      root,
      B.hips,
      B.spine,
      0.36 * FEM_WAIST,
      0.3 * FEM_WAIST,
      MAT.latexDeep,
      "Waist",
      1
    );
  }

  // Торс
  if (B.spine && B.spine2) {
    addSegment(
      root,
      B.spine,
      B.spine2,
      0.4,
      0.34,
      MAT.latex,
      "Torso",
      1
    );
  } else if (B.hips && B.spine2) {
    addSegment(root, B.hips, B.spine2, 0.4, 0.34, MAT.latex, "Torso", 1);
  }

  // Бюст (лёгкий объём вперёд)
  if (B.spine2) {
    const chest = worldPos(B.spine2).add(
      forward.clone().multiplyScalar(torsoLen * 0.12 * FEM_BUST)
    );
    const br = Math.max(torsoLen * 0.16, height * 0.04) * FIT * FEM_BUST;
    addEllipsoid(
      root,
      B.spine2,
      chest,
      new THREE.Vector3(br * 1.35, br * 0.85, br * 0.7),
      MAT.latexSoft,
      "Bust"
    );
  }

  // Бёдра
  if (B.hips) {
    const hp = worldPos(B.hips);
    const hr = Math.max(torsoLen * 0.34, shoulderSpan * 0.28) * FIT * FEM_HIP;
    addEllipsoid(
      root,
      B.hips,
      hp,
      new THREE.Vector3(hr, torsoLen * 0.14 * FIT, hr * 0.82),
      MAT.latex,
      "Hips"
    );
  }

  // Ворот / шея
  if (B.neck) {
    const np = worldPos(B.neck);
    const nr = Math.max(shoulderSpan * 0.12, height * 0.028) * FIT;
    addEllipsoid(
      root,
      B.neck,
      np,
      new THREE.Vector3(nr, height * 0.03 * FIT, nr * 0.9),
      MAT.gloss,
      "Collar"
    );
  }

  // =========================================================
  // РУКАВА — обтягивающие
  // =========================================================

  for (const side of ["left", "right"]) {
    const shoulder = B[`${side}Shoulder`];
    const arm = B[`${side}Arm`];
    const forearm = B[`${side}ForeArm`];
    const hand = B[`${side}Hand`];

    if (shoulder && arm) {
      addSegment(root, shoulder, arm, 0.2, 0.18, MAT.latex, `${side}UpperArm`);
      const sp = worldPos(shoulder);
      const g = Math.max(boneLen(shoulder, arm) * 0.22, height * 0.025) * FIT;
      addEllipsoid(
        root,
        shoulder,
        sp,
        new THREE.Vector3(g, g * 0.9, g),
        MAT.latexSoft,
        `${side}Shoulder`
      );
    }

    if (arm && forearm) {
      addSegment(root, arm, forearm, 0.18, 0.16, MAT.latex, `${side}ForeArm`);
    }

    if (forearm && hand) {
      addSegment(root, forearm, hand, 0.15, 0.14, MAT.gloss, `${side}Glove`);
    }
  }

  // =========================================================
  // НОГИ — обтяжка + силуэтные туфли
  // =========================================================

  for (const side of ["left", "right"]) {
    const thigh = B[`${side}UpLeg`];
    const shin = B[`${side}Leg`];
    const foot = B[`${side}Foot`];
    const toe = B[`${side}Toe`];

    if (thigh && shin) {
      addSegment(
        root,
        thigh,
        shin,
        0.22 * FEM_HIP,
        0.2 * FEM_HIP,
        MAT.latex,
        `${side}Thigh`
      );
    }

    if (shin && foot) {
      addSegment(root, shin, foot, 0.16, 0.15, MAT.latexDeep, `${side}Shin`);
    }

    if (foot) {
      const fp = worldPos(foot);
      const toeP = toe
        ? worldPos(toe)
        : fp.clone().add(forward.clone().multiplyScalar(height * 0.04));
      const footLen = Math.max(fp.distanceTo(toeP), height * 0.04);

      const shoe = fp
        .clone()
        .add(forward.clone().multiplyScalar(footLen * 0.4))
        .add(new THREE.Vector3(0, -height * 0.006, 0));

      addEllipsoid(
        root,
        foot,
        shoe,
        new THREE.Vector3(
          footLen * 0.38 * FIT,
          height * 0.018 * FIT,
          footLen * 0.72 * FIT
        ),
        MAT.gloss,
        `${side}Shoe`
      );

      const sole = shoe.clone().add(new THREE.Vector3(0, -height * 0.012, 0));
      addEllipsoid(
        root,
        foot,
        sole,
        new THREE.Vector3(footLen * 0.4 * FIT, height * 0.007, footLen * 0.74 * FIT),
        MAT.latexDeep,
        `${side}Sole`
      );
    }
  }

  // =========================================================
  // ВОЛОСЫ — женственный объём
  // =========================================================

  if (B.head) {
    const hp = worldPos(B.head);
    const neckHead = boneLen(B.neck, B.head) || height * 0.08;
    const hr = Math.max(neckHead * 0.95, height * 0.058);

    // Макушка
    addEllipsoid(
      root,
      B.head,
      hp.clone().add(new THREE.Vector3(0, hr * 0.55, 0)),
      new THREE.Vector3(hr * 1.05, hr * 0.7, hr * 1.1),
      MAT.hair,
      "HairTop"
    );

    // Боковые волны
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
    for (const s of [-1, 1]) {
      addEllipsoid(
        root,
        B.head,
        hp
          .clone()
          .add(right.clone().multiplyScalar(s * hr * 0.75))
          .add(new THREE.Vector3(0, hr * 0.05, 0))
          .add(forward.clone().multiplyScalar(-hr * 0.15)),
        new THREE.Vector3(hr * 0.45, hr * 0.9, hr * 0.5),
        MAT.hair,
        s < 0 ? "HairL" : "HairR"
      );
    }

    // Длина сзади
    addEllipsoid(
      root,
      B.head,
      hp
        .clone()
        .add(forward.clone().multiplyScalar(-hr * 0.55))
        .add(new THREE.Vector3(0, -hr * 0.35, 0)),
      new THREE.Vector3(hr * 0.7, hr * 1.15, hr * 0.55),
      MAT.hairShine,
      "HairBack"
    );

    // =========================================================
    // ЛИЦО — женственные черты
    // =========================================================

    const face = hp.clone().add(forward.clone().multiplyScalar(hr * 0.72));

    // Овал лица (лёгкий)
    addEllipsoid(
      root,
      B.head,
      face.clone().add(new THREE.Vector3(0, -hr * 0.05, 0)),
      new THREE.Vector3(hr * 0.55, hr * 0.65, hr * 0.28),
      MAT.skinSoft,
      "Face"
    );

    // Глаза
    for (const s of [-1, 1]) {
      const eyeC = face
        .clone()
        .add(right.clone().multiplyScalar(s * hr * 0.28))
        .add(new THREE.Vector3(0, hr * 0.12, 0));

      addEllipsoid(
        root,
        B.head,
        eyeC,
        new THREE.Vector3(hr * 0.14, hr * 0.09, hr * 0.06),
        MAT.eyeWhite,
        s < 0 ? "EyeWL" : "EyeWR"
      );
      addEllipsoid(
        root,
        B.head,
        eyeC.clone().add(forward.clone().multiplyScalar(hr * 0.02)),
        new THREE.Vector3(hr * 0.08, hr * 0.08, hr * 0.05),
        MAT.iris,
        s < 0 ? "IrisL" : "IrisR"
      );
      addEllipsoid(
        root,
        B.head,
        eyeC.clone().add(forward.clone().multiplyScalar(hr * 0.035)),
        new THREE.Vector3(hr * 0.035, hr * 0.035, hr * 0.03),
        MAT.pupil,
        s < 0 ? "PupilL" : "PupilR"
      );

      // Бровь
      addEllipsoid(
        root,
        B.head,
        eyeC.clone().add(new THREE.Vector3(0, hr * 0.12, 0)),
        new THREE.Vector3(hr * 0.12, hr * 0.025, hr * 0.03),
        MAT.brow,
        s < 0 ? "BrowL" : "BrowR"
      );
    }

    // Нос
    addEllipsoid(
      root,
      B.head,
      face.clone().add(forward.clone().multiplyScalar(hr * 0.1)),
      new THREE.Vector3(hr * 0.09, hr * 0.14, hr * 0.1),
      MAT.skin,
      "Nose"
    );

    // Губы
    addEllipsoid(
      root,
      B.head,
      face
        .clone()
        .add(new THREE.Vector3(0, -hr * 0.28, 0))
        .add(forward.clone().multiplyScalar(hr * 0.08)),
      new THREE.Vector3(hr * 0.16, hr * 0.05, hr * 0.06),
      MAT.lip,
      "Lips"
    );
  }

  root.updateMatrixWorld(true);

  let outfitParts = 0;
  root.traverse((o) => {
    if (o.name && o.name.startsWith(TAG)) outfitParts++;
  });

  console.log("[AstraWay] Latex outfit created", {
    height,
    torsoLen,
    shoulderSpan,
    bonesFound: Object.values(B).filter(Boolean).length,
    outfitParts,
    fit: FIT,
  });

  return true;
}