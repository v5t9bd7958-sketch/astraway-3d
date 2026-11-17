import * as THREE from "three";

const STATE = Object.freeze({
  IDLE: "IDLE",
  MOVING: "MOVING",
  ARRIVED: "ARRIVED",
  RECOVERING: "RECOVERING",
  BLOCKED: "BLOCKED",
  DISPOSED: "DISPOSED",
});

const MODE = Object.freeze({
  WALK: "walk",
  RUN: "run",
});

export class AutonomyAgent {
  constructor({
    human,
    worldAdapter = null,
    arrivalRadius = 0.16,
    arrivalSpeed = 0.2,
    progressSampleInterval = 0.6,
    progressEpsilon = 0.025,
    blockedSpeed = 0.05,
    blockedTimeout = 1.5,
    recoveryTimeout = 2.5,
  } = {}) {
    if (
      !human ||
      typeof human.moveTo !== "function" ||
      typeof human.update !== "function" ||
      typeof human.stop !== "function" ||
      !human.position?.isVector3
    ) {
      throw new TypeError(
        "AutonomyAgent: valid ProceduralHuman required"
      );
    }

    if (
      worldAdapter &&
      typeof worldAdapter.getDiagnostics !== "function"
    ) {
      throw new TypeError(
        "AutonomyAgent: invalid WorldAdapter"
      );
    }

    this.human = human;
    this.worldAdapter = worldAdapter;

    this.config = {
      arrivalRadius,
      arrivalSpeed,
      progressSampleInterval,
      progressEpsilon,
      blockedSpeed,
      blockedTimeout,
      recoveryTimeout,
    };

    this.state = STATE.IDLE;
    this.mode = MODE.WALK;
    this.goal = null;

    this.sampleElapsed = 0;
    this.stagnantElapsed = 0;
    this.recoveryAttempts = 0;

    this.lastPosition = new THREE.Vector3();
    this.hasLastPosition = false;
    this.disposed = false;
  }

  setGoal(target, options = {}) {
    this._assertActive();

    const point = this._toVector3(target);

    if (options.run !== undefined) {
      this.mode = options.run ? MODE.RUN : MODE.WALK;
    }

    this._assertWorldReady();

    this.goal = point;
    this.recoveryAttempts = 0;
    this.sampleElapsed = 0;
    this.stagnantElapsed = 0;

    this.lastPosition.copy(this.human.position);
    this.hasLastPosition = true;

    try {
      this._issueMovement();
      this.state = STATE.MOVING;
    } catch (error) {
      this.goal = null;
      this.state = STATE.IDLE;
      throw error;
    }

    return this.getState();
  }

  setMode(mode) {
    this._assertActive();

    if (mode !== MODE.WALK && mode !== MODE.RUN) {
      throw new RangeError(
        `AutonomyAgent: unsupported mode "${mode}"`
      );
    }

    this.mode = mode;

    if (
      this.goal &&
      (
        this.state === STATE.MOVING ||
        this.state === STATE.RECOVERING
      )
    ) {
      this._issueMovement();
      this.state = STATE.MOVING;
    }

    return this.mode;
  }

  stop() {
    this._assertActive();

    this.human.stop();
    this.goal = null;
    this.state = STATE.IDLE;

    this.sampleElapsed = 0;
    this.stagnantElapsed = 0;
    this.recoveryAttempts = 0;
    this.hasLastPosition = false;

    return this.getState();
  }

  update(dt) {
    this._assertActive();

    if (!Number.isFinite(dt) || dt <= 0) {
      return this.getState();
    }

    // Передаём backend реальное время кадра.
    // Сам locomotion backend выполняет внутреннее ограничение
    // времени и разбиение на подшаги.
    this.human.update(dt);

    // Таймеры агента не должны перескакивать после возврата
    // Safari из фона или длительной паузы вкладки.
    const delta = Math.min(dt, 0.25);

    if (
      !this.goal ||
      (
        this.state !== STATE.MOVING &&
        this.state !== STATE.RECOVERING
      )
    ) {
      return this.getState();
    }

    this.sampleElapsed += delta;

    if (this._hasArrived()) {
      this.state = STATE.ARRIVED;
      this.goal = null;
      this.stagnantElapsed = 0;
      return this.getState();
    }

    if (
      this.sampleElapsed >=
      this.config.progressSampleInterval
    ) {
      this._evaluateProgress();
      this.sampleElapsed = 0;
    }

    return this.getState();
  }

