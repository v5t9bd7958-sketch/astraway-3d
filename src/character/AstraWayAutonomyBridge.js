
import * as THREE from "three";
import { LocomotionIntentAdapter } from "./LocomotionIntentAdapter.js";

/**
 * AstraWay Autonomy Bridge
 *
 * Coordinates:
 * - donor locomotion on an isolated proxy skeleton;
 * - world-transform synchronization to the visible character;
 * - contact ownership handoff;
 * - production task/constraint/solver pipeline.
 *
 * The donor never writes to the visible character.
 * PoseWriter remains the only production bone writer.
 */
export class AstraWayAutonomyBridge {
  constructor({
    autonomyAgent,
    human,
    proxyRoot,
    visibleRoot,

    bodyState,
    bodyStateBinder,

    contactTaskGenerator,
    locomotionTaskGenerator,

    taskResolver,
    taskConstraintBuilder,
    constraintSolver,
    poseWriter,
  } = {}) {
    const required = {
      autonomyAgent,
      human,
      proxyRoot,
      visibleRoot,
      bodyState,
      bodyStateBinder,
      contactTaskGenerator,
      locomotionTaskGenerator,
      taskResolver,
      taskConstraintBuilder,
      constraintSolver,
      poseWriter,
    };

    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length) {
      throw new Error(
        `AstraWayAutonomyBridge: missing dependencies: ${missing.join(", ")}`
      );
    }

    if (
      typeof autonomyAgent.update !== "function" ||
      typeof autonomyAgent.setGoal !== "function" ||
      typeof autonomyAgent.stop !== "function"
    ) {
      throw new TypeError(
        "AstraWayAutonomyBridge: invalid AutonomyAgent"
      );
    }

    if (
      !proxyRoot.isObject3D ||
      !visibleRoot.isObject3D
    ) {
      throw new TypeError(
        "AstraWayAutonomyBridge: proxyRoot and visibleRoot must be Object3D"
      );
    }

    this.autonomyAgent = autonomyAgent;
    this.human = human;

    this.proxyRoot = proxyRoot;
    this.visibleRoot = visibleRoot;

    this.bodyState = bodyState;
    this.bodyStateBinder = bodyStateBinder;

    this.contactTaskGenerator = contactTaskGenerator;
    this.locomotionTaskGenerator = locomotionTaskGenerator;

    this.taskResolver = taskResolver;
    this.taskConstraintBuilder = taskConstraintBuilder;
    this.constraintSolver = constraintSolver;
    this.poseWriter = poseWriter;

    this.intentAdapter = new LocomotionIntentAdapter({
      human,
    });

    this.frame = 0;
    this.lastSnapshot = null;
    this.lastResult = null;

    this._proxyPosition = new THREE.Vector3();
    this._proxyQuaternion = new THREE.Quaternion();

    this._visibleLocalPosition = new THREE.Vector3();
    this._visibleLocalQuaternion = new THREE.Quaternion();
    this._parentQuaternion = new THREE.Quaternion();

    this._initialized = false;
    this._disposed = false;

    this._syncVisibleRoot();

