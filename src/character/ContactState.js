// src/character/ContactState.js

import * as THREE from "three";

/**
 * Contact lifecycle.
 *
 * NONE
 *   ↓
 * CANDIDATE
 *   ↓
 * ESTABLISHED
 *   ↓
 * PLANTED
 *   ↓
 * BREAKING
 *   ↓
 * RELEASED
 *
 * Important:
 *
 * ContactState does NOT perform perception.
 * It receives measured evidence and decides lifecycle state.
 *
 * Perception says:
 *   "geometry currently provides contact evidence"
 *
 * ContactState says:
 *   "that evidence is persistent enough to become a contact"
 *
 * It never moves bones.
 */

export const CONTACT_PHASE = Object.freeze({
  NONE: "none",
  CANDIDATE: "candidate",
  ESTABLISHED: "established",
  PLANTED: "planted",
  BREAKING: "breaking",
  RELEASED: "released",
});

export class ContactState {
  constructor({
    id,
    bone,
    type = "support",

    establishTime = 0.045,
    plantTime = 0.075,
    breakTime = 0.045,

    minConfidence = 0.40,
    plantConfidence = 0.55,
  } = {}) {
    if (!id) {
      throw new Error(
        "ContactState: id required"
      );
    }

    if (!bone) {
      throw new Error(
        `ContactState ${id}: bone required`
      );
    }

    this.id = id;
    this.bone = bone;
    this.type = type;

    /*
     * Lifecycle.
     */
    this.phase =
      CONTACT_PHASE.NONE;

    /*
     * Measured contact geometry.
     */
    this.point =
      new THREE.Vector3();

    this.normal =
      new THREE.Vector3(0, 1, 0);

    /*
     * Desired target for downstream
     * task / constraint generation.
     *
     * ContactState may maintain this
     * value, but it never writes bones.
     */
    this.target =
      new THREE.Vector3();

    /*
     * Surface identity.
     */
    this.surfaceId = null;
    this.surfaceType = null;

    /*
     * Latest perception evidence.
     */
    this.evidenceValid = false;
    this.confidence = 0;
    this.separation = Infinity;
    this.probeCount = 0;
    this.nearProbeCount = 0;
    this.probeAgreement = 0;

    /*
     * Stable support properties.
     */
    this.weight = 1;
    this.isSupport = false;

    /*
     * Lifecycle timing.
     */
    this.age = 0;

    /*
     * Time during which current evidence
     * has remained continuously usable.
     */
    this.evidenceAge = 0;

    /*
     * Time during which evidence has
     * remained strongly usable for planting.
     */
    this.plantEvidenceAge = 0;

    /*
     * Time since last valid evidence.
     */
    this.lastValidAge = Infinity;

    /*
     * Time spent in current phase.
     */
    this.phaseAge = 0;

    /*
     * Time spent breaking.
     */
    this.breakAge = 0;

    /*
     * Configuration.
     */
    this.establishTime =
      Math.max(
        0,
        establishTime
      );

    this.plantTime =
      Math.max(
        0,
        plantTime
      );

    this.breakTime =
      Math.max(
        0,
        breakTime
      );

    this.minConfidence =
      Math.max(
        0,
        Math.min(
          1,
          minConfidence
        )
      );

    this.plantConfidence =
      Math.max(
        this.minConfidence,
        Math.min(
          1,
          plantConfidence
        )
      );

    /*
     * Diagnostics.
     */
    this.lastTransition =
      CONTACT_PHASE.NONE;

    this.transitionCount = 0;
  }

