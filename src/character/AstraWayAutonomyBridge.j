
// src/character/AstraWayAutonomyBridge.js
//
// AstraWay — Autonomy Bridge V1
//
// Connects:
// Procedural Human Locomotion
//        ↓
// Locomotion State
//        ↓
// AstraWay Surface / Contact / Terrain Perception
//        ↓
// Unified Read-Only Snapshot
//
// IMPORTANT:
// - Does not write bones.
// - Does not modify the donor's pose.
// - Does not run a second IK or locomotion solver.
// - human.update(dt) must be called by the runtime BEFORE this bridge.

import * as THREE from "three";

import { SurfaceQuery } from "./SurfaceQuery.js";
import { TerrainPerception } from "./TerrainPerception.js";
import { ContactPerception } from "./ContactPerception.js";
import { BodyState } from "./BodyState.js";
import { BodyStateBinder } from "./BodyStateBinder.js";
import { LocomotionIntentAdapter } from "./LocomotionIntentAdapter.js";

export class AstraWayAutonomyBridge {
  constructor({
    human,
    root,
    skeleton,
    skinnedMesh,
    walkableMeshes,
    initialForward,
    groundY = 0,
    terrainScanInterval = 250,
  } = {}) {
    if (!human?.locomotion?.feet) {
      throw new Error(
        "AstraWayAutonomyBridge: ProceduralHuman required"
      );
    }

    if (!root?.isObject3D) {
      throw new Error(
        "AstraWayAutonomyBridge: character root required"
      );
    }

    if (!skeleton?.bones?.length) {
      throw new Error(
        "AstraWayAutonomyBridge: skeleton required"
      );
    }

    if (!skinnedMesh?.isSkinnedMesh) {
      throw new Error(
        "AstraWayAutonomyBridge: SkinnedMesh required"
      );
    }

    if (!Array.isArray(walkableMeshes) ||
        walkableMeshes.length === 0) {
      throw new Error(
        "AstraWayAutonomyBridge: walkable meshes required"
      );
    }

    if (!initialForward?.isVector3 ||
        initialForward.lengthSq() < 1e-8) {
      throw new Error(
        "AstraWayAutonomyBridge: initialForward must be a non-zero Vector3"
      );
    }

    this.human = human;
    this.root = root;
    this.skeleton = skeleton;
    this.skinnedMesh = skinnedMesh;

    this.walkableMeshes = [...walkableMeshes];

    this.terrainScanInterval = Math.max(
      100,
      Number.isFinite(terrainScanInterval)
        ? terrainScanInterval
        : 250
    );

    this.frame = 0;
    this.lastTerrainScanAt = -Infinity;
    this.lastSnapshot = null;
    this.terrainSummary = null;

    this._worldPosition = new THREE.Vector3();
    this._worldQuaternion = new THREE.Quaternion();
    this._forward = new THREE.Vector3();

    // Preserve the character's original forward axis
    // in root-local coordinates.
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(this._worldQuaternion);

    this._localForward = initialForward
      .clone()
      .normalize()
      .applyQuaternion(
        this._worldQuaternion.clone().invert()
      )
      .normalize();

    // Geometric world observation.
    this.surfaceQuery = new SurfaceQuery({
      groundY,
      defaultSurfaceId: "world_surface",
      defaultSurfaceType: "walkable",
      meshes: this.walkableMeshes,
    });

    // Local terrain sampling.
    this.terrainPerception = new TerrainPerception({
      surfaceQuery: this.surfaceQuery,
    });

    // Foot contact evidence.
    this.contactPerception = new ContactPerception({
      root,
      skeleton,
      skinnedMesh,
      surfaceQuery: this.surfaceQuery,
      contactSeparation: 0.035,
      minConfidence: 0.4,
    });

    this.contactPerception.initialize();

    // Body and contact lifecycle.
    this.bodyState = new BodyState();

    this.bodyStateBinder = new BodyStateBinder({
      root,
      skeleton,
      skinnedMesh,
      bodyState: this.bodyState,
      groundY,
      contactDistance: 0.08,
      contactVelocityThreshold: 0.35,
      contactPerception: this.contactPerception,
    });

    // Read-only access to donor locomotion state.
    this.locomotionAdapter =
      new LocomotionIntentAdapter({ human });

    console.log("[AstraWay] Autonomy Bridge initialized", {
      walkableMeshes: this.walkableMeshes.length,
      footProbes: this.contactPerception.getProbeCount("foot_L") +
        this.contactPerception.getProbeCount("foot_R"),
      terrainScanInterval: this.terrainScanInterval,
    });
  }

