import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

export function cloneProductionCharacter(proxyRoot, scene) {
  if (!proxyRoot?.isObject3D) {
    throw new TypeError("Proxy root must be Object3D");
  }

  if (!scene?.isObject3D) {
    throw new TypeError("Scene must be Object3D");
  }

  const visibleRoot = cloneSkeleton(proxyRoot);

  visibleRoot.name = "AstraWay_ProductionCharacter";
  visibleRoot.visible = true;

  let visibleSkinnedMesh = null;

  visibleRoot.traverse((object) => {
    if (object.isSkinnedMesh && !visibleSkinnedMesh) {
      visibleSkinnedMesh = object;
    }
  });

  if (!visibleSkinnedMesh?.skeleton?.bones?.length) {
    throw new Error(
      "Production clone: independent SkinnedMesh skeleton missing"
    );
  }

  const proxyBones = new Set();

  proxyRoot.traverse((object) => {
    if (object.isBone) proxyBones.add(object);
  });

  let sharedBone = false;

  visibleRoot.traverse((object) => {
    if (object.isBone && proxyBones.has(object)) {
      sharedBone = true;
    }
  });

  if (sharedBone) {
    throw new Error(
      "Production clone shares Bone objects with donor proxy"
    );
  }

  scene.add(visibleRoot);

  console.log("[AstraWay] INDEPENDENT CHARACTER CLONED", {
    proxy: proxyRoot.name,
    visible: visibleRoot.name,
    bones: visibleSkinnedMesh.skeleton.bones.length,
    independentSkeleton: true,
  });

  return {
    visibleRoot,
    visibleSkinnedMesh,
  };
}
