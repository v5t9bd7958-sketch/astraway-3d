// src/character/XbotOutfit.js
// AstraWay — soft pajama outfit (dusty mauve, loose fit, silhouette slippers)
import * as THREE from "three";

const TAG = "AstraWay_Pajama_";

// Палитра с фото: пыльно-лиловая / mauve fluffy
const MAT = {
  pj: new THREE.MeshStandardMaterial({
    color: 0xb08a96,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }),
  pjLight: new THREE.MeshStandardMaterial({
    color: 0xc4a0ab,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }),
  pjDark: new THREE.MeshStandardMaterial({
    color: 0x8f6e79,
    roughness: 0.94,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }),
  cuff: new THREE.MeshStandardMaterial({
    color: 0x9a7883,
    roughness: 0.88,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }),
  embroidery: new THREE.MeshStandardMaterial({
    color: 0xf2e6ea,
    roughness: 0.75,
    metalness: 0.05,
    side: THREE.DoubleSide,
  }),
  slipper: new THREE.MeshStandardMaterial({
    color: 0xc9b4bc,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }),
  sole: new THREE.MeshStandardMaterial({
    color: 0x6e5a62,
    roughness: 0.95,
    metalness: 0.0,
  }),
  hair: new THREE.MeshStandardMaterial({
    color: 0x3a2a24,
    roughness: 0.95,
  }),
  skin: new THREE.MeshStandardMaterial({
    color: 0xc49a7a,
    roughness: 0.88,
  }),
  eyes: new THREE.MeshStandardMaterial({
    color: 0x1a1412,
    roughness: 0.45,
  }),
};

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_FORWARD = new THREE.Vector3(0, 0, -1);

// Свободная пижама: заметно снаружи скина, без «перекраски торса».
const LOOSE = 1.32;

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
    if (o.name && (o.name.startsWith(TAG) || o.name.startsWith("AstraWay_Ranger_"))) {
      old.push(o);
    }
  });
  for (const o of old) {
    o.parent?.remove(o);
    if (o.geometry) o.geometry.dispose();
  }
}

function addEllipsoid(root, parentBone, worldCenter, scale, material, name) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), material);
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

/**
 * Объём одежды вдоль сегмента кости.
 * radiusFrac — доля длины сегмента; LOOSE выводит силуэт наружу.
 */
