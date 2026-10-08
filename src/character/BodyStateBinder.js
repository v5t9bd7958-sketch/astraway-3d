import * as THREE from "three";

import {
  ContactState,
} from "./ContactState.js";

import {
  BONE_MAP,
} from "./BoneMap.js";

/*
 * BodyStateBinder
 *
 * Единственная ответственность:
 *
 * Skeleton / World
 *       ↓
 * BodyStateBinder
 *       ↓
 * BodyState + ContactState
 *
 * Binder НИКОГДА:
 * - не двигает кости;
 * - не вызывает IK;
 * - не выбирает gait;
 * - не создаёт задачи;
 * - не принимает traversal decisions;
 * - не меняет Pose;
 * - не является владельцем Skeleton.
 *
 * Он только измеряет уже существующее состояние.
 */

export class BodyStateBinder {
  constructor({
    root,
    skeleton,
    bodyState,
    groundY = 0,
    contactDistance = 0.045,
    contactVelocityThreshold = 0.35,
  } = {}) {
    if (!root) {
      throw new Error(
        "BodyStateBinder: root required"
      );
    }

    if (!skeleton?.bones) {
      throw new Error(
        "BodyStateBinder: skeleton required"
      );
    }

    if (!bodyState) {
      throw new Error(
        "BodyStateBinder: bodyState required"
      );
    }

    this.root = root;
    this.skeleton = skeleton;
    this.bodyState = bodyState;

    this.groundY = groundY;

    this.contactDistance =
      contactDistance;

    this.contactVelocityThreshold =
      contactVelocityThreshold;

    this._previousPosition =
      new THREE.Vector3();

    this._previousCOM =
      new THREE.Vector3();

    this._initialized = false;

    this._worldPosition =
      new THREE.Vector3();

    this._worldQuaternion =
      new THREE.Quaternion();

    this._localPosition =
      new THREE.Vector3();

    this._velocity =
      new THREE.Vector3();

    this._com =
      new THREE.Vector3();

    this._tmpA =
      new THREE.Vector3();

    this._tmpB =
      new THREE.Vector3();

    this._tmpC =
      new THREE.Vector3();

    this._contactsInitialized = false;

    this._initializeContacts();
  }

  _initializeContacts() {
    if (
      !this.bodyState.contacts ||
      !(this.bodyState.contacts instanceof Map)
    ) {
      this.bodyState.contacts =
        new Map();
    }

    this._ensureContact(
      "foot_L",
      "support"
    );

    this._ensureContact(
      "foot_R",
      "support"
    );

    this._ensureContact(
      "hand_L",
      "manipulation"
    );

    this._ensureContact(
      "hand_R",
      "manipulation"
    );

    this._contactsInitialized = true;
  }

  _ensureContact(
    bone,
    type
  ) {
    const id =
      `contact_${bone}`;

    if (
      this.bodyState.contacts.has(id)
    ) {
      return;
    }

    this.bodyState.contacts.set(
      id,
      new ContactState({
        id,
        bone,
        type,
      })
    );
  }

  _findBone(logicalName) {
    const canonicalName =
      BONE_MAP[logicalName];

    if (!canonicalName) {
      return null;
    }

    return this.root.getObjectByName(
      canonicalName
    );
  }

  _readBonePosition(
    logicalName,
    target
  ) {
    const bone =
      this._findBone(logicalName);

    if (!bone) {
      return null;
    }

    bone.getWorldPosition(target);

    return bone;
  }

  _measureRoot() {
    this.root.getWorldPosition(
      this._worldPosition
    );

    this.bodyState.setPosition(
      this._worldPosition
    );

    return this._worldPosition;
  }

  _measureVelocity(dt) {
    if (!this._initialized || dt <= 0) {
      this._velocity.set(0, 0, 0);

      this.bodyState.setVelocity(
        this._velocity
      );

      return;
    }

    this._velocity
      .copy(this.bodyState.position)
      .sub(this._previousPosition)
      .multiplyScalar(1 / dt);

    this.bodyState.setVelocity(
      this._velocity
    );
  }

