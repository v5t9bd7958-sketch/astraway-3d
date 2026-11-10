// src/character/SurfaceQuery.js

import * as THREE from "three";

/**
 * SurfaceQuery
 *
 * Universal surface-query interface for the Character Core.
 *
 * Backends:
 *   - ground-plane  (default, infinite horizontal plane)
 *   - mesh          (THREE.Mesh / Object3D via Raycaster)
 *
 * IMPORTANT:
 * SurfaceQuery does NOT decide whether a character wants to touch,
 * stand, grip, climb, hang, etc.
 *
 * It answers only:
 *   "What surface exists at / along this query?"
 *
 * ContactPerception owns interpretation of multiple queries.
 */
export class SurfaceQuery {
  static BACKEND_GROUND = "ground-plane";
  static BACKEND_MESH   = "mesh";

  constructor({
    groundY = 0,
    defaultSurfaceId = "ground",
    defaultSurfaceType = "ground",
    epsilon = 1e-6,
    meshes = null,
  } = {}) {
    if (!Number.isFinite(groundY)) {
      throw new TypeError("SurfaceQuery: groundY must be finite");
    }
    if (!Number.isFinite(epsilon) || epsilon <= 0) {
      throw new TypeError("SurfaceQuery: epsilon must be > 0");
    }

    this.groundY = groundY;
    this.defaultSurfaceId = defaultSurfaceId;
    this.defaultSurfaceType = defaultSurfaceType;
    this.epsilon = epsilon;

    // Mesh backend
    this._meshes = [];
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = Infinity;
    this._hits = [];
    this._normalMatrix = new THREE.Matrix3();

    if (meshes) {
      this.setMeshes(meshes);
    }

    this._result = {
      valid: false,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      separation: 0,
      distance: Infinity,
      surfaceId: null,
      surfaceType: null,
      confidence: 0,
      backend: SurfaceQuery.BACKEND_GROUND,
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(),
    };

    this._origin = new THREE.Vector3();
    this._direction = new THREE.Vector3();
  }

  setMeshes(meshes) {
    this._meshes.length = 0;
    if (!meshes) return this;

    const list = Array.isArray(meshes) ? meshes : [meshes];
    for (const obj of list) {
      if (obj && (obj.isMesh || obj.isObject3D)) {
        this._meshes.push(obj);
      }
    }
    return this;
  }

  addMesh(mesh) {
    if (mesh && (mesh.isMesh || mesh.isObject3D)) {
      this._meshes.push(mesh);
    }
    return this;
  }

  clearMeshes() {
    this._meshes.length = 0;
    return this;
  }

  hasMeshes() {
    return this._meshes.length > 0;
  }

  query({
    origin,
    direction,
    maxDistance = Infinity,
    filter = null,
    out = null,
  } = {}) {
    const result = out || this._result;
    this._resetResult(result);

    if (!origin || !direction) {
      return result;
    }

    this._origin.copy(origin);
    this._direction.copy(direction).normalize();

    const ndx = this._direction.x;
    const ndy = this._direction.y;
    const ndz = this._direction.z;

    // Mesh backend first
    if (this._meshes.length > 0) {
      const meshHit = this._queryMeshes(
        this._origin,
        this._direction,
        maxDistance,
        filter,
        result
      );
      if (meshHit) {
        return result;
      }
      // No mesh hit → fall through to plane
    }

    // Plane backend
    return this._queryPlane(
      this._origin,
      ndx, ndy, ndz,
      maxDistance,
      filter,
      result
    );
  }

  queryDown({
    origin,
    maxDistance = Infinity,
    filter = null,
    out = null,
  } = {}) {
    return this.query({
      origin,
      direction: SurfaceQuery._DOWN,
      maxDistance,
      filter,
      out,
    });
  }

  setGroundY(groundY) {
    if (!Number.isFinite(groundY)) {
      throw new TypeError("SurfaceQuery.setGroundY: groundY must be finite");
    }
    this.groundY = groundY;
    return this;
  }

  getBackend() {
    return this._meshes.length > 0
      ? SurfaceQuery.BACKEND_MESH
      : SurfaceQuery.BACKEND_GROUND;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  _queryMeshes(origin, direction, maxDistance, filter, result) {
    this._raycaster.set(origin, direction);
    this._raycaster.far = Number.isFinite(maxDistance) ? maxDistance : Infinity;
    this._raycaster.near = 0;

    this._hits.length = 0;
    this._raycaster.intersectObjects(this._meshes, true, this._hits);

    if (this._hits.length === 0) {
      return false;
    }

    const hit = this._hits[0];
    const distance = hit.distance;

    if (filter) {
      const accepted = filter({
        surfaceId: this.defaultSurfaceId,
        surfaceType: this.defaultSurfaceType,
        backend: SurfaceQuery.BACKEND_MESH,
        object: hit.object,
        face: hit.face,
      });
      if (!accepted) return false;
    }

    result.valid = true;
    result.point.copy(hit.point);

    if (hit.face && hit.object) {
      result.normal.copy(hit.face.normal);
      if (hit.object.matrixWorld) {
        this._normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        result.normal.applyMatrix3(this._normalMatrix).normalize();
      } else {
        result.normal.normalize();
      }
    } else {
      result.normal.set(0, 1, 0);
    }

    result.separation = origin.y - result.point.y;
    result.distance = distance;
    result.surfaceId = this.defaultSurfaceId;
    result.surfaceType = this.defaultSurfaceType;
    result.confidence = 1;
    result.backend = SurfaceQuery.BACKEND_MESH;
    result.origin.copy(origin);
    result.direction.copy(direction);

    return true;
  }

  _queryPlane(origin, ndx, ndy, ndz, maxDistance, filter, result) {
    if (Math.abs(ndy) <= this.epsilon) {
      return result;
    }

    let t = (this.groundY - origin.y) / ndy;
    const distance = t < 0 ? 0 : t;

    if (
      maxDistance !== Infinity &&
      distance > maxDistance + this.epsilon
    ) {
      return result;
    }

    if (filter) {
      const accepted = filter({
        surfaceId: this.defaultSurfaceId,
        surfaceType: this.defaultSurfaceType,
        backend: SurfaceQuery.BACKEND_GROUND,
      });
      if (!accepted) return result;
    }

    result.valid = true;
    result.point.set(
      origin.x + ndx * distance,
      this.groundY,
      origin.z + ndz * distance
    );
    result.normal.set(0, 1, 0);
    result.separation = origin.y - this.groundY;
    result.distance = distance;
    result.surfaceId = this.defaultSurfaceId;
    result.surfaceType = this.defaultSurfaceType;
    result.confidence = 1;
    result.backend = SurfaceQuery.BACKEND_GROUND;
    result.origin.copy(origin);
    result.direction.set(ndx, ndy, ndz);

    return result;
  }

  _resetResult(result) {
    result.valid = false;
    result.point.set(0, 0, 0);
    result.normal.set(0, 1, 0);
    result.separation = 0;
    result.distance = Infinity;
    result.surfaceId = null;
    result.surfaceType = null;
    result.confidence = 0;
    result.backend = this._meshes.length > 0
      ? SurfaceQuery.BACKEND_MESH
      : SurfaceQuery.BACKEND_GROUND;

    if (result.origin) result.origin.set(0, 0, 0);
    if (result.direction) result.direction.set(0, 1, 0);
  }

  static get DOWN() {
    return SurfaceQuery._DOWN;
  }
}

SurfaceQuery._DOWN = new THREE.Vector3(0, -1, 0);

export default SurfaceQuery;