function addSleeve(
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

  const a = worldPos(boneA);
  const b = worldPos(boneB);
  const dir = b.clone().sub(a);
  const length = dir.length();
  if (!Number.isFinite(length) || length < 0.012) return false;

  const mid = a.clone().add(b).multiplyScalar(0.5);
  const wq = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  const rq = root.getWorldQuaternion(new THREE.Quaternion());
  const lq = rq.clone().invert().multiply(wq);

  const rx = Math.max(length * radiusFracX, 0.018) * LOOSE;
  const rz = Math.max(length * radiusFracZ, 0.018) * LOOSE;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), material);
  mesh.name = TAG + name;
  mesh.position.copy(root.worldToLocal(mid));
  mesh.quaternion.copy(lq);
  // Чуть короче сегмента по оси, чтобы не «лезло» в суставы артефактами.
  mesh.scale.set(rx, length * 0.48 + rx * 0.2, rz);
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
    throw new Error("Pajama: invalid model root");
  }

  root.updateMatrixWorld(true);
  removeOldOutfit(root);

  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) throw new Error("Pajama: empty bounds");

  const size = bounds.getSize(new THREE.Vector3());
  const height = size.y;
  if (!Number.isFinite(height) || height < 0.1) {
    throw new Error("Pajama: invalid height");
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
  // ВЕРХ ПИЖАМЫ — свободный свитшот (несколько слоёв = объём, не «краска»)
  // =========================================================

  // Основной торс: Hips → Spine2, широкий
  if (B.hips && B.spine2) {
    addSleeve(root, B.hips, B.spine2, 0.5, 0.4, MAT.pj, "TopCore");
  } else if (B.hips && B.spine) {
    addSleeve(root, B.hips, B.spine, 0.52, 0.42, MAT.pj, "TopCore");
  }

  // Грудь / верх свитшота чуть объёмнее
  if (B.spine1 && B.spine2) {
    addSleeve(root, B.spine1, B.spine2, 0.48, 0.4, MAT.pjLight, "TopChest");
  }

  // Низ свитшота (лёгкий напуск над бёдрами)
  if (B.hips && B.spine) {
    const hipsP = worldPos(B.hips);
    const hemR = Math.max(torsoLen * 0.38, shoulderSpan * 0.32) * LOOSE;
    addEllipsoid(
      root,
      B.hips,
      hipsP.clone().add(new THREE.Vector3(0, torsoLen * 0.08, 0)),
      new THREE.Vector3(hemR * 1.05, torsoLen * 0.12 * LOOSE, hemR * 0.85),
      MAT.pjDark,
      "TopHem"
    );
  }

  // Горловина
  if (B.neck) {
    const np = worldPos(B.neck);
    const nr = Math.max(shoulderSpan * 0.18, height * 0.035) * LOOSE;
    addEllipsoid(
      root,
      B.neck,
      np,
      new THREE.Vector3(nr * 1.05, height * 0.028 * LOOSE, nr * 0.95),
      MAT.cuff,
      "Neckline"
    );
  }

  // Намёк на вышивку на груди (светлое пятно)
  if (B.spine2) {
    const chest = worldPos(B.spine2).add(
      forward.clone().multiplyScalar(Math.max(torsoLen * 0.22, 0.04) * LOOSE)
    );
    const e = Math.max(torsoLen * 0.1, height * 0.025) * LOOSE;
    addEllipsoid(
      root,
      B.spine2,
      chest,
      new THREE.Vector3(e * 1.4, e * 0.55, e * 0.35),
      MAT.embroidery,
      "Embroidery"
    );
  }

  // =========================================================
  // РУКАВА — длинные, свободные + манжеты
  // =========================================================

  for (const side of ["left", "right"]) {
    const shoulder = B[`${side}Shoulder`];
    const arm = B[`${side}Arm`];
    const forearm = B[`${side}ForeArm`];
    const hand = B[`${side}Hand`];

    if (shoulder && arm) {
      addSleeve(root, shoulder, arm, 0.3, 0.28, MAT.pj, `${side}SleeveUpper`);
      // Плечевой объём свитшота
      const sp = worldPos(shoulder);
      const g = Math.max(boneLen(shoulder, arm) * 0.32, height * 0.032) * LOOSE;
      addEllipsoid(
        root,
        shoulder,
        sp,
        new THREE.Vector3(g * 1.15, g, g * 1.1),
        MAT.pjLight,
        `${side}ShoulderVolume`
      );
    }

    if (arm && forearm) {
      addSleeve(root, arm, forearm, 0.28, 0.26, MAT.pj, `${side}SleeveFore`);
    }

    // Манжета у запястья (не перчатка)
    if (forearm && hand) {
      addSleeve(root, forearm, hand, 0.22, 0.2, MAT.cuff, `${side}Cuff`);
    }
  }

  // =========================================================
  // ШТАНЫ — свободные, с лёгким заужением к щиколотке
  // =========================================================

  for (const side of ["left", "right"]) {
    const thigh = B[`${side}UpLeg`];
    const shin = B[`${side}Leg`];
    const foot = B[`${side}Foot`];

    if (thigh && shin) {
      addSleeve(root, thigh, shin, 0.28, 0.26, MAT.pj, `${side}PantThigh`);
    }

    if (shin && foot) {
      addSleeve(root, shin, foot, 0.24, 0.22, MAT.pjDark, `${side}PantShin`);
      // Манжета штанины
      addSleeve(root, shin, foot, 0.2, 0.18, MAT.cuff, `${side}PantCuff`);
    }
  }

  // Пояс / резинка (тонкая, не «кожаный ремень»)
  if (B.hips) {
    const hp = worldPos(B.hips);
    const bx = Math.max(torsoLen * 0.4, shoulderSpan * 0.3) * LOOSE;
    const bz = Math.max(torsoLen * 0.32, shoulderSpan * 0.22) * LOOSE;
    addEllipsoid(
      root,
      B.hips,
      hp,
      new THREE.Vector3(bx, height * 0.018 * LOOSE, bz),
      MAT.cuff,
      "Waistband"
    );
  }

  // =========================================================
  // СИЛУЭТНЫЕ ТАПОЧКИ (не сапоги)
  // =========================================================

  for (const side of ["left", "right"]) {
    const foot = B[`${side}Foot`];
    const toe = B[`${side}Toe`];
    if (!foot) continue;

    const fp = worldPos(foot);
    const toeP = toe ? worldPos(toe) : fp.clone().add(forward.clone().multiplyScalar(height * 0.04));
    const footLen = Math.max(fp.distanceTo(toeP), height * 0.045);

    // Мягкий верх тапочка
    const slipCenter = fp
      .clone()
      .add(forward.clone().multiplyScalar(footLen * 0.35))
      .add(new THREE.Vector3(0, -height * 0.008, 0));

    addEllipsoid(
      root,
      foot,
      slipCenter,
      new THREE.Vector3(
        footLen * 0.42 * LOOSE,
        height * 0.022 * LOOSE,
        footLen * 0.7 * LOOSE
      ),
      MAT.slipper,
      `${side}Slipper`
    );

    // Тонкая подошва
    const soleCenter = slipCenter.clone().add(new THREE.Vector3(0, -height * 0.016, 0));
    addEllipsoid(
      root,
      foot,
      soleCenter,
      new THREE.Vector3(
        footLen * 0.44 * LOOSE,
        height * 0.008,
        footLen * 0.72 * LOOSE
      ),
      MAT.sole,
      `${side}Sole`
    );
  }

  // =========================================================
  // ВОЛОСЫ / ЛИЦО (лёгкий силуэт, без «маски»)
  // =========================================================

  if (B.head) {
    const hp = worldPos(B.head);
    const neckHead = boneLen(B.neck, B.head) || height * 0.08;
    const hr = Math.max(neckHead * 0.9, height * 0.055) * 1.12;

    addEllipsoid(
      root,
      B.head,
      hp.clone().add(new THREE.Vector3(0, hr * 0.4, 0)),
      new THREE.Vector3(hr * 1.0, hr * 0.65, hr * 1.05),
      MAT.hair,
      "Hair"
    );

    const face = hp.clone().add(forward.clone().multiplyScalar(hr * 0.65));
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();

    for (const s of [-1, 1]) {
      addEllipsoid(
        root,
        B.head,
        face
          .clone()
          .add(right.clone().multiplyScalar(s * hr * 0.28))
          .add(new THREE.Vector3(0, hr * 0.08, 0)),
        new THREE.Vector3(hr * 0.11, hr * 0.08, hr * 0.07),
        MAT.eyes,
        "Eye"
      );
    }

    addEllipsoid(
      root,
      B.head,
      face.clone().add(forward.clone().multiplyScalar(hr * 0.08)),
      new THREE.Vector3(hr * 0.12, hr * 0.14, hr * 0.12),
      MAT.skin,
      "Nose"
    );
  }

  root.updateMatrixWorld(true);

  let outfitParts = 0;
  root.traverse((o) => {
    if (o.name && o.name.startsWith(TAG)) outfitParts++;
  });

  console.log("[AstraWay] Pajama outfit created", {
    height,
    torsoLen,
    shoulderSpan,
    bonesFound: Object.values(B).filter(Boolean).length,
    outfitParts,
    loose: LOOSE,
  });

  return true;
}