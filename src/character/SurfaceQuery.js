// src/character/SurfaceQuery.js

import * as THREE from "three";

/**
 * SurfaceQuery
 *
 * Universal surface-query interface for the Character Core.
 *
 * Current backend:
 *   - horizontal ground plane only
 *
 * Future backends can implement the same query contract for:
 *   - arbitrary meshes
 *   - slopes
 *   - steps
 *   - ledges
 *   - moving platforms
 *   - ladders
 *   - beams
 *   - ropes
 *
 * IMPORTANT:
 * SurfaceQuery does NOT decide whether a character wants to touch,
 * stand, grip, climb, hang, etc.
 *
 * It answers only:
 *
 *   "What surface exists at / along this query?"
 *
 * ContactPerception owns interpretation of multiple queries.
 */
export class SurfaceQuery {
  static BACKEND_GROUND = "ground-plane";

  constructor({
    groundY = 0,
    defaultSurfaceId = "ground",
    defaultSurfaceType = "ground",
    epsilon = 1e-6,
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

    /*
     * Reusable result object.
     *
     * query() mutates this object instead of allocating a new object
     * on every probe.
     *
     * Consumers must copy the values they want to retain.
     */
    this._result = {
      valid: false,

      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),

      /*
       * Signed vertical separation:
       *
       *   origin.y - groundY
       *
       * Positive  = origin is above surface.
       * Zero      = origin lies on surface.
       * Negative  = origin is below surface.
       *
       * This is deliberately independent from ray direction.
       */
      separation: 0,

      /*
       * Distance measured along the supplied ray.
       * Infinity when no intersection exists.
       */
      distance: Infinity,

      surfaceId: null,
      surfaceType: null,
      confidence: 0,

      backend: SurfaceQuery.BACKEND_GROUND,

      /*
       * Useful diagnostics.
       */
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(),
    };

    /*
     * Internal scratch vectors.
     * Never exposed as the returned result.
     */
    this._origin = new THREE.Vector3();
    this._direction = new THREE.Vector3();
  }

  /**
   * Query the currently supported surface backend.
   *
   * API:
   *
   * query({
   *   origin,
   *   direction,
   *   maxDistance,
   *   filter?,
   *   out?
   * })
   *
   * origin:
   *   THREE.Vector3
   *
   * direction:
   *   THREE.Vector3
   *
   * maxDistance:
   *   positive finite number
   *
   * filter:
   *   optional callback:
   *
   *     filter({
   *       surfaceId,
   *       surfaceType,
   *       backend
   *     }) -> boolean
   *
   * out:
   *   optional caller-owned result object.
   *   When omitted, the internal reusable result is returned.
   *
   * IMPORTANT:
   * The returned vectors belong to the result object.
   * Copy them if the values must survive another query.
   */
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

    if (
      !Number.isFinite(origin.x) ||
      !Number.isFinite(origin.y) ||
      !Number.isFinite(origin.z)
    ) {
      return result;
    }

    if (
      !Number.isFinite(direction.x) ||
      !Number.isFinite(direction.y) ||
      !Number.isFinite(direction.z)
    ) {
      return result;
    }

    if (
      maxDistance !== Infinity &&
      (!Number.isFinite(maxDistance) || maxDistance < 0)
    ) {
      return result;
    }

    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;

    const lengthSq = dx * dx + dy * dy + dz * dz;

    if (lengthSq <= this.epsilon * this.epsilon) {
      return result;
    }

    const invLength = 1 / Math.sqrt(lengthSq);

    const ndx = dx * invLength;
    const ndy = dy * invLength;
    const ndz = dz * invLength;

    this._origin.copy(origin);

    this._direction.set(ndx, ndy, ndz);

    /*
     * Current backend is an infinite horizontal plane:
     *
     *     y = groundY
     *
     * Ray:
     *
     *     P(t) = origin + direction * t
     *
     * Intersection:
     *
     *     origin.y + direction.y * t = groundY
     *
     *     t = (groundY - origin.y) / direction.y
     */
    if (Math.abs(ndy) <= this.epsilon) {
      return result;
    }

    const t = (this.groundY - origin.y) / ndy;

    /*
     * SurfaceQuery is a forward ray query.
     * We do not report intersections behind the probe.
     */
    if (t < -this.epsilon) {
      return result;
    }

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

      if (!accepted) {
        return result;
      }
    }

    /*
     * Write result without allocations.
     */
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

  /**
   * Convenience query for a vertical/downward probe.
   *
   * This is intentionally a thin wrapper around query().
   * It does not create another abstraction layer.
   */
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

  /**
   * Update the ground height.
   *
   * This is useful later for moving worlds / platforms,
   * but current backend remains a single horizontal plane.
   */
  setGroundY(groundY) {
    if (!Number.isFinite(groundY)) {
      throw new TypeError("SurfaceQuery.setGroundY: groundY must be finite");
    }

    this.groundY = groundY;
    return this;
  }

  /**
   * Read-only backend identity.
   */
  getBackend() {
    return SurfaceQuery.BACKEND_GROUND;
  }

  /**
   * Reset reusable result.
   */
  _resetResult(result) {
    result.valid = false;

    result.point.set(0, 0, 0);
    result.normal.set(0, 1, 0);

    result.separation = 0;
    result.distance = Infinity;

    result.surfaceId = null;
    result.surfaceType = null;
    result.confidence = 0;

    result.backend = SurfaceQuery.BACKEND_GROUND;

    if (result.origin) {
      result.origin.set(0, 0, 0);
    }

    if (result.direction) {
      result.direction.set(0, 1, 0);
    }
  }

  static get DOWN() {
    return SurfaceQuery._DOWN;
  }
}

SurfaceQuery._DOWN = new THREE.Vector3(0, -1, 0);

export default SurfaceQuery;
