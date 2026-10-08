// src/character/BodyStateBinder.js

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
 * WORLD / SKELETON OBSERVATION
 *          ↓
 *   ContactPerception
 *          ↓
 *   ContactEvidence
 *          ↓
 *   ContactState
 *          ↓
 *      BodyState
 *
 * Binder НЕ:
 * - двигает кости;
 * - вызывает IK;
 * - выбирает gait;
 * - выбирает traversal;
 * - создаёт задачи;
 * - создаёт constraints;
 * - решает контакт по bone Y;
 * - вызывает plant() на основании собственной геометрии.
 *
 * Binder только:
 * - измеряет root;
 * - измеряет velocity;
 * - измеряет COM;
 * - принимает ContactEvidence;
 * - передаёт evidence в ContactState;
 * - обновляет BodyState.
 */

export class BodyStateBinder {
  constructor({
    root,
    skeleton,
    skinnedMesh = null,
    bodyState,
    groundY = 0,

    contactDistance = 0.045,
    contactVelocityThreshold = 0.35,

    contactPerception = null,
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

    if (!contactPerception) {
      throw new Error(
        "BodyStateBinder: contactPerception required"
      );
    }

    this.root = root;
    this.skeleton = skeleton;
    this.skinnedMesh = skinnedMesh;
    this.bodyState = bodyState;

    this.groundY = groundY;

    /*
     * Эти параметры пока сохраняем как часть публичного API.
     *
     * ВАЖНО:
     * они больше НЕ принимают решение о контакте.
     *
     * Контакт определяется через ContactPerception.
     */
    this.contactDistance =
      contactDistance;

    this.contactVelocityThreshold =
      contactVelocityThreshold;

    this.contactPerception =
      contactPerception;

    /*
     * Diagnostics only.
     *
     * Никакого влияния на lifecycle.
     */
    this.diagnostics = {
      left: this._createFootDiagnostics(),
      right: this._createFootDiagnostics(),
    };

    /*
     * Persistent scratch.
     *
     * Никаких новых Vector3 в update().
     */
    this._previousPosition =
      new THREE.Vector3();

    this._previousCOM =
      new THREE.Vector3();

    this._worldPosition =
      new THREE.Vector3();

    this._velocity =
      new THREE.Vector3();

    this._com =
      new THREE.Vector3();

    this._bonePosition =
      new THREE.Vector3();

    this._initialized = false;

    this._contactsInitialized = false;

    this._initializeContacts();
  }

  _createFootDiagnostics() {
    return {
      footY: NaN,
      groundY: this.groundY,
      dy: Infinity,

      footSurfaceY: NaN,
      footSurfaceDy: Infinity,
      footSurfaceVertices: 0,

      verticalVelocity: 0,

      nearGround: false,
      stableEnough: false,

      evidenceValid: false,
      confidence: 0,
      separation: Infinity,

      probeCount: 0,
      nearProbeCount: 0,
      probeAgreement: 0,

      surfaceId: null,
      surfaceType: null,

      phase: "none",
    };
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
    if (
      !this._initialized ||
      dt <= 0
    ) {
      this._velocity.set(
        0,
        0,
        0
      );

      this.bodyState.setVelocity(
        this._velocity
      );

      return;
    }

    this._velocity
      .copy(this.bodyState.position)
      .sub(this._previousPosition)
      .multiplyScalar(
        1 / dt
      );

    this.bodyState.setVelocity(
      this._velocity
    );
  }

  /*
   * Kinematic COM proxy.
   *
   * Это пока НЕ физический центр масс.
   *
   * Важное изменение:
   * здесь больше нет массива samples
   * и новых Vector3 на каждый кадр.
   */
  _measureCOM() {
    this._com.set(
      0,
      0,
      0
    );

    let totalWeight = 0;

    totalWeight += this._accumulateBone(
      "pelvis",
      4.0
    );

    totalWeight += this._accumulateBone(
      "spine01",
      2.5
    );

    totalWeight += this._accumulateBone(
      "spine02",
      3.0
    );

    totalWeight += this._accumulateBone(
      "chest",
      3.0
    );

    totalWeight += this._accumulateBone(
      "neck",
      0.7
    );

    totalWeight += this._accumulateBone(
      "head",
      1.0
    );

    totalWeight += this._accumulateBone(
      "upperArm_L",
      1.0
    );

    totalWeight += this._accumulateBone(
      "foreArm_L",
      0.7
    );

    totalWeight += this._accumulateBone(
      "hand_L",
      0.35
    );

    totalWeight += this._accumulateBone(
      "upperArm_R",
      1.0
    );

    totalWeight += this._accumulateBone(
      "foreArm_R",
      0.7
    );

    totalWeight += this._accumulateBone(
      "hand_R",
      0.35
    );

    totalWeight += this._accumulateBone(
      "thigh_L",
      2.0
    );

    totalWeight += this._accumulateBone(
      "shin_L",
      1.2
    );

    totalWeight += this._accumulateBone(
      "foot_L",
      0.5
    );

    totalWeight += this._accumulateBone(
      "thigh_R",
      2.0
    );

    totalWeight += this._accumulateBone(
      "shin_R",
      1.2
    );

    totalWeight += this._accumulateBone(
      "foot_R",
      0.5
    );

    if (totalWeight > 0) {
      this._com.multiplyScalar(
        1 / totalWeight
      );
    } else {
      this._com.set(
        0,
        0,
        0
      );
    }

    this.bodyState.setCOM(
      this._com
    );
  }

  _accumulateBone(
    logicalName,
    weight
  ) {
    const bone =
      this._findBone(
        logicalName
      );

    if (!bone) {
      return 0;
    }

    bone.getWorldPosition(
      this._bonePosition
    );

    this._com.addScaledVector(
      this._bonePosition,
      weight
    );

    return weight;
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
      .multiplyScalar(
        1 / dt
      );
  }

  /*
   * -------------------------------------------------------
   * CONTACT PERCEPTION → CONTACT STATE
   * -------------------------------------------------------
   *
   * Это теперь единственный путь,
   * которым perception влияет на ContactState.
   *
   * ContactPerception:
   *   измеряет.
   *
   * ContactState:
   *   применяет temporal lifecycle.
   *
   * BodyState:
   *   строит support polygon / balance.
   */

  _applyFootEvidence(
    logicalBone,
    contactId,
    evidence,
    diagnostics
  ) {
    const contact =
      this.bodyState.contacts.get(
        contactId
      );

    if (!contact) {
      return;
    }

    /*
     * Evidence → lifecycle.
     *
     * Binder НЕ решает:
     * candidate / established / planted.
     *
     * Это ответственность ContactState.
     */
    contact.applyEvidence(
      evidence,
      this._lastDt
    );

    /*
     * Support classification.
     *
     * Это пока статическая роль контакта:
     * foot contacts являются support-capable.
     *
     * PLANTED уже определяется ContactState.
     */
    contact.isSupport =
      contact.type === "support";

    /*
     * Diagnostics.
     */
    if (diagnostics) {
      diagnostics.evidenceValid =
        !!evidence?.valid;

      diagnostics.confidence =
        Number.isFinite(
          evidence?.confidence
        )
          ? evidence.confidence
          : 0;

      diagnostics.separation =
        Number.isFinite(
          evidence?.separation
        )
          ? evidence.separation
          : Infinity;

      diagnostics.probeCount =
        evidence?.probeCount || 0;

      diagnostics.nearProbeCount =
        evidence?.nearProbeCount || 0;

      diagnostics.probeAgreement =
        Number.isFinite(
          evidence?.probeAgreement
        )
          ? evidence.probeAgreement
          : 0;

      diagnostics.surfaceId =
        evidence?.surfaceId ?? null;

      diagnostics.surfaceType =
        evidence?.surfaceType ?? null;

      diagnostics.phase =
        contact.phase;
    }

    /*
     * IMPORTANT:
     *
     * No contact.plant() here.
     * No contact.break() here.
     * No contact.release() here.
     *
     * ContactState owns lifecycle.
     */
  }

  _updateContactDiagnostics(
    logicalBone,
    diagnostics
  ) {
    if (!diagnostics) {
      return;
    }

    const bone =
      this._findBone(
        logicalBone
      );

    if (!bone) {
      diagnostics.footY = NaN;
      diagnostics.dy = Infinity;

      diagnostics.nearGround =
        false;

      diagnostics.stableEnough =
        false;

      return;
    }

    bone.getWorldPosition(
      this._bonePosition
    );

    diagnostics.footY =
      this._bonePosition.y;

    diagnostics.groundY =
      this.groundY;

    diagnostics.dy =
      Math.abs(
        this._bonePosition.y -
        this.groundY
      );

    diagnostics.verticalVelocity =
      Math.abs(
        this.bodyState.velocity.y
      );

    /*
     * These two fields remain diagnostic only.
     *
     * They are deliberately NOT used to establish
     * or release contact.
     */
    diagnostics.nearGround =
      diagnostics.dy <=
      this.contactDistance;

    diagnostics.stableEnough =
      diagnostics.verticalVelocity <=
      this.contactVelocityThreshold;
  }

  _updateContactDiagnosticsFromEvidence(
    evidence,
    diagnostics
  ) {
    if (
      !evidence ||
      !diagnostics
    ) {
      return;
    }

    /*
     * Evidence point is the measured surface point.
     *
     * This is the correct geometry-space observation.
     */
    diagnostics.footSurfaceY =
      Number.isFinite(
        evidence.point?.y
      )
        ? evidence.point.y
        : NaN;

    diagnostics.footSurfaceDy =
      Number.isFinite(
        evidence.separation
      )
        ? Math.abs(
            evidence.separation
          )
        : Infinity;

    /*
     * ContactPerception currently does not expose
     * its internal vertex count.
     *
     * Keep this field for compatibility.
     */
    diagnostics.footSurfaceVertices =
      evidence.probeCount || 0;
  }

  _measureContacts(dt) {
    this._lastDt = dt;

    /*
     * Perception is measured ONCE per frame.
     */
    const evidence =
      this.contactPerception.update(
        this.bodyState.time
      );

    /*
     * Foot L.
     */
    this._applyFootEvidence(
      "foot_L",
      "contact_foot_L",
      evidence?.left || null,
      this.diagnostics.left
    );

    this._updateContactDiagnostics(
      "foot_L",
      this.diagnostics.left
    );

    this._updateContactDiagnosticsFromEvidence(
      evidence?.left || null,
      this.diagnostics.left
    );

    /*
     * Foot R.
     */
    this._applyFootEvidence(
      "foot_R",
      "contact_foot_R",
      evidence?.right || null,
      this.diagnostics.right
    );

    this._updateContactDiagnostics(
      "foot_R",
      this.diagnostics.right
    );

    this._updateContactDiagnosticsFromEvidence(
      evidence?.right || null,
      this.diagnostics.right
    );

    /*
     * Hands intentionally remain untouched.
     *
     * They will later receive their own perception
     * provider when arbitrary surface interaction exists.
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
     * Critical observation order:
     *
     * current pose
     *      ↓
     * world matrices
     *      ↓
     * perception
     *      ↓
     * contact lifecycle
     *      ↓
     * BodyState derived state
     *
     * Binder never writes bone transforms.
     */
    this.root.updateMatrixWorld(
      true
    );

    this._measureRoot();

    this._measureVelocity(
      dt
    );

    this._measureCOM();

    this._measureCOMVelocity(
      dt
    );

    this._measureContacts(
      dt
    );

    /*
     * BodyState.update() advances ContactState
     * temporal phase timers and rebuilds:
     *
     * support points
     * support polygon
     * balance
     */
    this.bodyState.update(
      dt
    );

    /*
     * Diagnostics must expose the final phase,
     * after BodyState has advanced lifecycle.
     */
    const left =
      this.bodyState.contacts.get(
        "contact_foot_L"
      );

    const right =
      this.bodyState.contacts.get(
        "contact_foot_R"
      );

    if (left) {
      this.diagnostics.left.phase =
        left.phase;
    }

    if (right) {
      this.diagnostics.right.phase =
        right.phase;
    }

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
    return (
      this.bodyState.contacts.get(
        id
      ) || null
    );
  }

  getContacts() {
    return this.bodyState.contacts;
  }

  getDiagnostics() {
    return this.diagnostics;
  }
}

export default BodyStateBinder;
