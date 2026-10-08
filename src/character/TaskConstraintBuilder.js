import * as THREE from "three";

import {
  CONSTRAINT_TYPE,
  CONSTRAINT_SPACE,
  Constraint,
} from "./Constraint.js";

import {
  BONE_MAP,
} from "./BoneMap.js";

export class TaskConstraintBuilder {
  constructor({
    constraintSet,
  } = {}) {
    if (!constraintSet) {
      throw new Error(
        "TaskConstraintBuilder: constraintSet required"
      );
    }

    this.constraintSet =
      constraintSet;
  }

  update(taskPlan) {
    if (!taskPlan) {
      throw new Error(
        "TaskConstraintBuilder.update: taskPlan required"
      );
    }

    /*
     * Builder получает только RESOLVED tasks.
     *
     * Он:
     * - не двигает кости;
     * - не вызывает IK;
     * - не меняет BodyState;
     * - не меняет ContactState.
     *
     * Его задача:
     *
     * logical task
     *      ↓
     * constraint
     *
     * Здесь же происходит единственная
     * адаптация:
     *
     * logical bone → canonical THREE.Bone name
     */

    const tasks = [
      ...taskPlan.hard,
      ...taskPlan.soft,
    ];

    const activeIds =
      new Set();

    for (const task of tasks) {
      if (!task?.enabled) {
        continue;
      }

      const constraint =
        this._buildConstraint(task);

      if (!constraint) {
        continue;
      }

      activeIds.add(
        constraint.id
      );

      this.constraintSet.upsert(
        constraint
      );
    }

    /*
     * Удаляем constraints,
     * соответствующие задачам,
     * которые больше не существуют.
     */
    for (
      const constraint
      of this.constraintSet.getAll()
    ) {
      if (
        !activeIds.has(
          constraint.id
        )
      ) {
        this.constraintSet.remove(
          constraint.id
        );
      }
    }

    return this.constraintSet;
  }

  _buildConstraint(task) {
    if (
      task.type ===
      "contact_maintain"
    ) {
      return this._buildContactConstraint(
        task
      );
    }

    /*
     * Неизвестные типы задач
     * явно игнорируются.
     *
     * Новые типы добавляются
     * отдельными builders.
     */
    return null;
  }

  _buildContactConstraint(task) {
    if (!task.target) {
      return null;
    }

    const logicalBone =
      task.metadata?.bone ??
      null;

    if (!logicalBone) {
      return null;
    }

    /*
     * Task работает с нашей
     * логической анатомией.
     *
     * Solver работает с реальными
     * именами THREE.Bone.
     *
     * Поэтому переводим здесь:
     *
     * foot_L → LeftFoot
     */
    const canonicalBone =
      BONE_MAP[logicalBone] ??
      null;

    if (!canonicalBone) {
      return null;
    }

    const target =
      task.target instanceof THREE.Vector3
        ? task.target.clone()
        : new THREE.Vector3()
            .fromArray(
              task.target
            );

    return new Constraint({
      id:
        `constraint:${task.id}`,

      type:
        CONSTRAINT_TYPE.POSITION,

      source:
        task.source,

      target:
        target,

      space:
        CONSTRAINT_SPACE.WORLD,

      priority:
        task.priority,

      weight:
        task.weight,

      hard:
        task.hard,

      enabled:
        task.enabled,

      tolerance:
        0.001,

      metadata: {
        taskId:
          task.id,

        taskType:
          task.type,

        /*
         * Для диагностики сохраняем
         * оба уровня идентичности.
         */
        logicalBone:
          logicalBone,

        /*
         * ЭТО значение читает
         * ConstraintSolver.
         */
        bone:
          canonicalBone,

        surfaceId:
          task.metadata?.surfaceId ??
          null,

        surfaceType:
          task.metadata?.surfaceType ??
          null,

        normal:
          task.metadata?.normal
            ? [
                ...task.metadata.normal,
              ]
            : [0, 1, 0],

        isSupport:
          task.metadata?.isSupport ??
          false,

        confidence:
          task.metadata?.confidence ??
          0,

        separation:
          task.metadata?.separation ??
          Infinity,
      },
    });
  }
}
