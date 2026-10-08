// src/character/PoseWriter.js

import * as THREE from "three";

/*
 * PoseWriter
 *
 * ЕДИНСТВЕННЫЙ production writer позы.
 *
 * Solver:
 *
 *     ConstraintSet
 *          ↓
 *     ConstraintSolver
 *          ↓
 *     deltaPose
 *          ↓
 *     PoseWriter
 *          ↓
 *     THREE.Bone
 *
 * PoseWriter НЕ:
 * - создаёт Tasks;
 * - меняет BodyState;
 * - меняет ContactState;
 * - вызывает IK;
 * - выбирает gait;
 * - выбирает traversal;
 * - решает constraints.
 *
 * Solver отдаёт:
 *
 *     rotationWorld
 *
 * как axis-angle vector:
 *
 *     направление = мировая ось вращения
 *     длина = угол в радианах
 *
 * PoseWriter переводит это в локальную
 * ориентацию конкретной Bone.
 */

export class PoseWriter {
  constructor({
    skeleton = null,
    enabled = true,
    maxRotationPerBone = 0.18,
  } = {}) {
    this.skeleton = skeleton;

    this.enabled = Boolean(enabled);

    this.maxRotationPerBone = Math.max(
      0.0001,
      Number(maxRotationPerBone) || 0.18
    );

    this.writeCount = 0;

    this.lastResult = null;

    this._worldQuaternion =
      new THREE.Quaternion();

    this._deltaQuaternion =
      new THREE.Quaternion();

    this._nextWorldQuaternion =
      new THREE.Quaternion();

    this._parentWorldQuaternion =
      new THREE.Quaternion();

    this._inverseParentQuaternion =
      new THREE.Quaternion();

    this._axis =
      new THREE.Vector3();
  }

  setSkeleton(skeleton) {
    this.skeleton = skeleton;

    return this;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);

