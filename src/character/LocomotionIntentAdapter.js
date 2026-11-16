
// src/character/LocomotionIntentAdapter.js
//
// AstraWay — read-only locomotion intent bridge.
// Reads procedural locomotion state.
// NEVER writes bones, transforms or skeleton pose.

export class LocomotionIntentAdapter {
  constructor({ human } = {}) {
    if (!human?.locomotion?.feet) {
      throw new Error(
        "LocomotionIntentAdapter: valid ProceduralHuman required"
      );
    }

    this.human = human;
    this.frame = 0;

    this.lastSnapshot = null;
  }

  _readVector(value) {
    if (
      !value ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y) ||
      !Number.isFinite(value.z)
    ) {
      return null;
    }

    return {
      x: value.x,
      y: value.y,
      z: value.z,
    };
  }

  _readFoot(side) {
    const foot =
      this.human.locomotion.feet[side];

    if (!foot) {
      return null;
    }

    const phase =
      foot.phase;

    return {
      id: `locomotion_foot_${side}`,
      bone: side === "left"
        ? "foot_L"
        : "foot_R",

      side,

      phase,

      // Current ankle target in world space.
      position:
        this._readVector(foot.position),

      // Last planted position in world space.
      planted:
        this._readVector(foot.planted),

      // Planned landing point in world space.
      landing:
        this._readVector(foot.swing?.end),

      swingProgress:
        Number.isFinite(foot.swing?.t)
          ? foot.swing.t
          : 0,

      steps:
        Number.isFinite(foot.steps)
          ? foot.steps
          : 0,

      intent:
        phase === "PLANTED"
          ? "support"
          : phase === "SWING"
            ? "swing"
            : phase === "LIFT"
              ? "release"
              : "landing",

      // This is descriptive data, not a solver constraint.
      source: "procedural_locomotion",
    };
  }

  sample() {
    const human = this.human;

    const snapshot = {
      frame: ++this.frame,

      body: {
        position:
          this._readVector(human.position),

        velocity:
          this._readVector(human.velocity),

        speed:
          Number.isFinite(human.speed)
            ? human.speed
            : 0,

        heading:
          Number.isFinite(human.heading)
            ? human.heading
            : 0,

        airborne:
          !!human.airborne,

        crouch:
          Number.isFinite(human.crouch)
            ? human.crouch
            : 0,

        gaitMode:
          human.gaitMode ?? "unknown",

        runBlend:
          Number.isFinite(human.runBlend)
            ? human.runBlend
            : 0,
      },

      feet: {
        left: this._readFoot("left"),
        right: this._readFoot("right"),
      },

      navigation: {
        target:
          this._readVector(human.moveTarget),

        path:
          Array.isArray(human.movePath)
            ? human.movePath.map(
                point => this._readVector(point)
              )
            : null,
      },
    };

    this.lastSnapshot = snapshot;

    return snapshot;
  }

  getLastSnapshot() {
    return this.lastSnapshot;
  }

  reset() {
    this.frame = 0;
    this.lastSnapshot = null;
  }
}

export default LocomotionIntentAdapter;
