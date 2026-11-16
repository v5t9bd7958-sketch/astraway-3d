
import * as THREE from "three";

/**
 * AstraWay ConstraintSolver
 *
 * Converts world-space positional constraints
 * into bounded world-space bone rotations.
 *
 * HARD constraints are processed before SOFT.
 * SOFT constraints respect their weight.
 *
 * This solver NEVER writes bones.
 * PoseWriter remains the only production bone writer.
 */

export class ConstraintSolver {
  constructor({
    skeleton = null,
    damping = 0.12,
    maxAngleStep = 0.20,
    positionTolerance = 0.005,
    enabled = true,
  } = {}) {
    this.skeleton = skeleton;
    this.damping = Math.max(0.000001, Number(damping) || 0.12);
    this.maxAngleStep = Math.max(0.0001, Number(maxAngleStep) || 0.20);
    this.positionTolerance = Math.max(0, Number(positionTolerance) || 0.005);
    this.enabled = Boolean(enabled);

    this.solveCount = 0;
    this.lastSolveTime = 0;
    this.lastResult = null;
  }

  setSkeleton(skeleton) {
    this.skeleton = skeleton;
    return this;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    return this;
  }

  solve(constraintSet, { skeleton = this.skeleton } = {}) {
    const start = performance.now();
    this.solveCount++;

    if (!this.enabled) {
      return this._finish("disabled", false, [], 0, 0, 0, 0, start);
    }

    if (!skeleton) {
      return this._finish("no-skeleton", false, [], 0, 0, 0, 0, start);
    }

    if (!constraintSet) {
      return this._finish("no-constraints", true, [], 0, 0, 0, 0, start);
    }

    const constraints = this._getOrderedConstraints(constraintSet);

    if (!constraints.length) {
      return this._finish("empty", true, [], 0, 0, 0, 0, start);
    }

    this._updateWorldMatrices(skeleton);

    const deltaPose = new Map();

    let maxError = 0;
    let totalDelta = 0;
    let solvedConstraints = 0;
    let unresolvedConstraints = 0;
    let unsupportedConstraints = 0;
    let activeConstraints = 0;

    for (const constraint of constraints) {
      if (!constraint || constraint.enabled === false) continue;

      if (constraint.type !== "position") {
        unsupportedConstraints++;
        continue;
      }

      activeConstraints++;

      const result = this._solvePositionConstraint(
        constraint,
        skeleton,
        deltaPose
      );

      maxError = Math.max(maxError, result.error);
      totalDelta += result.deltaMagnitude;

      if (result.solved) {
        solvedConstraints++;
      } else {
        unresolvedConstraints++;
      }
    }

    const poseArray = this._mapToPoseArray(deltaPose);

    let status = "solved";

    if (unresolvedConstraints > 0) {
      status = poseArray.length > 0 ? "converging" : "unreachable";
    }

    if (activeConstraints === 0 && unsupportedConstraints > 0) {
      status = "unsupported";
    }

    const solved =
      unresolvedConstraints === 0 &&
      unsupportedConstraints === 0;

    return this._finish(
      status,
      solved,
      poseArray,
      activeConstraints,
      solvedConstraints,
      unsupportedConstraints,
      maxError,
      start,
      totalDelta,
      unresolvedConstraints
    );
  }

  _finish(
    status,
    solved,
    deltaPose,
    constraints,
    solvedConstraints,
    unsupportedConstraints,
    maxError,
    start,
    totalDelta = 0,
    unresolvedConstraints = 0
  ) {
    const result = {
      status,
      solved,
      constraints,
      solvedConstraints,
      unsupportedConstraints,
      unresolvedConstraints,
      deltaPose,
      maxError,
      totalDelta,
      solveTime: performance.now() - start,
    };

    this.lastSolveTime = result.solveTime;
    this.lastResult = result;

    return result;
  }

  _getOrderedConstraints(constraintSet) {
    let constraints = [];

    if (
      typeof constraintSet.getHard === "function" &&
      typeof constraintSet.getSoft === "function"
    ) {
      constraints = [
        ...constraintSet.getHard(),
        ...constraintSet.getSoft(),
      ];
    } else if (typeof constraintSet.getEnabled === "function") {
      constraints = constraintSet.getEnabled();
    }

    return constraints
      .filter(Boolean)
      .slice()
      .sort((a, b) => {
        const hardA = a.hard ? 1 : 0;
        const hardB = b.hard ? 1 : 0;

        if (hardA !== hardB) return hardB - hardA;

        const priorityA = Number.isFinite(a.priority) ? a.priority : 0;
        const priorityB = Number.isFinite(b.priority) ? b.priority : 0;

        if (priorityA !== priorityB) return priorityB - priorityA;

        return String(a.id ?? "").localeCompare(String(b.id ?? ""));
      });
  }

