import * as THREE from "three";

export class BodyState {
  constructor() {
    this.position =
      new THREE.Vector3();

    this.velocity =
      new THREE.Vector3();

    this.acceleration =
      new THREE.Vector3();

    this.up =
      new THREE.Vector3(0, 1, 0);

    this.gravity =
      new THREE.Vector3(0, -9.81, 0);

    this.com =
      new THREE.Vector3();

    this.comVelocity =
      new THREE.Vector3();

    this.supportPoints = [];

    this.supportPolygon = [];

    this.supportCenter =
      new THREE.Vector3();

    this.balanceError = 0;

    this.supportCount = 0;

    this.grounded = false;

    this.stable = false;

    this.contacts = new Map();

    this.time = 0;
  }

  setPosition(position) {
    this.position.copy(position);
    return this;
  }

  setVelocity(velocity) {
    this.velocity.copy(velocity);
    return this;
  }

  setCOM(com) {
    this.com.copy(com);
    return this;
  }

  setContacts(contacts) {
    this.contacts = contacts;
    return this;
  }

  rebuildSupport() {
    this.supportPoints.length = 0;

    for (
      const contact of this.contacts.values()
    ) {
      if (
        contact?.isPlanted?.() &&
        contact.isSupport
      ) {
        this.supportPoints.push(
          contact.point.clone()
        );
      }
    }

    this.supportCount =
      this.supportPoints.length;

    this.grounded =
      this.supportCount > 0;

    this.supportPolygon =
      buildConvexHull(
        this.supportPoints
      );

    this.supportCenter.set(0, 0, 0);

    if (this.supportPolygon.length) {
      for (
        const point of this.supportPolygon
      ) {
        this.supportCenter.add(point);
      }

      this.supportCenter.multiplyScalar(
        1 / this.supportPolygon.length
      );
    }

    this.balanceError =
      calculateBalanceError(
        this.com,
        this.supportPolygon
      );

    this.stable =
      this.grounded &&
      this.balanceError <= 0;

    return this;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new Error(
        "BodyState.update: invalid dt"
      );
    }

    this.time += dt;

    this.comVelocity.copy(
      this.velocity
    );

    for (
      const contact of this.contacts.values()
    ) {
      contact.update(dt);
    }

    this.rebuildSupport();

    return this;
  }

  getSupportCount() {
    return this.supportCount;
  }

  isBalanced() {
    return this.stable;
  }

  getBalanceError() {
    return this.balanceError;
  }

  snapshot() {
    return {
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      acceleration:
        this.acceleration.clone(),

      up: this.up.clone(),
      gravity: this.gravity.clone(),

      com: this.com.clone(),
      comVelocity:
        this.comVelocity.clone(),

      supportPoints:
        this.supportPoints.map(
          (p) => p.clone()
        ),

      supportPolygon:
        this.supportPolygon.map(
          (p) => p.clone()
        ),

      supportCenter:
        this.supportCenter.clone(),

      balanceError:
        this.balanceError,

      supportCount:
        this.supportCount,

      grounded:
        this.grounded,

      stable:
        this.stable,

      time: this.time,
    };
  }
}

function buildConvexHull(points) {
  if (points.length <= 1) {
    return points.map(
      (p) => p.clone()
    );
  }

  const sorted =
    points
      .map((p) => p.clone())
      .sort(
        (a, b) =>
          a.x - b.x ||
          a.z - b.z
      );

  const cross = (
    a,
    b,
    c
  ) =>
    (b.x - a.x) *
      (c.z - a.z) -
    (b.z - a.z) *
      (c.x - a.x);

  const lower = [];

  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(
        lower[lower.length - 2],
        lower[lower.length - 1],
        point
      ) <= 0
    ) {
      lower.pop();
    }

    lower.push(point);
  }

  const upper = [];

  for (
    let i = sorted.length - 1;
    i >= 0;
    i--
  ) {
    const point = sorted[i];

    while (
      upper.length >= 2 &&
      cross(
        upper[upper.length - 2],
        upper[upper.length - 1],
        point
      ) <= 0
    ) {
      upper.pop();
    }

    upper.push(point);
  }

  lower.pop();
  upper.pop();

  return lower.concat(upper);
}

function calculateBalanceError(
  com,
  polygon
) {
  if (!polygon.length) {
    return Infinity;
  }

  if (polygon.length === 1) {
    return Math.hypot(
      com.x - polygon[0].x,
      com.z - polygon[0].z
    );
  }

  if (polygon.length === 2) {
    return distanceToSegmentXZ(
      com,
      polygon[0],
      polygon[1]
    );
  }

  if (
    pointInsidePolygonXZ(
      com,
      polygon
    )
  ) {
    return 0;
  }

  let minDistance = Infinity;

  for (
    let i = 0;
    i < polygon.length;
    i++
  ) {
    const a = polygon[i];
    const b =
      polygon[
        (i + 1) % polygon.length
      ];

    minDistance =
      Math.min(
        minDistance,
        distanceToSegmentXZ(
          com,
          a,
          b
        )
      );
  }

  return minDistance;
}

function distanceToSegmentXZ(
  p,
  a,
  b
) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;

  const lengthSq =
    abx * abx +
    abz * abz;

  if (lengthSq === 0) {
    return Math.hypot(
      p.x - a.x,
      p.z - a.z
    );
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      (
        (p.x - a.x) * abx +
        (p.z - a.z) * abz
      ) / lengthSq
    )
  );

  const x =
    a.x + abx * t;

  const z =
    a.z + abz * t;

  return Math.hypot(
    p.x - x,
    p.z - z
  );
}

function pointInsidePolygonXZ(
  point,
  polygon
) {
  let inside = false;

  for (
    let i = 0,
    j = polygon.length - 1;
    i < polygon.length;
    j = i++
  ) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;

    const xj = polygon[j].x;
    const zj = polygon[j].z;

    const intersects =
      (
        zi > point.z
      ) !== (
        zj > point.z
      ) &&
      point.x <
        (
          (xj - xi) *
            (point.z - zi)
        ) /
          (zj - zi) +
          xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}