  /**
   * Consume ContactPerception evidence.
   *
   * This is the ONLY intended bridge from perception
   * into lifecycle state.
   *
   * It does not immediately plant.
   */
  applyEvidence(
    evidence,
    dt = 0
  ) {
    if (!evidence) {
      return this._handleMissingEvidence(dt);
    }

    const delta =
      Number.isFinite(dt) && dt > 0
        ? dt
        : 0;

    /*
     * Copy measured evidence.
     */
    this.evidenceValid =
      evidence.valid === true;

    this.confidence =
      Number.isFinite(
        evidence.confidence
      )
        ? Math.max(
            0,
            Math.min(
              1,
              evidence.confidence
            )
          )
        : 0;

    this.separation =
      Number.isFinite(
        evidence.separation
      )
        ? evidence.separation
        : Infinity;

    this.probeCount =
      Number.isFinite(
        evidence.probeCount
      )
        ? evidence.probeCount
        : 0;

    this.nearProbeCount =
      Number.isFinite(
        evidence.nearProbeCount
      )
        ? evidence.nearProbeCount
        : 0;

    this.probeAgreement =
      Number.isFinite(
        evidence.probeAgreement
      )
        ? evidence.probeAgreement
        : 0;

    if (
      evidence.surfaceId !==
      undefined
    ) {
      this.surfaceId =
        evidence.surfaceId;
    }

    if (
      evidence.surfaceType !==
      undefined
    ) {
      this.surfaceType =
        evidence.surfaceType;
    }

    /*
     * Valid measured point.
     */
    if (
      evidence.point &&
      Number.isFinite(
        evidence.point.x
      ) &&
      Number.isFinite(
        evidence.point.y
      ) &&
      Number.isFinite(
        evidence.point.z
      )
    ) {
      this.point.copy(
        evidence.point
      );

      this.target.copy(
        evidence.point
      );
    }

    /*
     * Valid measured normal.
     */
    if (
      evidence.normal &&
      Number.isFinite(
        evidence.normal.x
      ) &&
      Number.isFinite(
        evidence.normal.y
      ) &&
      Number.isFinite(
        evidence.normal.z
      )
    ) {
      this.normal.copy(
        evidence.normal
      );

      if (
        this.normal.lengthSq() >
        1e-8
      ) {
        this.normal.normalize();
      } else {
        this.normal.set(
          0,
          1,
          0
        );
      }
    }

    /*
     * Strong evidence means:
     *
     * 1. perception says valid
     * 2. confidence is sufficient
     *
     * Temporal persistence is handled below.
     */
    const usable =
      this.evidenceValid &&
      this.confidence >=
        this.minConfidence;

    if (usable) {
      this.evidenceAge += delta;
      this.lastValidAge = 0;

      if (
        this.confidence >=
        this.plantConfidence
      ) {
        this.plantEvidenceAge +=
          delta;
      } else {
        this.plantEvidenceAge = 0;
      }
    } else {
      this.evidenceAge = 0;
      this.plantEvidenceAge = 0;
      this.lastValidAge += delta;
    }

    /*
     * --------------------------------------------------
     * Lifecycle transitions
     * --------------------------------------------------
     */

    if (
      this.phase ===
      CONTACT_PHASE.NONE ||
      this.phase ===
      CONTACT_PHASE.RELEASED
    ) {
      if (usable) {
        this._transition(
          CONTACT_PHASE.CANDIDATE
        );
      }

      return this;
    }

    if (
      this.phase ===
      CONTACT_PHASE.CANDIDATE
    ) {
      if (!usable) {
        this._transition(
          CONTACT_PHASE.NONE
        );

        return this;
      }

      if (
        this.evidenceAge >=
        this.establishTime
      ) {
        this._transition(
          CONTACT_PHASE.ESTABLISHED
        );
      }

      return this;
    }

    if (
      this.phase ===
      CONTACT_PHASE.ESTABLISHED
    ) {
      if (!usable) {
        this._transition(
          CONTACT_PHASE.BREAKING
        );

        return this;
      }

      /*
       * PLANTED requires:
       *
       * - stronger confidence
       * - persistence over plantTime
       *
       * Therefore one noisy frame can never
       * instantly create PLANTED.
       */
      if (
        this.plantEvidenceAge >=
        this.plantTime
      ) {
        this._transition(
          CONTACT_PHASE.PLANTED
        );

        this.isSupport =
          this.type === "support";

        return this;
      }

      return this;
    }

    if (
      this.phase ===
      CONTACT_PHASE.PLANTED
    ) {
      if (!usable) {
        this._transition(
          CONTACT_PHASE.BREAKING
        );

        this.isSupport = false;

        return this;
      }

      /*
       * A planted contact remains planted
       * while evidence remains usable.
       */
      this.isSupport =
        this.type === "support";

      return this;
    }

    if (
      this.phase ===
      CONTACT_PHASE.BREAKING
    ) {
      /*
       * Immediate recovery if evidence
       * returns before release completes.
       */
      if (usable) {
        this.breakAge = 0;

        if (
          this.confidence >=
          this.plantConfidence
        ) {
          this._transition(
            CONTACT_PHASE.PLANTED
          );

          this.isSupport =
            this.type === "support";
        } else {
          this._transition(
            CONTACT_PHASE.ESTABLISHED
          );
        }

        return this;
      }

      if (
        this.breakAge >=
        this.breakTime
      ) {
        this._transition(
          CONTACT_PHASE.RELEASED
        );

        this.isSupport = false;
      }

      return this;
    }

    return this;
  }

