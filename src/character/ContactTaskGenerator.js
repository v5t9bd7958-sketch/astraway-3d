
// src/character/ContactTaskGenerator.js

import {
  TASK_TYPE,
  TASK_PRIORITY,
  Task,
} from "./Task.js";

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

    for (const contact of bodyState.contacts.values()) {
      this.updateContact(contact);
    }

    return this.taskSet;
  }

  updateContact(contact) {
    if (!contact?.id) {
      return;
    }

    const taskId = `maintain:${contact.id}`;

    // Only confirmed planted contacts create maintenance tasks.
    if (!contact.isPlanted()) {
      this.taskSet.remove(taskId);
      return;
    }

    // ContactState.bone is a logical identifier, not THREE.Bone.
    const logicalBone =
      typeof contact.bone === "string"
        ? contact.bone
        : null;

    if (!logicalBone) {
      this.taskSet.remove(taskId);
      return;
    }

    /*
     * IMPORTANT:
     * target is the fixed world-space anchor.
     * point is the latest measured contact position
     * and must NOT be used as the maintenance target.
     */
    const target =
      contact.target?.clone
        ? contact.target.clone()
        : null;

    if (!target) {
      this.taskSet.remove(taskId);
      return;
    }

    const normal =
      contact.normal?.clone
        ? contact.normal.clone()
        : null;

    const task = new Task({
      id: taskId,

      type: TASK_TYPE.CONTACT_MAINTAIN,

      source: contact.id,

      target,

      priority:
        contact.isSupport
          ? TASK_PRIORITY.HIGH
          : TASK_PRIORITY.NORMAL,

      weight:
        Number.isFinite(contact.weight)
          ? contact.weight
          : 1,

      hard: !!contact.isSupport,

      metadata: {
        bone: logicalBone,

        surfaceId: contact.surfaceId,
        surfaceType: contact.surfaceType,

        normal:
          normal
            ? normal.toArray()
            : null,

        contactPhase: contact.phase,

        confidence:
          Number.isFinite(contact.confidence)
            ? contact.confidence
            : 0,

        separation:
          Number.isFinite(contact.separation)
            ? contact.separation
            : Infinity,

        probeCount: contact.probeCount || 0,
        nearProbeCount: contact.nearProbeCount || 0,

        probeAgreement:
          Number.isFinite(contact.probeAgreement)
            ? contact.probeAgreement
            : 0,

        isSupport: !!contact.isSupport,
      },
    });

    this.taskSet.upsert(task);

    return task;
  }
}

export default ContactTaskGenerator;
