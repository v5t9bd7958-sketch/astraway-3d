
import * as THREE from "three";

import {
  CONSTRAINT_TYPE,
  CONSTRAINT_SPACE,
  Constraint,
} from "./Constraint.js";

import {
  BONE_MAP,
} from "./BoneMap.js";

import {
  TASK_TYPE,
} from "./Task.js";

export class TaskConstraintBuilder {
  constructor({ constraintSet } = {}) {
    if (!constraintSet) {
      throw new Error(
        "TaskConstraintBuilder: constraintSet required"
      );
    }

    this.constraintSet = constraintSet;
  }

  update(taskPlan) {
    if (!taskPlan) {
      throw new Error(
        "TaskConstraintBuilder.update: taskPlan required"
      );
    }

    const tasks = [
      ...taskPlan.hard,
      ...taskPlan.soft,
    ];

    const activeIds = new Set();

    for (const task of tasks) {
      if (!task?.enabled) continue;

      const constraint = this._buildConstraint(task);

      if (!constraint) continue;

      activeIds.add(constraint.id);
      this.constraintSet.upsert(constraint);
    }

    for (const constraint of this.constraintSet.getAll()) {
      if (!activeIds.has(constraint.id)) {
        this.constraintSet.remove(constraint.id);
      }
    }

    return this.constraintSet;
  }

  _buildConstraint(task) {
    if (
      task.type === TASK_TYPE.CONTACT_MAINTAIN ||
      task.type === TASK_TYPE.EFFECTOR_POSITION
    ) {
      return this._buildPositionConstraint(task);
    }

    return null;
  }

  _buildPositionConstraint(task) {
    if (!task.target) return null;

    const logicalBone = task.metadata?.bone ?? null;

    if (!logicalBone) return null;

    const canonicalBone = BONE_MAP[logicalBone] ?? null;

    if (!canonicalBone) return null;

    const target =
      task.target instanceof THREE.Vector3
        ? task.target.clone()
        : Array.isArray(task.target)
          ? new THREE.Vector3().fromArray(task.target)
          : null;

    if (
      !target ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(target.z)
    ) {
      return null;
    }

    const effectorPosition =
      task.metadata?.effectorPosition;

    const validEffector =
      Array.isArray(effectorPosition) &&
      effectorPosition.length >= 3 &&
      effectorPosition.slice(0, 3).every(Number.isFinite);

    return new Constraint({
      id: `constraint:${task.id}`,
      type: CONSTRAINT_TYPE.POSITION,
      source: task.source,
      target,
      space: CONSTRAINT_SPACE.WORLD,
      priority: task.priority,
      weight: task.weight,
      hard: task.hard,
      enabled: task.enabled,
      tolerance: 0.001,

      metadata: {
        taskId: task.id,
        taskType: task.type,
        logicalBone,
        bone: canonicalBone,

        effectorPosition: validEffector
          ? effectorPosition.slice(0, 3)
          : null,

        surfaceId: task.metadata?.surfaceId ?? null,
        surfaceType: task.metadata?.surfaceType ?? null,

        normal: Array.isArray(task.metadata?.normal)
          ? [...task.metadata.normal]
          : [0, 1, 0],

        isSupport: task.metadata?.isSupport ?? false,
        confidence: task.metadata?.confidence ?? 0,
        separation: task.metadata?.separation ?? Infinity,
      },
    });
  }
}

export default TaskConstraintBuilder;
