import * as THREE from "three";

import { BodyState } from "./BodyState.js";
import { BodyStateBinder } from "./BodyStateBinder.js";
import { SurfaceQuery } from "./SurfaceQuery.js";
import { ContactPerception } from "./ContactPerception.js";

import { TaskSet } from "./TaskSet.js";
import { ContactTaskGenerator } from "./ContactTaskGenerator.js";
import { LocomotionTaskGenerator } from "./LocomotionTaskGenerator.js";
import { TaskResolver } from "./TaskResolver.js";

import { ConstraintSet } from "./ConstraintSet.js";
import { TaskConstraintBuilder } from "./TaskConstraintBuilder.js";
import { ConstraintSolver } from "./ConstraintSolver.js";
import { PoseWriter } from "./PoseWriter.js";

import { AstraWayAutonomyBridge } from "./AstraWayAutonomyBridge.js";

function assertObject3D(value, name) {
  if (!value?.isObject3D) {
    throw new TypeError(`${name} must be THREE.Object3D`);
  }
}

function containsObject(root, target) {
  let found = false;

  root.traverse((object) => {
    if (object === target) found = true;
  });

  return found;
}

function assertIndependentSkeletons(proxyRoot, visibleRoot) {
  const proxyBones = new Set();

  proxyRoot.traverse((object) => {
    if (object.isBone) proxyBones.add(object);
  });

  visibleRoot.traverse((object) => {
    if (object.isBone && proxyBones.has(object)) {
      throw new Error(
        "Proxy and visible character share Bone objects. " +
        "Use SkeletonUtils.clone() for the proxy."
      );
    }
  });
}

export function createProductionLocomotionPipeline({
  human,
  autonomyAgent,
  proxyRoot,
  visibleRoot,
  visibleSkinnedMesh,
  groundMeshes,
  solver = {},
  writer = {},
} = {}) {
  assertObject3D(proxyRoot, "proxyRoot");
  assertObject3D(visibleRoot, "visibleRoot");

  if (!human?.locomotion?.feet) {
    throw new TypeError(
      "Production pipeline: invalid procedural human"
    );
  }

  if (autonomyAgent?.human !== human) {
    throw new Error(
      "Production pipeline: AutonomyAgent must own the supplied human"
    );
  }

  if (!visibleSkinnedMesh?.isSkinnedMesh) {
    throw new TypeError(
      "Production pipeline: visibleSkinnedMesh is required"
    );
  }

  if (!visibleSkinnedMesh.skeleton?.bones?.length) {
    throw new Error(
      "Production pipeline: visible skeleton is missing"
    );
  }

  if (!containsObject(visibleRoot, visibleSkinnedMesh)) {
    throw new Error(
      "Production pipeline: SkinnedMesh is outside visibleRoot"
    );
  }

  if (!Array.isArray(groundMeshes) || groundMeshes.length === 0) {
    throw new Error(
      "Production pipeline: groundMeshes must be a non-empty array"
    );
  }

  assertIndependentSkeletons(proxyRoot, visibleRoot);

  const skeleton = visibleSkinnedMesh.skeleton;

  visibleRoot.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(visibleRoot);

  if (bounds.isEmpty() || !Number.isFinite(bounds.min.y)) {
    throw new Error(
      "Production pipeline: invalid visible character bounds"
    );
  }

  const groundY = bounds.min.y;

  // 1. World geometry perception.
  const surfaceQuery = new SurfaceQuery({
    groundY,
    defaultSurfaceId: "ground",
    defaultSurfaceType: "ground",
    meshes: groundMeshes,
  });

  // 2. Visible character contact perception.
  const contactPerception = new ContactPerception({
    root: visibleRoot,
    skeleton,
    skinnedMesh: visibleSkinnedMesh,
    surfaceQuery,
    contactSeparation: 0.035,
    minConfidence: 0.4,
  });

  contactPerception.initialize();

  // 3. Body state and contact lifecycle.
  const bodyState = new BodyState();

  const bodyStateBinder = new BodyStateBinder({
    root: visibleRoot,
    skeleton,
    skinnedMesh: visibleSkinnedMesh,
    bodyState,
    groundY,
    contactDistance: 0.08,
    contactVelocityThreshold: 0.35,
    contactPerception,
  });

  // 4. One shared task set.
  const taskSet = new TaskSet();

  const contactTaskGenerator = new ContactTaskGenerator({
    taskSet,
  });

  const locomotionTaskGenerator = new LocomotionTaskGenerator({
    taskSet,
    weight: 0.65,
  });

  const taskResolver = new TaskResolver();

  // 5. One constraint set and one builder.
  const constraintSet = new ConstraintSet();

  const taskConstraintBuilder = new TaskConstraintBuilder({
    constraintSet,
  });

  // 6. Production solver.
  const constraintSolver = new ConstraintSolver({
    skeleton,
    damping: 0.12,
    maxAngleStep: 0.18,
    positionTolerance: 0.001,
    enabled: true,
    ...solver,
  });

  // 7. The only production bone writer.
  const poseWriter = new PoseWriter({
    skeleton,
    enabled: true,
    maxRotationPerBone: 0.18,
    ...writer,
  });

  // 8. Single frame coordinator.
  const bridge = new AstraWayAutonomyBridge({
    autonomyAgent,
    human,
    proxyRoot,
    visibleRoot,

    bodyState,
    bodyStateBinder,

    contactTaskGenerator,
    locomotionTaskGenerator,

    taskResolver,
    taskConstraintBuilder,
    constraintSolver,
    poseWriter,
  });

  const result = {
    bridge,

    bodyState,
    bodyStateBinder,

    surfaceQuery,
    contactPerception,

    taskSet,
    contactTaskGenerator,
    locomotionTaskGenerator,
    taskResolver,

    constraintSet,
    taskConstraintBuilder,
    constraintSolver,
    poseWriter,

    groundY,
  };

  console.log("[AstraWay] PRODUCTION LOCOMOTION PIPELINE READY", {
    visibleBones: skeleton.bones.length,
    groundY,
    proxyIndependent: true,
    sharedTaskSet: true,
    productionBoneWriter: "PoseWriter",
  });

  return result;
}

export default createProductionLocomotionPipeline;