  /*
   * Kinematic COM proxy.
   *
   * Это НЕ физический центр масс.
   *
   * Пока мы используем взвешенную
   * анатомическую модель:
   *
   * pelvis / spine / chest
   * arms
   * legs
   * head
   *
   * Позже сюда можно подключить
   * реальные mass properties.
   */
  _measureCOM() {
    const samples = [];

    this._addWeightedBone(
      samples,
      "pelvis",
      4.0
    );

    this._addWeightedBone(
      samples,
      "spine01",
      2.5
    );

    this._addWeightedBone(
      samples,
      "spine02",
      3.0
    );

    this._addWeightedBone(
      samples,
      "chest",
      3.0
    );

    this._addWeightedBone(
      samples,
      "neck",
      0.7
    );

    this._addWeightedBone(
      samples,
      "head",
      1.0
    );

    this._addWeightedBone(
      samples,
      "upperArm_L",
      1.0
    );

    this._addWeightedBone(
      samples,
      "foreArm_L",
      0.7
    );

    this._addWeightedBone(
      samples,
      "hand_L",
      0.35
    );

    this._addWeightedBone(
      samples,
      "upperArm_R",
      1.0
    );

    this._addWeightedBone(
      samples,
      "foreArm_R",
      0.7
    );

    this._addWeightedBone(
      samples,
      "hand_R",
      0.35
    );

    this._addWeightedBone(
      samples,
      "thigh_L",
      2.0
    );

    this._addWeightedBone(
      samples,
      "shin_L",
      1.2
    );

    this._addWeightedBone(
      samples,
      "foot_L",
      0.5
    );

    this._addWeightedBone(
      samples,
      "thigh_R",
      2.0
    );

    this._addWeightedBone(
      samples,
      "shin_R",
      1.2
    );

    this._addWeightedBone(
      samples,
      "foot_R",
      0.5
    );

    if (!samples.length) {
      this._com.set(0, 0, 0);

      this.bodyState.setCOM(
        this._com
      );

      return;
    }

    this._com.set(0, 0, 0);

    let totalWeight = 0;

    for (const sample of samples) {
      this._com.addScaledVector(
        sample.position,
        sample.weight
      );

      totalWeight += sample.weight;
    }

    if (totalWeight > 0) {
      this._com.multiplyScalar(
        1 / totalWeight
      );
    }

    this.bodyState.setCOM(
      this._com
    );
  }

  _addWeightedBone(
    samples,
    logicalName,
    weight
  ) {
    const bone =
      this._findBone(logicalName);

    if (!bone) {
      return;
    }

    const position =
      new THREE.Vector3();

    bone.getWorldPosition(
      position
    );

    samples.push({
      position,
      weight,
    });
  }

  _measureCOMVelocity(dt) {
    if (
      !this._initialized ||
      dt <= 0
    ) {
      this.bodyState.comVelocity.set(
        0,
        0,
        0
      );

      return;
    }

    this.bodyState.comVelocity
      .copy(this.bodyState.com)
      .sub(this._previousCOM)
      .multiplyScalar(1 / dt);
  }

  _measureContact(
    logicalBone,
    contactId
  ) {
    const contact =
      this.bodyState.contacts.get(
        contactId
      );

    if (!contact) {
      return;
    }

    const bone =
      this._findBone(
        logicalBone
      );

    if (!bone) {
      contact.release();
      return;
    }

    const position =
      this._tmpA;

    bone.getWorldPosition(
      position
    );

    const distance =
      Math.abs(
        position.y - this.groundY
      );

    const nearGround =
      distance <=
      this.contactDistance;

    const verticalVelocity =
      Math.abs(
        this.bodyState.velocity.y
      );

    const stableEnough =
      verticalVelocity <=
      this.contactVelocityThreshold;

    if (
      nearGround &&
      stableEnough
    ) {
      const point =
        this._tmpB.copy(
          position
        );

      point.y =
        this.groundY;

      contact.plant({
        point,
        normal:
          this._tmpC.set(
            0,
            1,
            0
          ),
      });

      contact.isSupport = true;

      return;
    }

    if (
      contact.isPlanted()
    ) {
      contact.break();
      return;
    }

    contact.release();
  }

  _measureContacts() {
    this._measureContact(
      "foot_L",
      "contact_foot_L"
    );

    this._measureContact(
      "foot_R",
      "contact_foot_R"
    );

    /*
     * Hands are intentionally NOT treated
     * as floor support.
     *
     * Their actual environmental contact
     * will later come from Perception /
     * Contact Provider.
     *
     * We initialize their state here,
     * but do not invent a hand contact.
     */
  }

  update(dt) {
    if (
      !Number.isFinite(dt) ||
      dt < 0
    ) {
      throw new Error(
        "BodyStateBinder.update: invalid dt"
      );
    }

    /*
     * Critical rule:
     *
     * We read AFTER the skeleton has
     * reached its current pose.
     *
     * Binder never writes bone transforms.
     */
    this.root.updateMatrixWorld(
      true
    );

    this._measureRoot();

    this._measureVelocity(dt);

    this._measureCOM();

    this._measureCOMVelocity(dt);

    this._measureContacts();

    /*
     * BodyState performs the derived
     * support polygon / balance calculation.
     */
    this.bodyState.update(dt);

    this._previousPosition.copy(
      this.bodyState.position
    );

    this._previousCOM.copy(
      this.bodyState.com
    );

    this._initialized = true;

    return this.bodyState;
  }

  getBodyState() {
    return this.bodyState;
  }

  getContact(id) {
    return this.bodyState.contacts.get(
      id
    ) || null;
  }

  getContacts() {
    return this.bodyState.contacts;
  }
}