  getState() {
    const position = this.human.position;

    return {
      state: this.state,
      mode: this.mode,
      goal: this.goal ? this.goal.clone() : null,
      position: position.clone(),
      speed: Number.isFinite(this.human.speed)
        ? this.human.speed
        : 0,
      heading: Number.isFinite(this.human.heading)
        ? this.human.heading
        : 0,
      airborne: !!this.human.airborne,
      recoveryAttempts: this.recoveryAttempts,
      world: this.worldAdapter
        ? this.worldAdapter.getDiagnostics()
        : null,
    };
  }

  dispose() {
    if (this.disposed) return;

    this.human.stop();
    this.goal = null;
    this.state = STATE.DISPOSED;
    this.disposed = true;
    this.hasLastPosition = false;
  }

  _issueMovement() {
    if (!this.goal) {
      throw new Error(
        "AutonomyAgent: goal is missing"
      );
    }

    this.human.moveTo(
      this.goal.clone(),
      {
        run: this.mode === MODE.RUN,
      }
    );
  }

  _evaluateProgress() {
    const current = this.human.position;

    if (!this.hasLastPosition) {
      this.lastPosition.copy(current);
      this.hasLastPosition = true;
      return;
    }

    // Продвижение оценивается только в плоскости XZ.
    const dx = current.x - this.lastPosition.x;
    const dz = current.z - this.lastPosition.z;
    const progress = Math.sqrt(dx * dx + dz * dz);

    this.lastPosition.copy(current);

    const speed = Number.isFinite(this.human.speed)
      ? this.human.speed
      : 0;

    const nearGoal =
      this._distanceToGoal() <=
      this.config.arrivalRadius * 2;

    if (
      progress >= this.config.progressEpsilon ||
      speed >= this.config.blockedSpeed ||
      nearGoal ||
      this.human.airborne
    ) {
      this.stagnantElapsed = 0;
      return;
    }

    this.stagnantElapsed +=
      this.config.progressSampleInterval;

    if (
      this.stagnantElapsed <
      this.config.blockedTimeout
    ) {
      return;
    }

    this._recover();
  }

  _recover() {
    if (!this.goal) return;

    if (this.recoveryAttempts >= 1) {
      if (
        this.stagnantElapsed >=
        this.config.recoveryTimeout
      ) {
        this.state = STATE.BLOCKED;
      }
      return;
    }

    this.recoveryAttempts += 1;
    this.state = STATE.RECOVERING;

    try {
      // Повторная передача цели backend для пересчёта маршрута.
      this._issueMovement();

      this.stagnantElapsed = 0;
      this.sampleElapsed = 0;
      this.lastPosition.copy(this.human.position);
      this.state = STATE.MOVING;
    } catch (error) {
      this.state = STATE.BLOCKED;
      throw error;
    }
  }

  _hasArrived() {
    if (!this.goal) return false;

    return (
      this._distanceToGoal() <= this.config.arrivalRadius &&
      (Number.isFinite(this.human.speed)
        ? this.human.speed
        : 0) <= this.config.arrivalSpeed &&
      !this.human.airborne
    );
  }

  _distanceToGoal() {
    if (!this.goal) return Infinity;

    const dx = this.goal.x - this.human.position.x;
    const dz = this.goal.z - this.human.position.z;

    return Math.sqrt(dx * dx + dz * dz);
  }

  _assertWorldReady() {
    if (!this.worldAdapter) return;

    const diagnostics = this.worldAdapter.getDiagnostics();

    if (!diagnostics?.ready) {
      throw new Error(
        "AutonomyAgent: world has no registered walkable geometry"
      );
    }
  }

  _toVector3(value) {
    if (value?.isVector3) {
      if (
        !Number.isFinite(value.x) ||
        !Number.isFinite(value.y) ||
        !Number.isFinite(value.z)
      ) {
        throw new TypeError(
          "AutonomyAgent: goal contains invalid coordinates"
        );
      }

      return value.clone();
    }

    if (Array.isArray(value) && value.length >= 3) {
      value = {
        x: value[0],
        y: value[1],
        z: value[2],
      };
    }

    if (
      !value ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y) ||
      !Number.isFinite(value.z)
    ) {
      throw new TypeError(
        "AutonomyAgent: goal must be a Vector3 or finite XYZ point"
      );
    }

    return new THREE.Vector3(
      value.x,
      value.y,
      value.z
    );
  }

  _assertActive() {
    if (this.disposed) {
      throw new Error(
        "AutonomyAgent: agent has been disposed"
      );
    }
  }
}

export default AutonomyAgent;