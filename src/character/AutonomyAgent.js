
import * as THREE from "three";

const STATE = Object.freeze({
  IDLE: "IDLE",
  MOVING: "MOVING",
  ARRIVED: "ARRIVED",
  PARTIAL: "PARTIAL",
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
    goalProjectionTolerance = 0.12,
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
      goalProjectionTolerance,
    };

    this.state = STATE.IDLE;
    this.mode = MODE.WALK;

    // Исходная цель пользователя.
    this.goal = null;

    // Точка, которую фактически выбрал locomotion backend.
    this.movementGoal = null;

    this.goalReachability = "UNKNOWN";
    this.lastGoalResult = null;

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
    this.movementGoal = null;
    this.goalReachability = "UNKNOWN";
    this.lastGoalResult = null;

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
      this.movementGoal = null;
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
    this.movementGoal = null;
    this.goalReachability = "UNKNOWN";
    this.lastGoalResult = null;

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

    // Backend получает реальное время кадра.
    this.human.update(dt);

    // Таймеры агента защищены от длинной паузы вкладки.
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
      this._finishGoal();
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

      // Запрошенная точка.
      goal: this.goal ? this.goal.clone() : null,

      // Реальная точка назначения backend.
      movementGoal: this.movementGoal
        ? this.movementGoal.clone()
        : null,

      // REACHABLE / PARTIAL / UNKNOWN.
      goalReachability: this.goalReachability,

      // Последний завершённый результат.
      lastGoalResult: this.lastGoalResult
        ? {
            requested: this.lastGoalResult.requested.clone(),
            destination: this.lastGoalResult.destination.clone(),
            reachability: this.lastGoalResult.reachability,
            offset: this.lastGoalResult.offset,
          }
        : null,

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
    this.movementGoal = null;
    this.lastGoalResult = null;

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

    // Библиотека сама определяет ближайшую достижимую точку,
    // если исходная цель недостижима.
    const resolvedTarget = this.human.moveTarget;

    this.movementGoal =
      resolvedTarget?.isVector3
        ? resolvedTarget.clone()
        : this.goal.clone();

    const offset = this.goal.distanceTo(
      this.movementGoal
    );

    this.goalReachability =
      offset > this.config.goalProjectionTolerance
        ? "PARTIAL"
        : "REACHABLE";
  }

  _evaluateProgress() {
    const current = this.human.position;

    if (!this.hasLastPosition) {
      this.lastPosition.copy(current);
      this.hasLastPosition = true;
      return;
    }

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
      // Повторная передача цели заставляет backend
      // пересчитать маршрут с учётом текущей позиции.
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

  _finishGoal() {
    if (!this.goal || !this.movementGoal) return;

    const requested = this.goal.clone();
    const destination = this.movementGoal.clone();
    const reachability = this.goalReachability;

    this.lastGoalResult = {
      requested,
      destination,
      reachability,
      offset: requested.distanceTo(destination),
    };

    this.state =
      reachability === "PARTIAL"
        ? STATE.PARTIAL
        : STATE.ARRIVED;

    this.goal = null;
    this.stagnantElapsed = 0;
  }

  _hasArrived() {
    if (!this.goal || !this.movementGoal) {
      return false;
    }

    return (
      this._distanceToGoal() <= this.config.arrivalRadius &&
      (Number.isFinite(this.human.speed)
        ? this.human.speed
        : 0) <= this.config.arrivalSpeed &&
      !this.human.airborne
    );
  }

  _distanceToGoal() {
    if (!this.movementGoal) return Infinity;

    const dx =
      this.movementGoal.x - this.human.position.x;

    const dz =
      this.movementGoal.z - this.human.position.z;

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
