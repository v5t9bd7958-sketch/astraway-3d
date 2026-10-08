// src/character/ContactTaskGenerator.js

import {
  TASK_TYPE,
  TASK_PRIORITY,
  Task,
} from "./Task.js";

/**
 * ContactTaskGenerator
 *
 * CONTACT STATE
 *      ↓
 *   TASK SET
 *
 * Responsibility:
 * - convert confirmed ContactState into ContactTask;
 * - remove task when contact is no longer planted.
 *
 * Does NOT:
 * - detect contact;
 * - plant contact;
 * - move bones;
 * - solve IK;
 * - choose gait;
 * - choose traversal;
 * - modify BodyState.
 *
 * Important:
 * contact.bone is a LOGICAL bone name:
 *
 *   "foot_L"
 *   "foot_R"
 *   "hand_L"
 *   "hand_R"
 *
 * It is NOT a THREE.Bone object.
 */

export class ContactTaskGenerator {
  constructor({
    taskSet,
  } = {}) {
    if (!taskSet) {
      throw new Error(
        "ContactTaskGenerator: taskSet required"
      );
    }

    this.taskSet = taskSet;
  }

  update(bodyState) {
    if (!bodyState) {
      throw new Error(
        "ContactTaskGenerator.update: bodyState required"
      );
    }

    for (
      const contact
      of bodyState.contacts.values()
    ) {
      this.updateContact(contact);
    }

    return this.taskSet;
  }

  updateContact(contact) {
    if (!contact?.id) {
      return;
    }

    const taskId =
      `maintain:${contact.id}`;

    /*
     * Only PLANTED contact becomes
     * a maintenance task.
     *
     * CANDIDATE:
     * possible contact.
     *
     * ESTABLISHED:
     * temporally confirmed evidence.
     *
     * PLANTED:
     * measured contact confirmed by
     * ContactState lifecycle.
     */
    if (!contact.isPlanted()) {
      this.taskSet.remove(taskId);
      return;
    }

    /*
     * ContactState.bone is intentionally
     * a logical identifier.
     *
     * NEVER use:
     *
     *   contact.bone.name
     *
     * because contact.bone is a string.
     */
    const logicalBone =
      typeof contact.bone === "string"
        ? contact.bone
        : null;

    if (!logicalBone) {
      /*
       * A planted contact without a logical
       * bone identity is structurally invalid.
       *
       * Do not create a malformed task.
       */
      this.taskSet.remove(taskId);

      return;
    }

    /*
     * Copy the measured target.
     *
     * ContactState.point is mutable and updated
     * by the lifecycle.
     *
     * Task must receive a stable value for this
     * frame rather than depending on the same
     * mutable Vector3 reference.
     */
    const target =
      contact.point?.clone
        ? contact.point.clone()
        : null;

    if (!target) {
      this.taskSet.remove(taskId);

      return;
    }

    /*
     * Normal is also copied because ContactState
     * owns the mutable Vector3.
     */
    const normal =
      contact.normal?.clone
        ? contact.normal.clone()
        : null;

    const task =
      new Task({
        id: taskId,

        type:
          TASK_TYPE.CONTACT_MAINTAIN,

        source:
          contact.id,

        target,

        priority:
          contact.isSupport
            ? TASK_PRIORITY.HIGH
            : TASK_PRIORITY.NORMAL,

        weight:
          Number.isFinite(
            contact.weight
          )
            ? contact.weight
            : 1,

        /*
         * Support contacts are hard.
         *
         * Manipulation contacts are currently
         * soft until their interaction model
         * is introduced.
         */
        hard:
          !!contact.isSupport,

        metadata: {
          /*
           * LOGICAL bone identity.
           *
           * TaskResolver uses this field
           * to detect multiple HARD tasks
           * targeting the same logical bone.
           */
          bone:
            logicalBone,

          surfaceId:
            contact.surfaceId,

          surfaceType:
            contact.surfaceType,

          normal:
            normal
              ? normal.toArray()
              : null,

          contactPhase:
            contact.phase,

          confidence:
            Number.isFinite(
              contact.confidence
            )
              ? contact.confidence
              : 0,

          separation:
            Number.isFinite(
              contact.separation
            )
              ? contact.separation
              : Infinity,

          probeCount:
            contact.probeCount || 0,

          nearProbeCount:
            contact.nearProbeCount || 0,

          probeAgreement:
            Number.isFinite(
              contact.probeAgreement
            )
              ? contact.probeAgreement
              : 0,

          isSupport:
            !!contact.isSupport,
        },
      });

    this.taskSet.upsert(task);

    return task;
  }
}

export default ContactTaskGenerator;