  _solvePositionConstraint(constraint, skeleton, deltaPose) {
    const bone = this._resolveBone(constraint, skeleton);

    if (!bone) {
      return { solved: false, error: Infinity, deltaMagnitude: 0 };
    }

    const target = this._getTargetWorldPosition(constraint);

    if (!target) {
      return { solved: false, error: Infinity, deltaMagnitude: 0 };
    }

    const current = this._getEffectorWorldPosition(constraint, bone);
    const error = new THREE.Vector3().subVectors(target, current);
    const errorLength = error.length();

    if (!Number.isFinite(errorLength)) {
      return { solved: false, error: Infinity, deltaMagnitude: 0 };
    }

    if (errorLength <= this.positionTolerance) {
      return { solved: true, error: errorLength, deltaMagnitude: 0 };
    }

    const chain = this._buildRotationChain(bone);

    if (!chain.length) {
      return { solved: false, error: errorLength, deltaMagnitude: 0 };
    }

    const columns = [];

    for (const joint of chain) {
      const jointPosition = joint.getWorldPosition(new THREE.Vector3());
      const offset = new THREE.Vector3().subVectors(current, jointPosition);
      const axes = this._getWorldRotationAxes(joint);

      for (const axis of axes) {
        columns.push({
          bone: joint,
          axis,
          value: new THREE.Vector3().crossVectors(axis, offset),
        });
      }
    }

    if (!columns.length) {
      return { solved: false, error: errorLength, deltaMagnitude: 0 };
    }

    const lambdaSq = this.damping * this.damping;

    let m00 = lambdaSq;
    let m01 = 0;
    let m02 = 0;
    let m10 = 0;
    let m11 = lambdaSq;
    let m12 = 0;
    let m20 = 0;
    let m21 = 0;
    let m22 = lambdaSq;

    for (const column of columns) {
      const j = column.value;

      m00 += j.x * j.x;
      m01 += j.x * j.y;
      m02 += j.x * j.z;

      m10 += j.y * j.x;
      m11 += j.y * j.y;
      m12 += j.y * j.z;

      m20 += j.z * j.x;
      m21 += j.z * j.y;
      m22 += j.z * j.z;
    }

    const inverse = this._invert3x3(
      m00, m01, m02,
      m10, m11, m12,
      m20, m21, m22
    );

    if (!inverse) {
      return { solved: false, error: errorLength, deltaMagnitude: 0 };
    }

    const y = new THREE.Vector3(
      inverse.m00 * error.x + inverse.m01 * error.y + inverse.m02 * error.z,
      inverse.m10 * error.x + inverse.m11 * error.y + inverse.m12 * error.z,
      inverse.m20 * error.x + inverse.m21 * error.y + inverse.m22 * error.z
    );

    const weight = constraint.hard
      ? 1
      : THREE.MathUtils.clamp(
          Number.isFinite(constraint.weight) ? constraint.weight : 1,
          0,
          1
        );

    if (weight <= 0) {
      return { solved: false, error: errorLength, deltaMagnitude: 0 };
    }

    for (const column of columns) {
      const j = column.value;

      const rawDelta =
        j.x * y.x +
        j.y * y.y +
        j.z * y.z;

      if (!Number.isFinite(rawDelta)) continue;

      const weightedDelta = rawDelta * weight;

      const clamped = THREE.MathUtils.clamp(
        weightedDelta,
        -this.maxAngleStep,
        this.maxAngleStep
      );

      if (Math.abs(clamped) < 1e-10) continue;

      let entry = deltaPose.get(column.bone);

      if (!entry) {
        entry = {
          bone: column.bone,
          rotationWorld: new THREE.Vector3(),
        };

        deltaPose.set(column.bone, entry);
      }

      entry.rotationWorld.addScaledVector(column.axis, clamped);
    }

    return {
      solved: false,
      error: errorLength,
      deltaMagnitude: this._calculateDeltaMagnitude(deltaPose, chain),
    };
  }

  _getEffectorWorldPosition(constraint, bone) {
    const value = constraint.metadata?.effectorPosition;

    if (
      Array.isArray(value) &&
      value.length >= 3 &&
      value.slice(0, 3).every(Number.isFinite)
    ) {
      return new THREE.Vector3(value[0], value[1], value[2]);
    }

    if (
      value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      Number.isFinite(value.z)
    ) {
      return new THREE.Vector3(value.x, value.y, value.z);
    }

    return bone.getWorldPosition(new THREE.Vector3());
  }