  /**
   * Compatibility API.
   *
   * Older callers may still explicitly create
   * a candidate. This does NOT plant the contact.
   */
  setCandidate({
    point,
    normal,
    surfaceId = null,
    surfaceType = null,
    confidence = 0,
  } = {}) {
    if (point) {
      this.point.copy(point);
      this.target.copy(point);
    }

    if (normal) {
      this.normal.copy(normal);

      if (
        this.normal.lengthSq() >
        1e-8
      ) {
        this.normal.normalize();
      }
    }

    this.surfaceId =
      surfaceId;

    this.surfaceType =
      surfaceType;

    this.confidence =
      Number.isFinite(confidence)
        ? confidence
        : 0;

    this.evidenceValid = true;
    this.evidenceAge = 0;

    if (
      this.phase ===
        CONTACT_PHASE.NONE ||
      this.phase ===
        CONTACT_PHASE.RELEASED
    ) {
      this._transition(
        CONTACT_PHASE.CANDIDATE
      );
    }

    return this;
  }

  /**
   * Compatibility transition.
   *
   * Explicit establishment remains allowed,
   * but PLANTED still requires plant().
   */
  establish() {
    if (
      this.phase ===
        CONTACT_PHASE.CANDIDATE ||
      this.phase ===
        CONTACT_PHASE.BREAKING
    ) {
      this._transition(
        CONTACT_PHASE.ESTABLISHED
      );
    }

    return this;
  }

  /**
   * Explicit plant API.
   *
   * Intended for trusted higher-level systems,
   * not raw perception.
   */
  plant({
    point = this.point,
    normal = this.normal,
    surfaceId = this.surfaceId,
    surfaceType = this.surfaceType,
  } = {}) {
    if (point) {
      this.point.copy(point);
      this.target.copy(point);
    }

    if (normal) {
      this.normal.copy(normal);

      if (
        this.normal.lengthSq() >
        1e-8
      ) {
        this.normal.normalize();
      }
    }

    this.surfaceId =
      surfaceId;

    this.surfaceType =
      surfaceType;

    this._transition(
      CONTACT_PHASE.PLANTED
    );

    this.isSupport =
      this.type === "support";

    this.lastValidAge = 0;

    return this;
  }

  /**
   * Begin breaking.
   */
  break() {
    if (
      this.phase !==
        CONTACT_PHASE.NONE &&
      this.phase !==
        CONTACT_PHASE.RELEASED
    ) {
      this._transition(
        CONTACT_PHASE.BREAKING
      );
    }

    this.isSupport = false;
    this.breakAge = 0;

    return this;
  }

  /**
   * Release immediately.
   */
  release() {
    this._transition(
      CONTACT_PHASE.RELEASED
    );

    this.isSupport = false;

    this.evidenceValid = false;
    this.evidenceAge = 0;
    this.plantEvidenceAge = 0;

    this.lastValidAge = Infinity;

    return this;
  }

  /**
   * Full reset.
   */
  reset() {
    this._transition(
      CONTACT_PHASE.NONE
    );

    this.point.set(
      0,
      0,
      0
    );

    this.normal.set(
      0,
      1,
      0
    );

    this.target.set(
      0,
      0,
      0
    );

    this.weight = 1;
    this.isSupport = false;

    this.surfaceId = null;
    this.surfaceType = null;

    this.evidenceValid = false;
    this.confidence = 0;
    this.separation = Infinity;
    this.probeCount = 0;
    this.nearProbeCount = 0;
    this.probeAgreement = 0;

    this.age = 0;
    this.evidenceAge = 0;
    this.plantEvidenceAge = 0;
    this.lastValidAge = Infinity;
    this.phaseAge = 0;
    this.breakAge = 0;

    this.lastTransition =
      CONTACT_PHASE.NONE;

    this.transitionCount = 0;

    return this;
  }

  /**
   * Advance temporal state.
   *
   * Evidence itself is supplied separately through
   * applyEvidence().
   */
  update(dt) {
    if (
      !Number.isFinite(dt) ||
      dt < 0
    ) {
      return this;
    }

    this.age += dt;
    this.phaseAge += dt;

    if (
      this.phase ===
      CONTACT_PHASE.BREAKING
    ) {
      this.breakAge += dt;
    }

    return this;
  }

