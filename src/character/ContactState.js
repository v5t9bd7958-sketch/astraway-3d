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
  }) {
    if (!id) {
      throw new Error("ContactState: id required");
    }

    if (!bone) {
      throw new Error(
        `ContactState ${id}: bone required`
      );
    }

    this.id = id;
    this.bone = bone;
    this.type = type;

    this.phase = CONTACT_PHASE.NONE;

    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);

    this.target = new THREE.Vector3();

    this.weight = 1;
    this.isSupport = false;

    this.surfaceId = null;

    this.age = 0;
    this.lastValidAge = 0;
  }

  setCandidate({
    point,
    normal,
    surfaceId = null,
  }) {
    this.phase = CONTACT_PHASE.CANDIDATE;

    this.point.copy(point);
    this.normal.copy(normal).normalize();

    this.target.copy(point);

    this.surfaceId = surfaceId;

    return this;
  }

  establish() {
    if (
      this.phase === CONTACT_PHASE.CANDIDATE ||
      this.phase === CONTACT_PHASE.BREAKING
    ) {
      this.phase =
        CONTACT_PHASE.ESTABLISHED;
    }

    return this;
  }

  plant({
    point = this.point,
    normal = this.normal,
  } = {}) {
    this.phase = CONTACT_PHASE.PLANTED;

    this.point.copy(point);
    this.normal.copy(normal).normalize();

    this.target.copy(this.point);

    this.isSupport = true;
    this.lastValidAge = 0;

    return this;
  }

  break() {
    if (
      this.phase !== CONTACT_PHASE.NONE &&
      this.phase !== CONTACT_PHASE.RELEASED
    ) {
      this.phase = CONTACT_PHASE.BREAKING;
    }

    this.isSupport = false;

    return this;
  }

  release() {
    this.phase = CONTACT_PHASE.RELEASED;
    this.isSupport = false;
    this.surfaceId = null;

    return this;
  }

  reset() {
    this.phase = CONTACT_PHASE.NONE;

    this.point.set(0, 0, 0);
    this.normal.set(0, 1, 0);
    this.target.set(0, 0, 0);

    this.weight = 1;
    this.isSupport = false;
    this.surfaceId = null;

    this.age = 0;
    this.lastValidAge = 0;

    return this;
  }

  update(dt) {
    this.age += dt;

    if (
      this.phase === CONTACT_PHASE.PLANTED
    ) {
      this.lastValidAge += dt;
    }

    return this;
  }

  isActive() {
    return (
      this.phase ===
        CONTACT_PHASE.ESTABLISHED ||
      this.phase ===
        CONTACT_PHASE.PLANTED ||
      this.phase ===
        CONTACT_PHASE.BREAKING
    );
  }

  isPlanted() {
    return (
      this.phase ===
      CONTACT_PHASE.PLANTED
    );
  }

  clone() {
    const copy =
      new ContactState({
        id: this.id,
        bone: this.bone,
        type: this.type,
      });

    copy.phase = this.phase;
    copy.point.copy(this.point);
    copy.normal.copy(this.normal);
    copy.target.copy(this.target);

    copy.weight = this.weight;
    copy.isSupport = this.isSupport;
    copy.surfaceId = this.surfaceId;

    copy.age = this.age;
    copy.lastValidAge =
      this.lastValidAge;

    return copy;
  }
}