    return this;
  }

  setConfiguration({
    maxRotationPerBone =
      this.maxRotationPerBone,
  } = {}) {
    this.maxRotationPerBone = Math.max(
      0.0001,
      Number(maxRotationPerBone) ||
        this.maxRotationPerBone
    );

    return this;
  }

  /*
   * Apply solver output.
   *
   * IMPORTANT:
   *
   * The solver returns:
   *
   *     result.deltaPose
   *
   * NOT:
   *
   *     result.pose
   *
   * The writer is the only place where
   * bone.quaternion is changed by the
   * production solver pipeline.
   */
  write(solverResult) {
    if (!this.enabled) {
      return this._finish({
        applied: 0,
        skipped: true,
        reason: "disabled",
      });
    }

    if (!this.skeleton) {
      return this._finish({
        applied: 0,
        skipped: true,
        reason: "skeleton-missing",
      });
    }

    const deltaPose =
      solverResult?.deltaPose;

    if (
      !Array.isArray(deltaPose) ||
      deltaPose.length === 0
    ) {
      return this._finish({
        applied: 0,
        skipped: false,
        reason: "empty-delta",
      });
    }

    /*
     * Critical ordering:
     *
     * parent → child
     *
     * The solver generated all deltas
     * from the current FK state.
     *
     * Applying ancestors first lets descendants
     * inherit the updated parent transform
     * before their own delta is applied.
     */
    const ordered =
      deltaPose
        .filter(
          (delta) =>
            delta &&
            delta.bone
        )
        .map((delta) => ({
          delta,
          depth:
            this._getBoneDepth(
              delta.bone
            ),
        }))
        .sort(
          (a, b) =>
            a.depth - b.depth
        );

    /*
     * Make sure the starting world state
     * is current.
     */
    this._updateSkeletonWorldMatrices();

    let applied = 0;

    for (const item of ordered) {
      const result =
        this._applyDelta(
          item.delta
        );

      if (result) {
        applied++;
      }
    }

    /*
     * Rebuild FK after all writes.
     *
     * This is NOT a second writer.
     * It only updates derived world matrices.
     */
    this._updateSkeletonWorldMatrices();

    this.writeCount += applied;

    return this._finish({
      applied,

      writeCount:
        this.writeCount,

      skipped: false,

      reason:
        applied > 0
          ? "applied"
          : "no-valid-delta",

      solverStatus:
        solverResult?.status ??
        null,
    });
  }

  _applyDelta(delta) {
    const bone =
      delta?.bone;

    if (!bone) {
      return false;
    }

    const rotationWorld =
      this._readRotationVector(
        delta.rotationWorld
      );

    if (
      !rotationWorld ||
      rotationWorld.lengthSq() <
        1e-14
    ) {
      return false;
    }

    /*
     * Limit one bone's angular change.
     */
    const magnitude =
      rotationWorld.length();

    if (
      magnitude >
      this.maxRotationPerBone
    ) {
      rotationWorld.multiplyScalar(
        this.maxRotationPerBone /
          magnitude
      );
    }

    const angle =
      rotationWorld.length();

    if (angle < 1e-8) {
      return false;
    }

    /*
     * WORLD axis.
     */
    this._axis
      .copy(rotationWorld)
      .normalize();

    /*
     * Current WORLD orientation.
     */
    bone.getWorldQuaternion(
      this._worldQuaternion
    );

    /*
     * Convert world axis-angle vector
     * into world delta quaternion.
     */
    this._deltaQuaternion
      .setFromAxisAngle(
        this._axis,
        angle
      );

    /*
     * World composition:
     *
     * Qnew =
     *     QdeltaWorld *
     *     QcurrentWorld
     */
    this._nextWorldQuaternion
      .copy(
        this._deltaQuaternion
      )
      .multiply(
        this._worldQuaternion
      )
      .normalize();

    /*
     * Convert WORLD orientation
     * back into LOCAL orientation.
     *
     * Qlocal =
     *
     * inverse(QparentWorld)
     * *
     * QnewWorld
     */
    if (
      bone.parent &&
      bone.parent.isObject3D
    ) {
      bone.parent.getWorldQuaternion(
        this._parentWorldQuaternion
      );

      this._inverseParentQuaternion
        .copy(
          this._parentWorldQuaternion
        )
        .invert();

      bone.quaternion
        .copy(
          this._inverseParentQuaternion
        )
        .multiply(
          this._nextWorldQuaternion
        )
        .normalize();
    } else {
      bone.quaternion
        .copy(
          this._nextWorldQuaternion
        )
        .normalize();
    }

    return true;
  }

  _updateSkeletonWorldMatrices() {
    if (
      !this.skeleton ||
      !Array.isArray(
        this.skeleton.bones
      )
    ) {
      return;
    }

    const bones =
      this.skeleton.bones;

    if (!bones.length) {
      return;
    }

    /*
     * Skeleton bones are children of the
     * model hierarchy. Updating the first
     * bone alone is not guaranteed to update
     * the actual Object3D root.
     *
     * Therefore update the top-level parent
     * when available.
     */
    const root =
      bones[0];

    let top =
      root;

    while (
      top.parent &&
      top.parent.isObject3D
    ) {
      top =
        top.parent;
    }

    top.updateMatrixWorld(
      true
    );
  }

  _getBoneDepth(bone) {
    let depth = 0;

    let current =
      bone;

    while (
      current &&
      current.parent
    ) {
      depth++;

      current =
        current.parent;
    }

    return depth;
  }

  _readRotationVector(value) {
    if (
      value instanceof
      THREE.Vector3
    ) {
      return value.clone();
    }

    if (
      Array.isArray(value) &&
      value.length >= 3
    ) {
      return new THREE.Vector3(
        Number(value[0]) || 0,
        Number(value[1]) || 0,
        Number(value[2]) || 0
      );
    }

    if (
      value &&
      typeof value.x ===
        "number" &&
      typeof value.y ===
        "number" &&
      typeof value.z ===
        "number"
    ) {
      return new THREE.Vector3(
        value.x,
        value.y,
        value.z
      );
    }

    return null;
  }

  _finish(result) {
    this.lastResult =
      result;

    return result;
  }

  getLastResult() {
    return this.lastResult;
  }

  snapshot() {
    return {
      enabled:
        this.enabled,

      writeCount:
        this.writeCount,

      lastApplied:
        this.lastResult?.applied ??
        0,

      lastReason:
        this.lastResult?.reason ??
        null,
    };
  }
}

export default PoseWriter;