  /**
   * Lifecycle transition helper.
   */
  _transition(nextPhase) {
    if (
      this.phase ===
      nextPhase
    ) {
      return;
    }

    this.lastTransition =
      nextPhase;

    this.transitionCount++;

    this.phase =
      nextPhase;

    this.phaseAge = 0;

    if (
      nextPhase ===
      CONTACT_PHASE.BREAKING
    ) {
      this.breakAge = 0;
      this.isSupport = false;
    }

    if (
      nextPhase ===
      CONTACT_PHASE.RELEASED
    ) {
      this.isSupport = false;
    }
  }

  /**
   * Missing evidence path.
   */
  _handleMissingEvidence(dt) {
    const delta =
      Number.isFinite(dt) && dt > 0
        ? dt
        : 0;

    this.evidenceValid = false;
    this.confidence = 0;

    this.evidenceAge = 0;
    this.plantEvidenceAge = 0;

    this.lastValidAge += delta;

    if (
      this.phase ===
        CONTACT_PHASE.PLANTED ||
      this.phase ===
        CONTACT_PHASE.ESTABLISHED ||
      this.phase ===
        CONTACT_PHASE.CANDIDATE
    ) {
      this._transition(
        CONTACT_PHASE.BREAKING
      );

      this.isSupport = false;
    }

    return this;
  }

  /**
   * Is the contact currently participating
   * in the active lifecycle?
   */
  isActive() {
    return (
      this.phase ===
        CONTACT_PHASE.CANDIDATE ||
      this.phase ===
        CONTACT_PHASE.ESTABLISHED ||
      this.phase ===
        CONTACT_PHASE.PLANTED ||
      this.phase ===
        CONTACT_PHASE.BREAKING
    );
  }

  /**
   * True only for confirmed planted contact.
   */
  isPlanted() {
    return (
      this.phase ===
      CONTACT_PHASE.PLANTED
    );
  }

  /**
   * True when evidence currently supports
   * the contact, regardless of lifecycle phase.
   */
  hasEvidence() {
    return (
      this.evidenceValid &&
      this.confidence >=
        this.minConfidence
    );
  }

  /**
   * Return a plain diagnostic snapshot.
   */
  getEvidenceState() {
    return {
      valid:
        this.evidenceValid,

      confidence:
        this.confidence,

      separation:
        this.separation,

      probeCount:
        this.probeCount,

      nearProbeCount:
        this.nearProbeCount,

      probeAgreement:
        this.probeAgreement,

      surfaceId:
        this.surfaceId,

      surfaceType:
        this.surfaceType,

      evidenceAge:
        this.evidenceAge,

      plantEvidenceAge:
        this.plantEvidenceAge,

      lastValidAge:
        this.lastValidAge,
    };
  }

  /**
   * Clone complete logical state.
   */
  clone() {
    const copy =
      new ContactState({
        id: this.id,
        bone: this.bone,
        type: this.type,

        establishTime:
          this.establishTime,

        plantTime:
          this.plantTime,

        breakTime:
          this.breakTime,

        minConfidence:
          this.minConfidence,

        plantConfidence:
          this.plantConfidence,
      });

    copy.phase =
      this.phase;

    copy.point.copy(
      this.point
    );

    copy.normal.copy(
      this.normal
    );

    copy.target.copy(
      this.target
    );

    copy.weight =
      this.weight;

    copy.isSupport =
      this.isSupport;

    copy.surfaceId =
      this.surfaceId;

    copy.surfaceType =
      this.surfaceType;

    copy.evidenceValid =
      this.evidenceValid;

    copy.confidence =
      this.confidence;

    copy.separation =
      this.separation;

    copy.probeCount =
      this.probeCount;

    copy.nearProbeCount =
      this.nearProbeCount;

    copy.probeAgreement =
      this.probeAgreement;

    copy.age =
      this.age;

    copy.evidenceAge =
      this.evidenceAge;

    copy.plantEvidenceAge =
      this.plantEvidenceAge;

    copy.lastValidAge =
      this.lastValidAge;

    copy.phaseAge =
      this.phaseAge;

    copy.breakAge =
      this.breakAge;

    copy.lastTransition =
      this.lastTransition;

    copy.transitionCount =
      this.transitionCount;

    return copy;
  }
}

export default ContactState;
