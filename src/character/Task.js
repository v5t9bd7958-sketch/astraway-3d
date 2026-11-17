
export const TASK_TYPE = Object.freeze({
  CONTACT_MAINTAIN: "contact_maintain",
  EFFECTOR_POSITION: "effector_position",
});

export const TASK_PRIORITY = Object.freeze({
  LOW: 10,
  NORMAL: 50,
  HIGH: 80,
  CRITICAL: 100,
});

export class Task {
  constructor({
    id,
    type,
    source = null,
    target = null,
    priority = TASK_PRIORITY.NORMAL,
    weight = 1,
    hard = false,
    enabled = true,
    metadata = null,
  }) {
    if (!id) {
      throw new Error("Task: id required");
    }

    if (!type) {
      throw new Error(`Task ${id}: type required`);
    }

    this.id = id;
    this.type = type;
    this.source = source;

    this.target = target
      ? target.clone?.() ?? target
      : null;

    this.priority = priority;
    this.weight = weight;
    this.hard = hard;
    this.enabled = enabled;
    this.metadata = metadata
      ? { ...metadata }
      : {};
  }

  enable() {
    this.enabled = true;
    return this;
  }

  disable() {
    this.enabled = false;
    return this;
  }

  setWeight(weight) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Task ${this.id}: invalid weight`);
    }

    this.weight = weight;
    return this;
  }

  setPriority(priority) {
    if (!Number.isFinite(priority)) {
      throw new Error(`Task ${this.id}: invalid priority`);
    }

    this.priority = priority;
    return this;
  }

  snapshot() {
    return {
      id: this.id,
      type: this.type,
      source: this.source,
      target: this.target?.clone?.() ?? this.target,
      priority: this.priority,
      weight: this.weight,
      hard: this.hard,
      enabled: this.enabled,
      metadata: { ...this.metadata },
    };
  }
}
