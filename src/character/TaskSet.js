export class TaskSet {
  constructor() {
    this.tasks =
      new Map();

    this.version = 0;
  }

  add(task) {
    if (!task?.id) {
      throw new Error(
        "TaskSet.add: invalid task"
      );
    }

    if (
      this.tasks.has(
        task.id
      )
    ) {
      throw new Error(
        `TaskSet: duplicate task ${task.id}`
      );
    }

    this.tasks.set(
      task.id,
      task
    );

    this.version++;

    return task;
  }

  upsert(task) {
    if (!task?.id) {
      throw new Error(
        "TaskSet.upsert: invalid task"
      );
    }

    this.tasks.set(
      task.id,
      task
    );

    this.version++;

    return task;
  }

  remove(id) {
    const removed =
      this.tasks.delete(id);

    if (removed) {
      this.version++;
    }

    return removed;
  }

  clear() {
    if (
      this.tasks.size > 0
    ) {
      this.tasks.clear();
      this.version++;
    }

    return this;
  }

  has(id) {
    return this.tasks.has(id);
  }

  get(id) {
    return (
      this.tasks.get(id) ??
      null
    );
  }

  getAll() {
    return [
      ...this.tasks.values(),
    ];
  }

  getEnabled() {
    return [
      ...this.tasks.values(),
    ].filter(
      (task) =>
        task.enabled
    );
  }

  getHard() {
    return this.getEnabled()
      .filter(
        (task) =>
          task.hard
      );
  }

  getSoft() {
    return this.getEnabled()
      .filter(
        (task) =>
          !task.hard
      );
  }

  count() {
    return this.tasks.size;
  }

  enabledCount() {
    return this.getEnabled()
      .length;
  }

  snapshot() {
    return {
      version:
        this.version,

      tasks:
        this.getAll().map(
          (task) =>
            task.snapshot()
        ),
    };
  }
}
