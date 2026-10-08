// src/character/PoseWriter.js

import * as THREE from "three";

/*
 * PoseWriter
 *
 * ЕДИНСТВЕННЫЙ production writer позы.
 *
 * Solver:
 *
 *     вычисляет delta
 *            ↓
 * PoseWriter:
 *     применяет delta
 *            ↓
 * THREE.Bone
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
 * Solver отдаёт rotationWorld:
 *
 *     WORLD rotation vector
 *
 * PoseWriter:
 *
 *     world quaternion
 *          ↓
 *     delta world quaternion
 *          ↓
 *     новый world quaternion
 *          ↓
 *     parent inverse
 *          ↓
 *     local quaternion
 *          ↓
 *     bone.quaternion
 */

export class PoseWriter {
  constructor({
    skeleton = null,

    enabled = true,

    maxRotationPerBone =
      0.18,
  } = {}) {
    this.skeleton =
      skeleton;

    this.enabled =
      Boolean(enabled);

    this.maxRotationPerBone =
      Math.max(
        0.0001,
        Number(
          maxRotationPerBone
        ) || 0.18
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

    this._rotationVector =
      new THREE.Vector3();
  }

  setSkeleton(
    skeleton
  ) {
    this.skeleton =
      skeleton;

    return this;
  }

  setEnabled(
    enabled
  ) {
    this.enabled =
      Boolean(enabled);

    return this;
  }

  setConfiguration({
    maxRotationPerBone =
      this.maxRotationPerBone,
  } = {}) {
    this.maxRotationPerBone =
      Math.max(
        0.0001,
        Number(
          maxRotationPerBone
        ) ||
          this.maxRotationPerBone
      );

    return this;
  }

  write(
    solverResult
  ) {
    if (
      !this.enabled
    ) {
      return {
        applied: 0,
        skipped: true,
        reason:
          "disabled",
      };
    }

    if (
      !this.skeleton
    ) {
      return {
        applied: 0,
        skipped: true,
        reason:
          "skeleton-missing",
      };
    }

    const pose =
      solverResult?.pose;

    if (
      !Array.isArray(pose) ||
      pose.length === 0
    ) {
      return {
        applied: 0,
        skipped: false,
        reason:
          "empty-pose",
      };
    }

    const root =
      this.skeleton.bones?.[0] ||
      null;

    if (root) {
      root.updateMatrixWorld(
        true
      );
    }

    let applied = 0;

    for (
      const delta of pose
    ) {
      if (
        !delta ||
        !delta.boneName
      ) {
        continue;
      }

      const bone =
        this.skeleton.bones.find(
          (candidate) =>
            candidate.name ===
            delta.boneName
        );

      if (!bone) {
        continue;
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
        continue;
      }

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

      /*
       * Current world orientation.
       */
      bone.getWorldQuaternion(
        this._worldQuaternion
      );

      /*
       * rotationWorld is an axis-angle
       * vector:
       *
       * direction = axis
       * length = radians
       */
      const angle =
        rotationWorld.length();

      this._axis
        .copy(rotationWorld)
        .normalize();

      this._deltaQuaternion.setFromAxisAngle(
        this._axis,
        angle
      );

      /*
       * WORLD composition:
       *
       * Qnew = QdeltaWorld * Qworld
       */
      this._nextWorldQuaternion
        .copy(
          this._deltaQuaternion
        )
        .multiply(
          this._worldQuaternion
        );

      /*
       * Convert world orientation
       * back to local orientation.
       *
       * Qlocal =
       * inverse(QparentWorld)
       * * QnewWorld
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

      applied++;
    }

    if (root) {
      root.updateMatrixWorld(
        true
      );
    }

    this.writeCount +=
      applied;

    this.lastResult = {
      applied,

      writeCount:
        this.writeCount,

      solverStatus:
        solverResult?.status ??
        null,
    };

    return this.lastResult;
  }

  _readRotationVector(
    value
  ) {
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
      return new THREE.Vector3()
        .fromArray(value);
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
    };
  }
}
