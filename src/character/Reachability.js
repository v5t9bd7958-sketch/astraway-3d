// src/character/Reachability.js

import * as THREE from "three";
import { BONE_MAP } from "./BoneMap.js";

/**
 * Reachability
 *
 * Отвечает только на вопрос:
 *   "Может ли указанная конечность достичь целевой точки
 *    с учётом длины сегментов и текущего положения тела?"
 *
 * НЕ решает, нужно ли это делать.
 * НЕ пишет позу.
 * НЕ выбирает действие.
 */
export class Reachability {
  constructor({
    root = null,
    skeleton = null,
  } = {}) {
    this.root = root;
    this.skeleton = skeleton;

    // Максимальные длины цепочек (примерные, уточняются по скелету)
    this.maxReach = {
      foot_L: 0.95,
      foot_R: 0.95,
      hand_L: 0.75,
      hand_R: 0.75,
    };

    this._bonePos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._delta = new THREE.Vector3();
  }

  setSkeleton(skeleton) {
    this.skeleton = skeleton;
    return this;
  }

  setRoot(root) {
    this.root = root;
    return this;
  }

  /**
   * Проверяет достижимость точки конечностью.
   *
   * @param {string} logicalBone  - "foot_L" | "foot_R" | "hand_L" | "hand_R"
   * @param {THREE.Vector3|Array} target
   * @param {object} options
   * @returns {{ reachable: boolean, distance: number, maxReach: number, excess: number }}
   */
  canReach(logicalBone, target, options = {}) {
    const maxReach = options.maxReach ?? this.maxReach[logicalBone] ?? 0.8;
    const margin = options.margin ?? 0.02;

    if (!this.skeleton || !logicalBone) {
      return {
        reachable: false,
        distance: Infinity,
        maxReach,
        excess: Infinity,
      };
    }

    const boneName = BONE_MAP[logicalBone];
    if (!boneName) {
      return {
        reachable: false,
        distance: Infinity,
        maxReach,
        excess: Infinity,
      };
    }

    const bone = this.skeleton.getBoneByName
      ? this.skeleton.getBoneByName(boneName)
      : this._findBone(boneName);

    if (!bone) {
      return {
        reachable: false,
        distance: Infinity,
        maxReach,
        excess: Infinity,
      };
    }

    bone.getWorldPosition(this._bonePos);

    if (target.isVector3) {
      this._target.copy(target);
    } else if (Array.isArray(target)) {
      this._target.fromArray(target);
    } else {
      this._target.set(target.x || 0, target.y || 0, target.z || 0);
    }

    this._delta.subVectors(this._target, this._bonePos);
    const distance = this._delta.length();
    const excess = distance - maxReach;

    return {
      reachable: distance <= maxReach + margin,
      distance,
      maxReach,
      excess,
      bonePosition: this._bonePos.clone(),
      target: this._target.clone(),
    };
  }

  /**
   * Быстрая проверка нескольких точек.
   * Возвращает первую достижимую или null.
   */
  findReachable(logicalBone, points, options = {}) {
    if (!Array.isArray(points)) return null;

    for (const point of points) {
      const result = this.canReach(logicalBone, point, options);
      if (result.reachable) {
        return { point, ...result };
      }
    }
    return null;
  }

  _findBone(name) {
    if (!this.skeleton?.bones) return null;
    return this.skeleton.bones.find((b) => b.name === name) || null;
  }
}

export default Reachability;
