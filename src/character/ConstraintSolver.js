// src/character/ConstraintSolver.js

import * as THREE from "three";

/*
 * ConstraintSolver
 *
 * Роль:
 *
 * ConstraintSet
 *      ↓
 * ConstraintSolver
 *      ↓
 * SolverResult
 *
 * ВАЖНО:
 *
 * ConstraintSolver НЕ:
 * - изменяет Skeleton;
 * - изменяет Bone;
 * - вызывает IK;
 * - пишет quaternion / position;
 * - выбирает gait;
 * - выбирает traversal;
 * - создаёт Tasks;
 * - создаёт Constraints.
 *
 * Его задача на этом этапе:
 *
 * 1. принять ConstraintSet;
 * 2. нормализовать ограничения;
 * 3. подготовить solver input;
 * 4. вернуть структурированный результат;
 *
 * Реальный IK / DLS / closed-chain solver
 * подключается следующим слоем.
 *
 * Поэтому gameplay architecture уже не зависит
 * от конкретного solver implementation.
 */

export const SOLVER_RESULT_STATUS =
  Object.freeze({
    EMPTY: "empty",
    READY: "ready",
    SOLVED: "solved",
    PARTIAL: "partial",
    FAILED: "failed",
  });

export class ConstraintSolver {
  constructor({
    skeleton = null,
  } = {}) {
    this.skeleton =
      skeleton;

    this.enabled = true;

    this.lastResult =
      null;

    this.solveCount =
      0;

    this.lastSolveTime =
      0;

    this._worldPosition =
      new THREE.Vector3();

    this._worldQuaternion =
      new THREE.Quaternion();
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

  /*
   * Главная точка входа.
   *
   * ConstraintSet остаётся
   * источником истины для constraints.
   */
  solve(
    constraintSet,
    {
      dt = 0,
      time = 0,
    } = {}
  ) {
    if (!constraintSet) {
      throw new Error(
        "ConstraintSolver.solve: constraintSet required"
      );
    }

    const startedAt =
      typeof performance !== "undefined"
        ? performance.now()
        : Date.now();

    if (!this.enabled) {
      const result =
        this._createResult({
          status:
            SOLVER_RESULT_STATUS.EMPTY,
          dt,
          time,
        });

      this.lastResult =
        result;

      return result;
    }

    const constraints =
      typeof constraintSet.getEnabled ===
      "function"
        ? constraintSet.getEnabled()
        : [];

    if (!constraints.length) {
      const result =
        this._createResult({
          status:
            SOLVER_RESULT_STATUS.EMPTY,
          dt,
          time,
        });

      this.lastResult =
        result;

      return result;
    }

    /*
     * Пока solver НЕ меняет pose.
     *
     * Он строит чистый solver input.
     *
     * Это принципиально:
     *
     * Task
     *   ↓
     * Constraint
     *   ↓
     * SolverInput
     *
     * а не:
     *
     * Constraint
     *   ↓
     * Bone.quaternion = ...
     */
    const input =
      this._buildInput(
        constraints
      );

    const result =
      this._createResult({
        status:
          SOLVER_RESULT_STATUS.READY,

        dt,
        time,

        constraints,
        input,
      });

    result.solveCount =
      ++this.solveCount;

    const finishedAt =
      typeof performance !== "undefined"
        ? performance.now()
        : Date.now();

    result.solveTime =
      finishedAt -
      startedAt;

    this.lastSolveTime =
      result.solveTime;

    this.lastResult =
      result;

    return result;
  }

  /*
   * Преобразует Constraint
   * в нейтральное описание для solver.
   *
   * Здесь нет Three.js Bone mutation.
   */
  _buildInput(
    constraints
  ) {
    const input = [];

    for (
      const constraint
      of constraints
    ) {
      if (
        !constraint ||
        constraint.enabled === false
      ) {
        continue;
      }

      const entry =
        this._buildConstraintInput(
          constraint
        );

      if (entry) {
        input.push(entry);
      }
    }

    /*
     * Сначала HARD,
     * затем priority,
     * затем weight.
     *
     * Это подготовка порядка обработки,
     * а не само решение.
     */
    input.sort(
      (a, b) => {
        if (
          a.hard !== b.hard
        ) {
          return a.hard
            ? -1
            : 1;
        }

        if (
          a.priority !==
          b.priority
        ) {
          return (
            b.priority -
            a.priority
          );
        }

        return (
          b.weight -
          a.weight
        );
      }
    );

    return input;
  }

  _buildConstraintInput(
    constraint
  ) {
    if (!constraint.id) {
      return null;
    }

    const target =
      this._cloneTarget(
        constraint.target
      );

    return {
      id:
        constraint.id,

      type:
        constraint.type,

      source:
        constraint.source,

      target,

      space:
        constraint.space,

      priority:
        constraint.priority,

      weight:
        constraint.weight,

      hard:
        constraint.hard,

      tolerance:
        constraint.tolerance,

      metadata: {
        ...(
          constraint.metadata ||
          {}
        ),
      },
    };
  }

  /*
   * Важно:
   * target может быть Vector3,
   * Quaternion или обычным объектом.
   */
  _cloneTarget(
    target
  ) {
    if (!target) {
      return null;
    }

    if (
      typeof target.clone ===
      "function"
    ) {
      return target.clone();
    }

    if (
      Array.isArray(target)
    ) {
      return [
        ...target,
      ];
    }

    if (
      typeof target ===
      "object"
    ) {
      return {
        ...target,
      };
    }

    return target;
  }

  _createResult({
    status,
    dt = 0,
    time = 0,
    constraints = [],
    input = [],
  }) {
    return {
      status,

      dt,

      time,

      constraints:
        constraints.length,

      hardConstraints:
        constraints.filter(
          (constraint) =>
            constraint.hard
        ).length,

      softConstraints:
        constraints.filter(
          (constraint) =>
            !constraint.hard
        ).length,

      input,

      /*
       * Будущие реальные solver outputs:
       *
       * pose
       * bone rotations
       * bone positions
       * residuals
       * convergence
       *
       * Пока намеренно пусты.
       */
      pose: null,

      residuals: [],

      convergence: null,

      solved:
        false,

      solveCount:
        this.solveCount,

      solveTime:
        0,
    };
  }

  getLastResult() {
    return this.lastResult;
  }

  getLastSolveTime() {
    return this.lastSolveTime;
  }

  snapshot() {
    if (!this.lastResult) {
      return {
        status:
          SOLVER_RESULT_STATUS.EMPTY,

        solveCount:
          this.solveCount,

        solveTime:
          this.lastSolveTime,
      };
    }

    return {
      status:
        this.lastResult.status,

      constraints:
        this.lastResult.constraints,

      hardConstraints:
        this.lastResult.hardConstraints,

      softConstraints:
        this.lastResult.softConstraints,

      solved:
        this.lastResult.solved,

      solveCount:
        this.lastResult.solveCount,

      solveTime:
        this.lastResult.solveTime,
    };
  }
}