    console.log(
      "[AstraWay] AUTONOMY BRIDGE CREATED",
      {
        proxyRoot: proxyRoot.name,
        visibleRoot: visibleRoot.name,
        productionBoneWriter: "PoseWriter",
      }
    );
  }

  setGoal(target, options = {}) {
    this._assertActive();
    return this.autonomyAgent.setGoal(target, options);
  }

  setMode(mode) {
    this._assertActive();
    return this.autonomyAgent.setMode(mode);
  }

  stop() {
    this._assertActive();
    return this.autonomyAgent.stop();
  }

  /**
   * One authoritative frame.
   *
   * 1. Advance donor simulation.
   * 2. Synchronize root transform.
   * 3. Read donor locomotion intent.
   * 4. Release production foot contacts during donor swing.
   * 5. Perceive visible production character.
   * 6. Generate contact and locomotion tasks.
   * 7. Resolve, solve and write production pose.
   */
  update(dt) {
    this._assertActive();

    if (!Number.isFinite(dt) || dt <= 0) {
      return this.lastResult;
    }

    // Donor update is owned exclusively by AutonomyAgent.
    const autonomyState =
      this.autonomyAgent.update(dt);

    // Donor BodyController moves proxyRoot in world space.
    this._syncVisibleRoot();

    // Read-only snapshot. No bone or transform writes.
    const snapshot =
      this.intentAdapter.sample();

    // Release before perception so swing feet cannot remain
    // authoritative planted contacts in this frame.
    this._releaseSwingContacts(snapshot);

    // Production perception reads only the visible character.
    this.bodyStateBinder.update(dt);

    // Both generators write into the same TaskSet.
    this.contactTaskGenerator.update(
      this.bodyState
    );

    const locomotionTasks =
      this.locomotionTaskGenerator.update(
        snapshot
      );

    const taskPlan =
      this.taskResolver.resolve(
        this.contactTaskGenerator.taskSet
      );

    this.taskConstraintBuilder.update(
      taskPlan
    );

    const solverResult =
      this.constraintSolver.solve(
        this.taskConstraintBuilder.constraintSet
      );

    // Sole production bone writer.
    const poseResult =
      this.poseWriter.write(
        solverResult
      );

    this.visibleRoot.updateMatrixWorld(true);

    this.frame++;

    this.lastSnapshot = snapshot;

    this.lastResult = {
      frame: this.frame,
      autonomy: autonomyState,
      locomotionTasks,
      taskPlan,
      solverResult,
      poseResult,
      bodyState: this.bodyState.snapshot(),
    };

    this._initialized = true;

    return this.lastResult;
  }

  /**
   * Copy proxy world position and rotation to the visible root.
   * Scale and child transforms are intentionally not copied.
   *
   * Both skeletons must have been cloned from the same normalized
   * source hierarchy and share the same world coordinate system.
   */
  _syncVisibleRoot() {
    this.proxyRoot.updateWorldMatrix(true, false);

    this.proxyRoot.getWorldPosition(
      this._proxyPosition
    );

    this.proxyRoot.getWorldQuaternion(
      this._proxyQuaternion
    );

    const parent = this.visibleRoot.parent;

    if (parent) {
      parent.updateWorldMatrix(true, false);

      this._visibleLocalPosition.copy(
        this._proxyPosition
      );

      parent.worldToLocal(
        this._visibleLocalPosition
      );

      parent.getWorldQuaternion(
        this._parentQuaternion
      );

      this._visibleLocalQuaternion
        .copy(this._parentQuaternion)
        .invert()
        .multiply(this._proxyQuaternion);
    } else {
      this._visibleLocalPosition.copy(
        this._proxyPosition
      );

      this._visibleLocalQuaternion.copy(
        this._proxyQuaternion
      );
    }

    this.visibleRoot.position.copy(
      this._visibleLocalPosition
    );

    this.visibleRoot.quaternion.copy(
      this._visibleLocalQuaternion
    );

    this.visibleRoot.updateMatrixWorld(true);
  }

  /**
   * Donor phase owns the decision to release a foot.
   * ContactPerception still owns re-establishment after landing.
   *
   * Hands and unrelated contacts are never modified here.
   */
  _releaseSwingContacts(snapshot) {
    const phases = [
      {
        side: "left",
        id: "contact_foot_L",
      },
      {
        side: "right",
        id: "contact_foot_R",
      },
    ];

    for (const item of phases) {
      const foot = snapshot.feet?.[item.side];

      if (
        foot?.phase !== "LIFT" &&
        foot?.phase !== "SWING"
      ) {
        continue;
      }

      const contact =
        this.bodyStateBinder.getContact(item.id);

      if (contact) {
        contact.release();
      }
    }
  }

  getState() {
    this._assertActive();

    return {
      frame: this.frame,
      initialized: this._initialized,
      autonomy: this.autonomyAgent.getState(),
      locomotion: this.lastSnapshot,
      locomotionTasks:
        this.locomotionTaskGenerator.getState(),
      bodyState: this.bodyState.snapshot(),
      solver: this.constraintSolver.getStats(),
      writer: this.poseWriter.snapshot(),
    };
  }

  dispose() {
    if (this._disposed) return;

    this.autonomyAgent.dispose?.();
    this.locomotionTaskGenerator.clear();

    this.intentAdapter.reset();

    this.lastSnapshot = null;
    this.lastResult = null;

    this._disposed = true;
  }

  _assertActive() {
    if (this._disposed) {
      throw new Error(
        "AstraWayAutonomyBridge: bridge has been disposed"
      );
    }
  }
}

export default AstraWayAutonomyBridge;
