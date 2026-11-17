
import {
  TASK_TYPE,
  TASK_PRIORITY,
  Task,
} from "./Task.js";

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
    this.lastSuppressedCount = 0;
  }

  update(snapshot) {
    if (!snapshot?.feet) {
      throw new Error(
        "LocomotionTaskGenerator.update: feet snapshot required"
      );
    }

    let count = 0;
    let suppressed = 0;

    const left = this._updateFoot(
      "left",
      snapshot.feet.left
    );

    const right = this._updateFoot(
      "right",
      snapshot.feet.right
    );

    count += left.created;
    count += right.created;

    suppressed += left.suppressed;
    suppressed += right.suppressed;

    this.lastFrame =
      snapshot.frame ?? this.lastFrame + 1;

    this.lastTaskCount = count;
    this.lastSuppressedCount = suppressed;

    return {
      frame: this.lastFrame,
      taskCount: count,
      suppressedCount: suppressed,
    };
  }

  _updateFoot(side, foot) {
    const taskId = this.taskIds[side];

    const logicalBone = side === "left"
      ? "foot_L"
      : "foot_R";

    if (!foot) {
      this.taskSet.remove(taskId);

      return {
        created: 0,
        suppressed: 0,
      };
    }

    /*
     * ContactTaskGenerator has authority over
     * every established contact on this bone.
     *
     * This prevents proxy swing targets from
     * competing with real support/contact tasks.
     */
    if (this._hasContactAuthority(logicalBone)) {
      this.taskSet.remove(taskId);

      return {
        created: 0,
        suppressed: 1,
      };
    }

    /*
     * Only LIFT and SWING produce locomotion
     * position targets.
     *
     * PLANT is not enough to establish support.
     * ContactPerception must confirm it first.
     */
    if (
      foot.phase !== "LIFT" &&
      foot.phase !== "SWING"
    ) {
      this.taskSet.remove(taskId);

      return {
        created: 0,
        suppressed: 0,
      };
    }

    const position = foot.position;

    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    ) {
      this.taskSet.remove(taskId);

      return {
        created: 0,
        suppressed: 0,
      };
    }

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
        side,
        locomotionPhase: foot.phase,

        swingProgress: Number.isFinite(
          foot.swingProgress
        )
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

    return {
      created: 1,
      suppressed: 0,
    };
  }

  _hasContactAuthority(logicalBone) {
    return this.taskSet
      .getEnabled()
      .some((task) => {
        return (
          task.type === TASK_TYPE.CONTACT_MAINTAIN &&
          task.metadata?.bone === logicalBone
        );
      });
  }

  clear() {
    this.taskSet.remove(this.taskIds.left);
    this.taskSet.remove(this.taskIds.right);

    this.lastTaskCount = 0;
    this.lastSuppressedCount = 0;

    return this;
  }

  getState() {
    return {
      frame: this.lastFrame,
      taskCount: this.lastTaskCount,
      suppressedCount: this.lastSuppressedCount,
      weight: this.weight,
    };
  }
}

export default LocomotionTaskGenerator;