  _resolveBone(constraint, skeleton) {
    const metadata = constraint.metadata || {};
    const boneName =
      metadata.bone ||
      constraint.boneName ||
      constraint.bone ||
      null;

    if (!boneName) return null;

    if (typeof skeleton.getBoneByName === "function") {
      const bone = skeleton.getBoneByName(boneName);
      if (bone) return bone;
    }

    if (Array.isArray(skeleton.bones)) {
      return skeleton.bones.find(
        bone => bone && bone.name === boneName
      ) || null;
    }

    return null;
  }

  _buildRotationChain(effector) {
    const chain = [];
    let current = effector;

    while (current) {
      if (current.isBone || current.type === "Bone") {
        chain.push(current);
      }

      current = current.parent;
    }

    return chain;
  }

  _getWorldRotationAxes(bone) {
    const q = bone.getWorldQuaternion(new THREE.Quaternion());

    return [
      new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize(),
      new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize(),
      new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize(),
    ];
  }

  _getTargetWorldPosition(constraint) {
    const target = constraint.target;

    if (target instanceof THREE.Vector3) return target.clone();

    if (Array.isArray(target) && target.length >= 3) {
      const values = target.slice(0, 3).map(Number);

      if (!values.every(Number.isFinite)) return null;

      return new THREE.Vector3(values[0], values[1], values[2]);
    }

    if (
      target &&
      Number.isFinite(target.x) &&
      Number.isFinite(target.y) &&
      Number.isFinite(target.z)
    ) {
      return new THREE.Vector3(target.x, target.y, target.z);
    }

    return null;
  }

  _updateWorldMatrices(skeleton) {
    if (!skeleton.bones?.length) return;

    let root = skeleton.bones[0];

    while (root.parent?.isObject3D) {
      root = root.parent;
    }

    root.updateMatrixWorld(true);
  }

  _mapToPoseArray(deltaPose) {
    const result = [];

    for (const entry of deltaPose.values()) {
      const rotationWorld = entry.rotationWorld;

      if (
        !rotationWorld ||
        !Number.isFinite(rotationWorld.x) ||
        !Number.isFinite(rotationWorld.y) ||
        !Number.isFinite(rotationWorld.z)
      ) {
        continue;
      }

      const magnitude = rotationWorld.length();

      if (magnitude <= 1e-8) continue;

      result.push({
        bone: entry.bone,
        boneName: entry.bone.name,
        rotationWorld: rotationWorld.clone(),
        magnitude,
      });
    }

    return result;
  }

  _calculateDeltaMagnitude(deltaPose, chain) {
    let total = 0;

    for (const bone of chain) {
      const entry = deltaPose.get(bone);
      if (entry) total += entry.rotationWorld.length();
    }

    return total;
  }

  /**
   * Generic 3x3 inverse.
   * Determinant is expanded along row zero.
   */
  _invert3x3(
    m00, m01, m02,
    m10, m11, m12,
    m20, m21, m22
  ) {
    const c00 = m11 * m22 - m12 * m21;
    const c01 = m02 * m21 - m01 * m22;
    const c02 = m01 * m12 - m02 * m11;

    const c10 = m12 * m20 - m10 * m22;
    const c11 = m00 * m22 - m02 * m20;
    const c12 = m02 * m10 - m00 * m12;

    const c20 = m10 * m21 - m11 * m20;
    const c21 = m01 * m20 - m00 * m21;
    const c22 = m00 * m11 - m01 * m10;

    const determinant =
      m00 * c00 +
      m01 * c01 +
      m02 * c02;

    if (
      !Number.isFinite(determinant) ||
      Math.abs(determinant) < 1e-12
    ) {
      return null;
    }

    const invDet = 1 / determinant;

    // Adjugate = transpose of the cofactor matrix.
    return {
      m00: c00 * invDet,
      m01: c10 * invDet,
      m02: c20 * invDet,

      m10: c01 * invDet,
      m11: c11 * invDet,
      m12: c21 * invDet,

      m20: c02 * invDet,
      m21: c12 * invDet,
      m22: c22 * invDet,
    };
  }

  getLastResult() {
    return this.lastResult;
  }

  getStats() {
    return {
      solveCount: this.solveCount,
      lastSolveTime: this.lastSolveTime,
      enabled: this.enabled,
    };
  }
}

export default ConstraintSolver;
