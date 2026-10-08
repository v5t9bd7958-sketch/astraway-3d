import {
  TASK_TYPE,
  TASK_PRIORITY,
  Task,
} from "./Task.js";

export class ContactTaskGenerator {
  constructor({
    taskSet,
  }) {
    if (!taskSet) {
      throw new Error(
        "ContactTaskGenerator: taskSet required"
      );
    }

    this.taskSet =
      taskSet;
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
      this.updateContact(
        contact
      );
    }

    return this.taskSet;
  }

  updateContact(
    contact
  ) {
    if (!contact?.id) {
      return;
    }

    const taskId =
      `maintain:${contact.id}`;

    /*
     * Только PLANTED контакт
     * становится задачей
     * удержания.
     *
     * CANDIDATE:
     * ещё только возможность.
     *
     * ESTABLISHED:
     * задача/решатель подтвердили
     * достижимость.
     *
     * PLANTED:
     * фактически измеренный контакт.
     */
    if (
      contact.isPlanted()
    ) {
      const task =
        new Task({
          id: taskId,

          type:
            TASK_TYPE.CONTACT_MAINTAIN,

          source:
            contact.id,

          target:
            contact.point,

          priority:
            contact.isSupport
              ? TASK_PRIORITY.HIGH
              : TASK_PRIORITY.NORMAL,

          weight:
            contact.weight,

          hard:
            contact.isSupport,

          metadata: {
            bone:
              contact.bone.name,

            surfaceId:
              contact.surfaceId,

            normal:
              contact.normal.toArray(),

            contactPhase:
              contact.phase,

            isSupport:
              contact.isSupport,
          },
        });

      this.taskSet.upsert(
        task
      );

      return;
    }

    /*
     * Контакт больше не является
     * подтверждённым.
     *
     * Задача удаляется.
     */
    this.taskSet.remove(
      taskId
    );
  }
}