  setWalkableMeshes(meshes) {
    if (!Array.isArray(meshes)) {
      throw new TypeError(
        "setWalkableMeshes: array required"
      );
    }

    this.walkableMeshes = meshes.filter(
      mesh => mesh?.isMesh || mesh?.isObject3D
    );

    this.surfaceQuery.setMeshes(
      this.walkableMeshes
    );

    return this.walkableMeshes.length;
  }

  addWalkableMesh(mesh) {
    if (!mesh?.isMesh && !mesh?.isObject3D) {
      throw new TypeError(
        "addWalkableMesh: THREE.Object3D required"
      );
    }

    if (!this.walkableMeshes.includes(mesh)) {
      this.walkableMeshes.push(mesh);
      this.surfaceQuery.addMesh(mesh);
    }

    return this.walkableMeshes.length;
  }

  removeWalkableMesh(mesh) {
    this.walkableMeshes =
      this.walkableMeshes.filter(
        item => item !== mesh
      );

    this.surfaceQuery.setMeshes(
      this.walkableMeshes
    );

    return this.walkableMeshes.length;
  }

  _updateForward() {
    this.root.getWorldQuaternion(
      this._worldQuaternion
    );

    this._forward
      .copy(this._localForward)
      .applyQuaternion(this._worldQuaternion)
      .setY(0);

    if (this._forward.lengthSq() < 1e-8) {
      this._forward.set(0, 0, -1);
    } else {
      this._forward.normalize();
    }

    return this._forward;
  }

  _scanTerrain(now) {
    if (
      now - this.lastTerrainScanAt <
      this.terrainScanInterval
    ) {
      return this.terrainSummary;
    }

    this.lastTerrainScanAt = now;

    this.root.getWorldPosition(
      this._worldPosition
    );

    this.terrainSummary =
      this.terrainPerception.scan({
        origin: this._worldPosition,
        forward: this._updateForward(),
      });

    return this.terrainSummary;
  }

  _readBodySnapshot() {
    const state = this.bodyState;

    return {
      position: state.position.toArray(),
      velocity: state.velocity.toArray(),
      centerOfMass: state.com.toArray(),

      supportCount: state.supportCount,
      grounded: state.grounded,
      stable: state.stable,

      balanceError: state.balanceError,

      contacts: {
        left: this._readContact("contact_foot_L"),
        right: this._readContact("contact_foot_R"),
      },
    };
  }

  _readContact(id) {
    const contact = this.bodyState.contacts.get(id);

    if (!contact) return null;

    return {
      phase: contact.phase,
      planted: !!contact.isPlanted?.(),
      support: !!contact.isSupport,
      confidence: Number.isFinite(contact.confidence)
        ? contact.confidence
        : 0,
    };
  }

  update(dt, now = performance.now()) {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new TypeError(
        "AstraWayAutonomyBridge.update: invalid dt"
      );
    }

    // Donor pose is already updated by the application loop.
    // We only observe the resulting body and environment.
    this.root.updateMatrixWorld(true);

    this.bodyStateBinder.update(dt);

    const locomotion =
      this.locomotionAdapter.sample();

    const terrain =
      this._scanTerrain(now);

    this.lastSnapshot = {
      frame: ++this.frame,
      timestamp: now,

      locomotion,

      body: this._readBodySnapshot(),

      terrain: terrain
        ? {
            validCount: terrain.validCount,
            missingCount: terrain.missingCount,
            steepCount: terrain.steepCount,
            discontinuityCount:
              terrain.discontinuityCount,
            centerHeight: terrain.centerHeight,
          }
        : null,
    };

    return this.lastSnapshot;
  }

  getSnapshot() {
    return this.lastSnapshot;
  }

  getTerrainSummary() {
    return this.terrainSummary;
  }

  getDiagnostics() {
    return {
      frame: this.frame,

      walkableMeshes:
        this.walkableMeshes.length,

      leftFootProbes:
        this.contactPerception.getProbeCount("foot_L"),

      rightFootProbes:
        this.contactPerception.getProbeCount("foot_R"),

      terrain:
        this.terrainSummary,

      body:
        this._readBodySnapshot(),

      locomotion:
        this.locomotionAdapter.getLastSnapshot(),
    };
  }
}

export default AstraWayAutonomyBridge;
