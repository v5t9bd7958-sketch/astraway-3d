
import * as THREE from "three";

const PREFIX = "AstraWay_SkinnedOutfit";

const MATERIALS = [
  new THREE.MeshStandardMaterial({
    name: "AstraWay_Jacket",
    color: 0x245d91,
    roughness: 0.84,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
  new THREE.MeshStandardMaterial({
    name: "AstraWay_Trousers",
    color: 0x987044,
    roughness: 0.9,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
  new THREE.MeshStandardMaterial({
    name: "AstraWay_Leather",
    color: 0x38271f,
    roughness: 0.86,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
];

const BONE_GROUPS = {
  torso: new Set([
    "Hips",
    "Spine",
    "Spine1",
    "Spine2",
  ]),

  arms: new Set([
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
  ]),

  hands: new Set([
    "LeftHand",
    "RightHand",
    "LeftHandThumb1",
    "LeftHandThumb2",
    "LeftHandThumb3",
    "LeftHandIndex1",
    "LeftHandIndex2",
    "LeftHandIndex3",
    "LeftHandMiddle1",
    "LeftHandMiddle2",
    "LeftHandMiddle3",
    "LeftHandRing1",
    "LeftHandRing2",
    "LeftHandRing3",
    "LeftHandPinky1",
    "LeftHandPinky2",
    "LeftHandPinky3",
    "RightHandThumb1",
    "RightHandThumb2",
    "RightHandThumb3",
    "RightHandIndex1",
    "RightHandIndex2",
    "RightHandIndex3",
    "RightHandMiddle1",
    "RightHandMiddle2",
    "RightHandMiddle3",
    "RightHandRing1",
    "RightHandRing2",
    "RightHandRing3",
    "RightHandPinky1",
    "RightHandPinky2",
    "RightHandPinky3",
  ]),

  legs: new Set([
    "LeftUpLeg",
    "LeftLeg",
    "RightUpLeg",
    "RightLeg",
  ]),

  feet: new Set([
    "LeftFoot",
    "RightFoot",
    "LeftToeBase",
    "RightToeBase",
  ]),
};

function removePreviousOutfit(root) {
  const removals = [];

  root.traverse((object) => {
    if (
      object.isSkinnedMesh &&
      object.name.startsWith(PREFIX)
    ) {
      removals.push(object);
    }
  });

  for (const mesh of removals) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
  }
}

function readInfluence(
  vertexIndex,
  skinIndex,
  skinWeight,
  bones
) {
  const result = {
    torso: 0,
    arms: 0,
    hands: 0,
    legs: 0,
    feet: 0,
  };

  for (let slot = 0; slot < 4; slot++) {
    const boneIndex = skinIndex.getComponent(
      vertexIndex,
      slot
    );

    const weight = skinWeight.getComponent(
      vertexIndex,
      slot
    );

    if (weight <= 0) continue;

    const bone = bones[boneIndex];
    if (!bone) continue;

    const name = bone.name;

    if (BONE_GROUPS.torso.has(name)) {
      result.torso += weight;
    } else if (BONE_GROUPS.hands.has(name)) {
      result.hands += weight;
    } else if (BONE_GROUPS.arms.has(name)) {
      result.arms += weight;
    } else if (BONE_GROUPS.feet.has(name)) {
      result.feet += weight;
    } else if (BONE_GROUPS.legs.has(name)) {
      result.legs += weight;
    }
  }

  return result;
}

function classifyTriangle(a, b, c) {
  const torso = a.torso + b.torso + c.torso;
  const arms = a.arms + b.arms + c.arms;
  const hands = a.hands + b.hands + c.hands;
  const legs = a.legs + b.legs + c.legs;
  const feet = a.feet + b.feet + c.feet;

  const upperBody = torso + arms + hands;
  const lowerBody = legs + feet;

  if (upperBody > lowerBody && upperBody > 0.12) {
    if (hands > arms * 0.55) return 2;
    return 0;
  }

  if (lowerBody > upperBody && lowerBody > 0.12) {
    if (feet > legs * 0.45) return 2;
    return 1;
  }

  return -1;
}

function createOutfitGeometry(source, skeleton) {
  const original = source.geometry;

  const skinIndex = original.getAttribute("skinIndex");
  const skinWeight = original.getAttribute("skinWeight");

  if (!skinIndex || !skinWeight) {
    return null;
  }

  const geometry = original.index
    ? original.toNonIndexed()
    : original.clone();

  if (!geometry.getAttribute("normal")) {
    geometry.computeVertexNormals();
  }

  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const indices = geometry.getAttribute("skinIndex");
  const weights = geometry.getAttribute("skinWeight");

  if (!position || !normal) {
    if (geometry !== original) geometry.dispose();
    return null;
  }

  geometry.computeBoundingBox();

  const bounds = geometry.boundingBox;
  const height = bounds
    ? bounds.max.y - bounds.min.y
    : 1;

  const offset = Math.max(height * 0.004, 0.001);

  const buckets = [[], [], []];

  const vertexCount = position.count;

  let classifiedTriangles = 0;

  for (let i = 0; i + 2 < vertexCount; i += 3) {
    const influences = [
      readInfluence(i, indices, weights, skeleton.bones),
      readInfluence(i + 1, indices, weights, skeleton.bones),
      readInfluence(i + 2, indices, weights, skeleton.bones),
    ];

    const materialIndex = classifyTriangle(
      influences[0],
      influences[1],
      influences[2]
    );

    if (materialIndex < 0) continue;

    classifiedTriangles++;

    const bucket = buckets[materialIndex];

    for (let vertex = 0; vertex < 3; vertex++) {
      const index = i + vertex;

      const p = new THREE.Vector3(
        position.getX(index),
        position.getY(index),
        position.getZ(index)
      );

      const n = new THREE.Vector3(
        normal.getX(index),
        normal.getY(index),
        normal.getZ(index)
      ).normalize();

      p.addScaledVector(n, offset);

      bucket.push(
        p.x, p.y, p.z,
        n.x, n.y, n.z,

        indices.getX(index),
        indices.getY(index),
        indices.getZ(index),
        indices.getW(index),

        weights.getX(index),
        weights.getY(index),
        weights.getZ(index),
        weights.getW(index)
      );
    }
  }

  if (geometry !== original) {
    geometry.dispose();
  }

  if (!classifiedTriangles) return null;

  const output = new THREE.BufferGeometry();

  const positions = [];
  const normals = [];
  const skinIndices = [];
  const skinWeights = [];

  let offsetVertex = 0;

  for (let materialIndex = 0; materialIndex < 3; materialIndex++) {
    const bucket = buckets[materialIndex];

    if (!bucket.length) continue;

    const start = offsetVertex;
    const vertexTotal = bucket.length / 13;

    for (let i = 0; i < bucket.length; i += 13) {
      positions.push(
        bucket[i],
        bucket[i + 1],
        bucket[i + 2]
      );

      normals.push(
        bucket[i + 3],
        bucket[i + 4],
        bucket[i + 5]
      );

      skinIndices.push(
        bucket[i + 6],
        bucket[i + 7],
        bucket[i + 8],
        bucket[i + 9]
      );

      skinWeights.push(
        bucket[i + 10],
        bucket[i + 11],
        bucket[i + 12],
        bucket[i + 13]
      );
    }

    output.addGroup(
      start,
      vertexTotal,
      materialIndex
    );

    offsetVertex += vertexTotal;
  }

  output.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );

  output.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(normals, 3)
  );

  output.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(skinIndices, 4)
  );

  output.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4)
  );

  output.computeBoundingBox();
  output.computeBoundingSphere();

  return {
    geometry: output,
    triangles: classifiedTriangles,
  };
}

