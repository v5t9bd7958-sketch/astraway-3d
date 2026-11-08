
// src/character/ContactState.js

import * as THREE from "three";

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
      throw new Error("ContactState: id required");
    }

    if (!bone) {
      throw new Error(`ContactState ${id}: bone required`);
    }

    this.id = id;
    this.bone = bone;
    this.type = type;

    this.phase = CONTACT_PHASE.NONE;

    // Current measured contact geometry.
    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);

    // Fixed world-space anchor used by planted tasks.
    this.target = new THREE.Vector3();

    this.surfaceId = null;
    this.surfaceType = null;

    this.evidenceValid = false;
    this.confidence = 0;
    this.separation = Infinity;
    this.probeCount = 0;
    this.nearProbeCount = 0;
    this.probeAgreement = 0;

    this.weight = 1;
    this.isSupport = false;

    this.age = 0;
    this.evidenceAge = 0;
    this.plantEvidenceAge = 0;
    this.lastValidAge = Infinity;
    this.phaseAge = 0;
    this.breakAge = 0;

    this.establishTime = Math.max(0, establishTime);
    this.plantTime = Math.max(0, plantTime);
    this.breakTime = Math.max(0, breakTime);

    this.minConfidence = Math.max(
      0,
      Math.min(1, minConfidence)
    );

    this.plantConfidence = Math.max(
      this.minConfidence,
      Math.min(1, plantConfidence)
    );

    this.lastTransition = CONTACT_PHASE.NONE;
    this.transitionCount = 0;
  }

  /**
   * Update measured point.
   *
   * point may move every frame.
   * target is updated only while the contact
   * is not PLANTED.
   */
  _updateMeasuredPoint(point) {
    if (
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    ) {
      return false;
    }

    this.point.copy(point);

    if (this.phase !== CONTACT_PHASE.PLANTED) {
      this.target.copy(point);
    }

    return true;
  }

  /**
   * Explicitly establish a new world-space anchor.
   * Called only when a contact becomes planted
   * or is deliberately replanted.
   */
  _setAnchor(point = this.point) {
    if (
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    ) {
      return false;
    }

    this.target.copy(point);
    return true;
  }

  /**
   * Consume ContactPerception evidence.
   */
  applyEvidence(evidence, dt = 0) {
    if (!evidence) {
      return this._handleMissingEvidence(dt);
    }

    const delta =
      Number.isFinite(dt) && dt > 0
        ? dt
        : 0;

    this.evidenceValid = evidence.valid === true;

    this.confidence = Number.isFinite(evidence.confidence)
      ? Math.max(0, Math.min(1, evidence.confidence))
      : 0;

    this.separation = Number.isFinite(evidence.separation)
      ? evidence.separation
      : Infinity;

    this.probeCount = Number.isFinite(evidence.probeCount)
      ? evidence.probeCount
      : 0;

    this.nearProbeCount = Number.isFinite(evidence.nearProbeCount)
      ? evidence.nearProbeCount
      : 0;

    this.probeAgreement = Number.isFinite(evidence.probeAgreement)
      ? evidence.probeAgreement
      : 0;

    if (evidence.surfaceId !== undefined) {
      this.surfaceId = evidence.surfaceId;
    }

    if (evidence.surfaceType !== undefined) {
      this.surfaceType = evidence.surfaceType;
    }

    // Update measurement, but never move a planted anchor.
    this._updateMeasuredPoint(evidence.point);

    if (
      evidence.normal &&
      Number.isFinite(evidence.normal.x) &&
      Number.isFinite(evidence.normal.y) &&
      Number.isFinite(evidence.normal.z)
    ) {
      this.normal.copy(evidence.normal);

      if (this.normal.lengthSq() > 1e-8) {
        this.normal.normalize();
      } else {
        this.normal.set(0, 1, 0);
      }
    }

    const usable =
      this.evidenceValid &&
      this.confidence >= this.minConfidence;

    if (usable) {
      this.evidenceAge += delta;
      this.lastValidAge = 0;

      if (this.confidence >= this.plantConfidence) {
        this.plantEvidenceAge += delta;
      } else {
        this.plantEvidenceAge = 0;
      }
    } else {
      this.evidenceAge = 0;
      this.plantEvidenceAge = 0;
      this.lastValidAge += delta;
    }

    // NONE / RELEASED -> CANDIDATE
    if (
      this.phase === CONTACT_PHASE.NONE ||
      this.phase === CONTACT_PHASE.RELEASED
    ) {
      if (usable) {
        this._transition(CONTACT_PHASE.CANDIDATE);
      }

      return this;
    }

    // CANDIDATE -> ESTABLISHED
    if (this.phase === CONTACT_PHASE.CANDIDATE) {
      if (!usable) {
        this._transition(CONTACT_PHASE.NONE);
        return this;
      }

      if (this.evidenceAge >= this.establishTime) {
        this._transition(CONTACT_PHASE.ESTABLISHED);
      }

      return this;
    }

    // ESTABLISHED -> PLANTED
    if (this.phase === CONTACT_PHASE.ESTABLISHED) {
      if (!usable) {
        this._transition(CONTACT_PHASE.BREAKING);
        return this;
      }

      if (this.plantEvidenceAge >= this.plantTime) {
        // Freeze the latest measured point as the anchor.
        this._setAnchor(this.point);

        this._transition(CONTACT_PHASE.PLANTED);

        this.isSupport = this.type === "support";
        return this;
      }

      return this;
    }

    // PLANTED remains fixed while evidence is usable.
    if (this.phase === CONTACT_PHASE.PLANTED) {
      if (!usable) {
        this._transition(CONTACT_PHASE.BREAKING);
        this.isSupport = false;
        return this;
      }

      this.isSupport = this.type === "support";
      return this;
    }

    // BREAKING -> recovery or RELEASED
    if (this.phase === CONTACT_PHASE.BREAKING) {
      if (usable) {
        this.breakAge = 0;

        if (this.confidence >= this.plantConfidence) {
          // A recovered contact gets a new anchor.
          this._setAnchor(this.point);

          this._transition(CONTACT_PHASE.PLANTED);
          this.isSupport = this.type === "support";
        } else {
          this._transition(CONTACT_PHASE.ESTABLISHED);
          this.isSupport = false;
        }

        return this;
      }

      if (this.breakAge >= this.breakTime) {
        this._transition(CONTACT_PHASE.RELEASED);
        this.isSupport = false;
      }

      return this;
    }

    return this;
  }

  /**
   * Compatibility API.
   * Does not move an existing PLANTED anchor.
   */
  setCandidate({
    point,
    normal,
    surfaceId = null,
    surfaceType = null,
    confidence = 0,
  } = {}) {
    this._updateMeasuredPoint(point);

    if (normal) {
      this.normal.copy(normal);

      if (this.normal.lengthSq() > 1e-8) {
        this.normal.normalize();
      }
    }

    this.surfaceId = surfaceId;
    this.surfaceType = surfaceType;

    this.confidence = Number.isFinite(confidence)
      ? confidence
      : 0;

    this.evidenceValid = true;
    this.evidenceAge = 0;

    if (
      this.phase === CONTACT_PHASE.NONE ||
      this.phase === CONTACT_PHASE.RELEASED
    ) {
      this._transition(CONTACT_PHASE.CANDIDATE);
    }

    return this;
  }

  /**
   * Explicit establishment.
   */
  establish() {
    if (
      this.phase === CONTACT_PHASE.CANDIDATE ||
      this.phase === CONTACT_PHASE.BREAKING
    ) {
      this._transition(CONTACT_PHASE.ESTABLISHED);
    }

    return this;
  }

  /**
   * Explicit planting.
   *
   * This is an intentional anchor reset.
   */
  plant({
    point = this.point,
    normal = this.normal,
    surfaceId = this.surfaceId,
    surfaceType = this.surfaceType,
  } = {}) {
    if (point) {
      this.point.copy(point);
      this._setAnchor(point);
    }

    if (normal) {
      this.normal.copy(normal);

      if (this.normal.lengthSq() > 1e-8) {
        this.normal.normalize();
      }
    }

    this.surfaceId = surfaceId;
    this.surfaceType = surfaceType;

    this._transition(CONTACT_PHASE.PLANTED);

    this.isSupport = this.type === "support";
    this.lastValidAge = 0;

    return this;
  }

  /**
   * Begin breaking.
   */
  break() {
    if (
      this.phase !== CONTACT_PHASE.NONE &&
      this.phase !== CONTACT_PHASE.RELEASED
    ) {
      this._transition(CONTACT_PHASE.BREAKING);
    }

    this.isSupport = false;
    this.breakAge = 0;

    return this;
  }

  /**
   * Release immediately.
   */
  release() {
    this._transition(CONTACT_PHASE.RELEASED);

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
    this._transition(CONTACT_PHASE.NONE);

    this.point.set(0, 0, 0);
    this.normal.set(0, 1, 0);
    this.target.set(0, 0, 0);

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

    this.lastTransition = CONTACT_PHASE.NONE;
    this.transitionCount = 0;

    return this;
  }

  /**
   * Advance temporal state.
   */
  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) {
      return this;
    }

    this.age += dt;
    this.phaseAge += dt;

    if (this.phase === CONTACT_PHASE.BREAKING) {
      this.breakAge += dt;
    }

    return this;
  }

  /**
   * Lifecycle transition helper.
   */
  _transition(nextPhase) {
    if (this.phase === nextPhase) {
      return;
    }

    this.lastTransition = nextPhase;
    this.transitionCount++;

    this.phase = nextPhase;
    this.phaseAge = 0;

    if (nextPhase === CONTACT_PHASE.BREAKING) {
      this.breakAge = 0;
      this.isSupport = false;
    }

    if (nextPhase === CONTACT_PHASE.RELEASED) {
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
      this.phase === CONTACT_PHASE.PLANTED ||
      this.phase === CONTACT_PHASE.ESTABLISHED ||
      this.phase === CONTACT_PHASE.CANDIDATE
    ) {
      this._transition(CONTACT_PHASE.BREAKING);
      this.isSupport = false;
    }

    return this;
  }

  isActive() {
    return (
      this.phase === CONTACT_PHASE.CANDIDATE ||
      this.phase === CONTACT_PHASE.ESTABLISHED ||
      this.phase === CONTACT_PHASE.PLANTED ||
      this.phase === CONTACT_PHASE.BREAKING
    );
  }

  isPlanted() {
    return this.phase === CONTACT_PHASE.PLANTED;
  }

  hasEvidence() {
    return (
      this.evidenceValid &&
      this.confidence >= this.minConfidence
    );
  }

  getEvidenceState() {
    return {
      valid: this.evidenceValid,
      confidence: this.confidence,
      separation: this.separation,
      probeCount: this.probeCount,
      nearProbeCount: this.nearProbeCount,
      probeAgreement: this.probeAgreement,
      surfaceId: this.surfaceId,
      surfaceType: this.surfaceType,
      evidenceAge: this.evidenceAge,
      plantEvidenceAge: this.plantEvidenceAge,
      lastValidAge: this.lastValidAge,
    };
  }

  clone() {
    const copy = new ContactState({
      id: this.id,
      bone: this.bone,
      type: this.type,
      establishTime: this.establishTime,
      plantTime: this.plantTime,
      breakTime: this.breakTime,
      minConfidence: this.minConfidence,
      plantConfidence: this.plantConfidence,
    });

    copy.phase = this.phase;

    copy.point.copy(this.point);
    copy.normal.copy(this.normal);
    copy.target.copy(this.target);

    copy.weight = this.weight;
    copy.isSupport = this.isSupport;

    copy.surfaceId = this.surfaceId;
    copy.surfaceType = this.surfaceType;

    copy.evidenceValid = this.evidenceValid;
    copy.confidence = this.confidence;
    copy.separation = this.separation;
    copy.probeCount = this.probeCount;
    copy.nearProbeCount = this.nearProbeCount;
    copy.probeAgreement = this.probeAgreement;

    copy.age = this.age;
    copy.evidenceAge = this.evidenceAge;
    copy.plantEvidenceAge = this.plantEvidenceAge;
    copy.lastValidAge = this.lastValidAge;
    copy.phaseAge = this.phaseAge;
    copy.breakAge = this.breakAge;

    copy.lastTransition = this.lastTransition;
    copy.transitionCount = this.transitionCount;

    return copy;
  }
}

export default ContactState;
