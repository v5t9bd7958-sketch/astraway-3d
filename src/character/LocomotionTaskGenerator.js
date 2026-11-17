
import {
  TASK_TYPE,
  TASK_PRIORITY,
  Task,
} from "./Task.js";

/**
 * LocomotionTaskGenerator
 *
 * Converts proxy locomotion foot targets into
 * soft effector-position tasks for the main rig.
 *
 * Does NOT:
 * - write bones;
 * - modify the skeleton;
 * - override planted support contacts;
 * - solve IK;
 * - make locomotion decisions.
 *
 * ContactTaskGenerator owns planted contacts.
 * LocomotionTaskGenerator owns swing targets.
 */
export class LocomotionTaskGenerator {
  constructor({ taskSet, weight = 0.65 } = {}) {
    if (!taskSet) {
      throw new Error(
        "LocomotionTaskGenerator: taskSet required"
      );
    }

    this.taskSet = taskSet;

    this.weight = Number.isFinite(weight)
      ? Math.max(0, Math.min(1, weight))
      : 0.65;

    this.taskIds = {
      left: "locomotion:foot_L",
      right: "locomotion:foot_R",
    };

    this.lastFrame = 0;
    this.lastTaskCount = 0;
  }

  update(snapshot) {
    if (!snapshot?.feet) {
      throw new Error(
        "LocomotionTaskGenerator.update: feet snapshot required"
      );
    }

    let count = 0;

    count += this._updateFoot(
      "left",
      snapshot.feet.left
    );

    count += this._updateFoot(
      "right",
      snapshot.feet.right
    );

    this.lastFrame = snapshot.frame ?? this.lastFrame + 1;
    this.lastTaskCount = count;

    return {
      frame: this.lastFrame,
      taskCount: count,
    };
  }

  _updateFoot(side, foot) {
    const taskId = this.taskIds[side];

    if (!foot) {
      this.taskSet.remove(taskId);
      return 0;
    }

    /*
     * Planted feet belong exclusively to
     * ContactTaskGenerator.
     *
     * PLANT is also excluded: contact perception
     * must establish the real support first.
     */
    if (
      foot.phase !== "LIFT" &&
      foot.phase !== "SWING"
    ) {
      this.taskSet.remove(taskId);
      return 0;
    }

    const position = foot.position;

    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    ) {
      this.taskSet.remove(taskId);
      return 0;
    }

    const logicalBone = side === "left"
      ? "foot_L"
      : "foot_R";

    const task = new Task({
      id: taskId,
      type: TASK_TYPE.EFFECTOR_POSITION,
      source: "procedural_locomotion",
      target: [
        position.x,
        position.y,
        position.z,
      ],
      priority: TASK_PRIORITY.NORMAL,
      weight: this.weight,
      hard: false,
      enabled: true,

      metadata: {
        bone: logicalBone,
        locomotionPhase: foot.phase,
        side,
        swingProgress: Number.isFinite(foot.swingProgress)
          ? foot.swingProgress
          : 0,
        stepCount: Number.isFinite(foot.steps)
          ? foot.steps
          : 0,
        intent: foot.intent ?? "swing",
        targetSpace: "world",
      },
    });

    this.taskSet.upsert(task);

    return 1;
  }

  clear() {
    this.taskSet.remove(this.taskIds.left);
    this.taskSet.remove(this.taskIds.right);

    this.lastTaskCount = 0;

    return this;
  }

  getState() {
    return {
      frame: this.lastFrame,
      taskCount: this.lastTaskCount,
      weight: this.weight,
    };
  }
}

export default LocomotionTaskGenerator;
