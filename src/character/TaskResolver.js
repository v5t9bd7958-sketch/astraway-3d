/*
 * TaskResolver
 *
 * Единственная ответственность:
 *
 * TaskSet
 *    ↓
 * TaskResolver
 *    ↓
 * ResolvedTaskPlan
 *
 * Resolver НЕ:
 * - двигает Skeleton;
 * - меняет Bone;
 * - вызывает IK;
 * - меняет BodyState;
 * - создаёт ContactState;
 * - выбирает gait;
 * - принимает traversal decisions.
 *
 * Он только разрешает структуру задач:
 *
 * HARD constraints
 *        ↓
 * SOFT objectives
 *
 * и определяет порядок их обработки.
 */

export class TaskResolver {
  constructor() {
    this.version = 0;

    this.lastPlan = {
      version: 0,
      taskSetVersion: -1,
      hard: [],
      soft: [],
      conflicts: [],
    };
  }

  resolve(taskSet) {
    if (!taskSet) {
      throw new Error(
        "TaskResolver.resolve: taskSet required"
      );
    }

    const enabled =
      taskSet.getEnabled();

    const hard =
      enabled
        .filter(
          (task) =>
            task.hard
        )
        .sort(
          (a, b) =>
            b.priority -
            a.priority
        );

    const soft =
      enabled
        .filter(
          (task) =>
            !task.hard
        )
        .sort(
          (a, b) =>
            b.priority -
            a.priority
        );

    const conflicts =
      this._detectConflicts(
        hard
      );

    this.version++;

    this.lastPlan = {
      version:
        this.version,

      taskSetVersion:
        taskSet.version,

      hard: hard.slice(),

      soft: soft.slice(),

      conflicts,
    };

    return this.lastPlan;
  }

  _detectConflicts(tasks) {
    const conflicts = [];

    /*
     * На этом этапе конфликт
     * определяется только структурно:
     *
     * две HARD задачи пытаются
     * управлять одним и тем же
     * logical bone.
     *
     * Геометрический конфликт
     * появится позже в Solver.
     */

    const owners =
      new Map();

    for (const task of tasks) {
      const bone =
        task.metadata?.bone;

      if (!bone) {
        continue;
      }

      const previous =
        owners.get(bone);

      if (previous) {
        conflicts.push({
          type:
            "multiple_hard_tasks_same_bone",

          bone,

          tasks: [
            previous.id,
            task.id,
          ],
        });

        continue;
      }

      owners.set(
        bone,
        task
      );
    }

    return conflicts;
  }

  getLastPlan() {
    return this.lastPlan;
  }

  hasConflicts() {
    return (
      this.lastPlan.conflicts.length >
      0
    );
  }

  snapshot() {
    return {
      version:
        this.lastPlan.version,

      taskSetVersion:
        this.lastPlan.taskSetVersion,

      hard:
        this.lastPlan.hard.map(
          (task) =>
            task.snapshot()
        ),

      soft:
        this.lastPlan.soft.map(
          (task) =>
            task.snapshot()
        ),

      conflicts:
        this.lastPlan.conflicts.map(
          (conflict) => ({
            ...conflict,
            tasks:
              conflict.tasks.slice(),
          })
        ),
    };
  }
}