function createSkinnedOutfit(source, root) {
  const skeleton = source.skeleton;

  if (!skeleton?.bones?.length) {
    return null;
  }

  const result = createOutfitGeometry(source, skeleton);

  if (!result) return null;

  const outfit = new THREE.SkinnedMesh(
    result.geometry,
    MATERIALS
  );

  outfit.name = `${PREFIX}_${source.name || "Body"}`;

  outfit.bindMode = source.bindMode;

  outfit.bind(
    skeleton,
    source.bindMatrix
  );

  outfit.position.copy(source.position);
  outfit.quaternion.copy(source.quaternion);
  outfit.scale.copy(source.scale);

  outfit.matrixAutoUpdate = source.matrixAutoUpdate;

  if (!source.matrixAutoUpdate) {
    outfit.matrix.copy(source.matrix);
  }

  outfit.castShadow = true;
  outfit.receiveShadow = true;
  outfit.frustumCulled = false;
  outfit.renderOrder = source.renderOrder + 1;

  const parent = source.parent || root;
  parent.add(outfit);

  return {
    mesh: outfit,
    triangles: result.triangles,
  };
}

export function attachXbotOutfit(root) {
  if (!root?.isObject3D) {
    throw new Error("XBot outfit: invalid model root");
  }

  root.updateMatrixWorld(true);
  removePreviousOutfit(root);

  const sources = [];

  root.traverse((object) => {
    if (
      object.isSkinnedMesh &&
      !object.name.startsWith(PREFIX)
    ) {
      sources.push(object);
    }
  });

  if (!sources.length) {
    throw new Error(
      "XBot outfit: no source SkinnedMesh found"
    );
  }

  let createdMeshes = 0;
  let classifiedTriangles = 0;
  let skippedMeshes = 0;

  for (const source of sources) {
    const result = createSkinnedOutfit(source, root);

    if (!result) {
      skippedMeshes++;
      continue;
    }

    createdMeshes++;
    classifiedTriangles += result.triangles;
  }

  root.updateMatrixWorld(true);

  console.log("[AstraWay Outfit] SKINNED OUTFIT", {
    sourceMeshes: sources.length,
    createdMeshes,
    skippedMeshes,
    classifiedTriangles,
    method: "geometry + skinIndex + skinWeight",
  });

  if (!createdMeshes || !classifiedTriangles) {
    throw new Error(
      "XBot outfit: no weighted clothing geometry generated"
    );
  }

  return true;
}
