export class ConstraintSet {
  constructor() {
    this.constraints =
      new Map();

    this.version =
      0;
  }

  add(constraint) {
    if (!constraint?.id) {
      throw new Error(
        "ConstraintSet.add: invalid constraint"
      );
    }

    if (
      this.constraints.has(
        constraint.id
      )
    ) {
      throw new Error(
        `ConstraintSet: duplicate constraint ${constraint.id}`
      );
    }

    this.constraints.set(
      constraint.id,
      constraint
    );

    this.version++;

    return constraint;
  }

  upsert(constraint) {
    if (!constraint?.id) {
      throw new Error(
        "ConstraintSet.upsert: invalid constraint"
      );
    }

    this.constraints.set(
      constraint.id,
      constraint
    );

    this.version++;

    return constraint;
  }

  remove(id) {
    const removed =
      this.constraints.delete(
        id
      );

    if (removed) {
      this.version++;
    }

    return removed;
  }

  clear() {
    if (
      this.constraints.size > 0
    ) {
      this.constraints.clear();
      this.version++;
    }

    return this;
  }

  has(id) {
    return this.constraints.has(
      id
    );
  }

  get(id) {
    return (
      this.constraints.get(id) ??
      null
    );
  }

  getAll() {
    return [
      ...this.constraints.values(),
    ];
  }

  getEnabled() {
    return this.getAll().filter(
      (constraint) =>
        constraint.enabled
    );
  }

  getHard() {
    return this.getEnabled()
      .filter(
        (constraint) =>
          constraint.hard
      )
      .sort(
        (a, b) =>
          b.priority -
          a.priority
      );
  }

  getSoft() {
    return this.getEnabled()
      .filter(
        (constraint) =>
          !constraint.hard
      )
      .sort(
        (a, b) =>
          b.priority -
          a.priority
      );
  }

  count() {
    return this.constraints.size;
  }

  enabledCount() {
    return this.getEnabled()
      .length;
  }

  hardCount() {
    return this.getHard()
      .length;
  }

  softCount() {
    return this.getSoft()
      .length;
  }

  snapshot() {
    return {
      version:
        this.version,

      constraints:
        this.getAll().map(
          (constraint) =>
            constraint.snapshot()
        ),
    };
  }
}
