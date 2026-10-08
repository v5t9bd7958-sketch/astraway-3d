export const CONSTRAINT_TYPE =
  Object.freeze({
    POSITION: "position",
    ORIENTATION: "orientation",
    DISTANCE: "distance",
    ANGULAR_LIMIT: "angular_limit",
  });

export const CONSTRAINT_SPACE =
  Object.freeze({
    WORLD: "world",
    LOCAL: "local",
  });

export class Constraint {
  constructor({
    id,
    type,
    source = null,
    target = null,
    space = CONSTRAINT_SPACE.WORLD,
    priority = 50,
    weight = 1,
    hard = false,
    enabled = true,
    tolerance = 0.001,
    metadata = null,
  } = {}) {
    if (!id) {
      throw new Error(
        "Constraint: id required"
      );
    }

    if (!type) {
      throw new Error(
        `Constraint ${id}: type required`
      );
    }

    if (
      !Number.isFinite(priority)
    ) {
      throw new Error(
        `Constraint ${id}: invalid priority`
      );
    }

    if (
      !Number.isFinite(weight) ||
      weight < 0
    ) {
      throw new Error(
        `Constraint ${id}: invalid weight`
      );
    }

    if (
      !Number.isFinite(tolerance) ||
      tolerance < 0
    ) {
      throw new Error(
        `Constraint ${id}: invalid tolerance`
      );
    }

    this.id =
      id;

    this.type =
      type;

    /*
     * Источник ограничения.
     *
     * Например:
     * contact_foot_L
     */
    this.source =
      source;

    /*
     * Цель ограничения.
     *
     * Может быть Vector3,
     * Quaternion или иной
     * тип данных в зависимости
     * от ConstraintType.
     */
    this.target =
      target
        ? target.clone?.() ?? target
        : null;

    this.space =
      space;

    this.priority =
      priority;

    this.weight =
      weight;

    /*
     * HARD:
     * constraint должен быть
     * выполнен в пределах
     * возможностей solver.
     *
     * SOFT:
     * solver старается
     * минимизировать ошибку.
     */
    this.hard =
      hard;

    this.enabled =
      enabled;

    this.tolerance =
      tolerance;

    this.metadata =
      metadata
        ? { ...metadata }
        : {};
  }

  enable() {
    this.enabled =
      true;

    return this;
  }

  disable() {
    this.enabled =
      false;

    return this;
  }

  setWeight(weight) {
    if (
      !Number.isFinite(weight) ||
      weight < 0
    ) {
      throw new Error(
        `Constraint ${this.id}: invalid weight`
      );
    }

    this.weight =
      weight;

    return this;
  }

  setPriority(priority) {
    if (
      !Number.isFinite(priority)
    ) {
      throw new Error(
        `Constraint ${this.id}: invalid priority`
      );
    }

    this.priority =
      priority;

    return this;
  }

  setTolerance(tolerance) {
    if (
      !Number.isFinite(tolerance) ||
      tolerance < 0
    ) {
      throw new Error(
        `Constraint ${this.id}: invalid tolerance`
      );
    }

    this.tolerance =
      tolerance;

    return this;
  }

  snapshot() {
    return {
      id:
        this.id,

      type:
        this.type,

      source:
        this.source,

      target:
        this.target?.clone?.() ??
        this.target,

      space:
        this.space,

      priority:
        this.priority,

      weight:
        this.weight,

      hard:
        this.hard,

      enabled:
        this.enabled,

      tolerance:
        this.tolerance,

      metadata: {
        ...this.metadata,
      },
    };
  }
}
