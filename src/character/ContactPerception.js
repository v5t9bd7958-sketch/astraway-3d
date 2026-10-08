// src/character/ContactPerception.js

import * as THREE from "three";
import { BONE_MAP } from "./BoneMap.js";

/**
 * ContactPerception
 *
 * Perception layer of Character Core.
 *
 * Responsibility:
 *   SkinnedMesh
 *      ↓
 *   runtime geometry probes
 *      ↓
 *   SurfaceQuery
 *      ↓
 *   ContactEvidence
 *
 * It does NOT:
 *   - establish contacts
 *   - plant contacts
 *   - choose gait
 *   - choose traversal
 *   - create tasks
 *   - write bones
 *
 * ContactPerception observes the currently deformed character geometry
 * and reports measured evidence to the next layer.
 *
 * Important:
 * THREE.SkinnedMesh.getVertexPosition() gives the current local-space
 * vertex position after skinning/morph evaluation. We then transform
 * that position into world space.
 *
 * Runtime design:
 *   - expensive vertex scan happens once in initialize()
 *   - runtime uses a fixed probe set
 *   - no per-frame arrays
 *   - no per-frame Vector3 allocations
 *   - evidence objects are persistent and reused
 */
export class ContactPerception {
  static DEFAULT_CONFIG = Object.freeze({
    footInfluenceMin: 0.35,
    shinInfluenceMax: 0.30,

    targetProbes: 5,

    /*
     * Physical contact threshold.
     *
     * This is NOT the ray length.
     * queryMaxDistance controls how far we search.
     */
    contactSeparation: 0.035,

    /*
     * Search distance for downward surface query.
     *
     * Deliberately larger than contactSeparation.
     */
    queryMaxDistance: 0.20,

    /*
     * Minimum confidence required for valid evidence.
     */
    minConfidence: 0.40,

    /*
     * Y clustering tolerance during bake.
     */
    clusterY: 0.03,

    /*
     * Probe agreement threshold.
     *
     * A probe is considered "near" when its measured separation
     * is inside contactSeparation.
     */
    normalMinY: 0.45,

    /*
     * Ignore vertices that are too far horizontally from the
     * selected foot region during candidate construction.
     */
    maxFootSpan: 0.22,
  });

  constructor({
    root,
    skeleton,
    skinnedMesh,
    surfaceQuery,

    contactSeparation,
    minConfidence,

    footInfluenceMin,
    shinInfluenceMax,

    targetProbes,
    clusterY,
    queryMaxDistance,
    normalMinY,
    maxFootSpan,
  } = {}) {
    if (!root) {
      throw new TypeError("ContactPerception: root is required");
    }

    if (!skeleton) {
      throw new TypeError("ContactPerception: skeleton is required");
    }

    if (!skinnedMesh) {
      throw new TypeError("ContactPerception: skinnedMesh is required");
    }

    if (!surfaceQuery) {
      throw new TypeError("ContactPerception: surfaceQuery is required");
    }

    if (!skinnedMesh.isSkinnedMesh) {
      throw new TypeError(
        "ContactPerception: skinnedMesh must be THREE.SkinnedMesh"
      );
    }

    const defaults = ContactPerception.DEFAULT_CONFIG;

    this.root = root;
    this.skeleton = skeleton;
    this.skinnedMesh = skinnedMesh;
    this.surfaceQuery = surfaceQuery;

    this.footInfluenceMin =
      Number.isFinite(footInfluenceMin)
        ? footInfluenceMin
        : defaults.footInfluenceMin;

    this.shinInfluenceMax =
      Number.isFinite(shinInfluenceMax)
        ? shinInfluenceMax
        : defaults.shinInfluenceMax;

    this.targetProbes =
      Number.isFinite(targetProbes)
        ? Math.max(3, Math.min(8, Math.floor(targetProbes)))
        : defaults.targetProbes;

    this.contactSeparation =
      Number.isFinite(contactSeparation)
        ? Math.max(0.001, contactSeparation)
        : defaults.contactSeparation;

    this.queryMaxDistance =
      Number.isFinite(queryMaxDistance)
        ? Math.max(
            this.contactSeparation,
            queryMaxDistance
          )
        : Math.max(
            this.contactSeparation,
            defaults.queryMaxDistance
          );

    this.minConfidence =
      Number.isFinite(minConfidence)
        ? Math.max(0, Math.min(1, minConfidence))
        : defaults.minConfidence;

    this.clusterY =
      Number.isFinite(clusterY)
        ? Math.max(0.001, clusterY)
        : defaults.clusterY;

    this.normalMinY =
      Number.isFinite(normalMinY)
        ? Math.max(-1, Math.min(1, normalMinY))
        : defaults.normalMinY;

    this.maxFootSpan =
      Number.isFinite(maxFootSpan)
        ? Math.max(0.01, maxFootSpan)
        : defaults.maxFootSpan;

    this._initialized = false;

    /*
     * Probe storage.
     *
     * Each entry:
     *
     * {
     *   logicalBone,
     *   side,
     *   vertices: Uint32Array,
     *   count,
     *   samples: Vector3[],
     *   sampleVertices: Uint32Array
     * }
     *
     * The actual runtime probe positions are stored separately
     * in fixed Vector3 objects.
     */
    this._probeSets = new Map();

    this._probeSets.set(
      "foot_L",
      this._createProbeSet("foot_L", "L")
    );

    this._probeSets.set(
      "foot_R",
      this._createProbeSet("foot_R", "R")
    );

    /*
     * Stable evidence objects.
     *
     * Consumers may retain references to these objects between
     * frames only if they understand that their fields are updated.
     * Persistent values should be copied by the consumer.
     */
    this._evidence = {
      left: this._createEvidence("foot_L", "L"),
      right: this._createEvidence("foot_R", "R"),
    };

    /*
     * Runtime scratch.
     */
    this._vertexLocal = new THREE.Vector3();
    this._vertexWorld = new THREE.Vector3();

    this._clusterCenter = new THREE.Vector3();

    this._worldOrigin = new THREE.Vector3();

    this._queryResult = {
      valid: false,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      separation: 0,
      distance: Infinity,
      surfaceId: null,
      surfaceType: null,
      confidence: 0,
      backend: null,
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(0, -1, 0),
    };

    /*
     * Fixed probe result slots.
     *
     * targetProbes <= 8.
     */
    this._probeHitsL = new Uint8Array(8);
    this._probeHitsR = new Uint8Array(8);

    this._probeSeparationsL = new Float32Array(8);
    this._probeSeparationsR = new Float32Array(8);

    this._probeSurfaceKeysL = new Array(8);
    this._probeSurfaceKeysR = new Array(8);

    /*
     * Per-frame statistics.
     */
    this._lastUpdateTime = 0;
  }

  /**
   * Initialize / bake probe geometry.
   *
   * This scans the skinned mesh once and builds representative
   * foot probe locations.
   *
   * Must be called after the skeleton and skinned mesh are ready.
   */
  initialize() {
    this._probeSets.get("foot_L").reset();
    this._probeSets.get("foot_R").reset();

    const geometry = this.skinnedMesh.geometry;

    if (!geometry) {
      throw new Error(
        "ContactPerception.initialize: skinnedMesh.geometry missing"
      );
    }

    const position = geometry.getAttribute("position");
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");

    if (!position) {
      throw new Error(
        "ContactPerception.initialize: position attribute missing"
      );
    }

    if (!skinIndex || !skinWeight) {
      throw new Error(
        "ContactPerception.initialize: skinIndex/skinWeight attributes missing"
      );
    }

    const leftFootIndex = this._findBoneIndex(
      BONE_MAP.foot_L
    );

    const rightFootIndex = this._findBoneIndex(
      BONE_MAP.foot_R
    );

    const leftToeIndex = this._findBoneIndex(
      BONE_MAP.toe_L
    );

    const rightToeIndex = this._findBoneIndex(
      BONE_MAP.toe_R
    );

    const leftShinIndex = this._findBoneIndex(
      BONE_MAP.shin_L
    );

    const rightShinIndex = this._findBoneIndex(
      BONE_MAP.shin_R
    );

    if (leftFootIndex < 0 || rightFootIndex < 0) {
      throw new Error(
        "ContactPerception.initialize: required foot bones missing"
      );
    }

    const vertexCount = position.count;

    /*
     * Candidate storage.
     *
     * We intentionally use normal JS arrays only during initialization.
     * They never participate in the runtime loop.
     */
    const leftCandidates = [];
    const rightCandidates = [];

    const vertex = new THREE.Vector3();

    for (let i = 0; i < vertexCount; i++) {
      const indices = this._readSkinIndices(
        skinIndex,
        i
      );

      const weights = this._readSkinWeights(
        skinWeight,
        i
      );

      const leftScore = this._footVertexScore(
        indices,
        weights,
        leftFootIndex,
        leftToeIndex,
        leftShinIndex
      );

      const rightScore = this._footVertexScore(
        indices,
        weights,
        rightFootIndex,
        rightToeIndex,
        rightShinIndex
      );

      if (leftScore > 0) {
        this.skinnedMesh.getVertexPosition(
          i,
          vertex
        );

        vertex.applyMatrix4(
          this.skinnedMesh.matrixWorld
        );

        leftCandidates.push({
          index: i,
          x: vertex.x,
          y: vertex.y,
          z: vertex.z,
          score: leftScore,
        });
      }

      if (rightScore > 0) {
        this.skinnedMesh.getVertexPosition(
          i,
          vertex
        );

        vertex.applyMatrix4(
          this.skinnedMesh.matrixWorld
        );

        rightCandidates.push({
          index: i,
          x: vertex.x,
          y: vertex.y,
          z: vertex.z,
          score: rightScore,
        });
      }
    }

    this._buildProbeSet(
      this._probeSets.get("foot_L"),
      leftCandidates
    );

    this._buildProbeSet(
      this._probeSets.get("foot_R"),
      rightCandidates
    );

    this._initialized = true;

    return this;
  }

  update(time = 0) {
    if (!this._initialized) {
      this.initialize();
    }

    this._lastUpdateTime = time;

    this._measureProbeSet(
      this._probeSets.get("foot_L"),
      this._evidence.left,
      this._probeHitsL,
      this._probeSeparationsL,
      this._probeSurfaceKeysL
    );

    this._measureProbeSet(
      this._probeSets.get("foot_R"),
      this._evidence.right,
      this._probeHitsR,
      this._probeSeparationsR,
      this._probeSurfaceKeysR
    );

    return this._evidence;
  }

  getEvidence(logicalBone = null) {
    if (logicalBone === "foot_L") {
      return this._evidence.left;
    }

    if (logicalBone === "foot_R") {
      return this._evidence.right;
    }

    return this._evidence;
  }

  isInitialized() {
    return this._initialized;
  }

  getProbeCount(logicalBone) {
    const set = this._probeSets.get(logicalBone);

    return set ? set.count : 0;
  }

  _findBoneIndex(name) {
    const bones = this.skeleton.bones;

    for (let i = 0; i < bones.length; i++) {
      if (bones[i] && bones[i].name === name) {
        return i;
      }
    }

    return -1;
  }

  _createProbeSet(logicalBone, side) {
    const samples = [];

    for (let i = 0; i < this.targetProbes; i++) {
      samples.push(new THREE.Vector3());
    }

    return {
      logicalBone,
      side,

      count: 0,

      vertices: new Uint32Array(64),
      vertexCount: 0,

      /*
       * Exact source vertex for each runtime probe.
       *
       * Selected once during initialization, then re-skinned every
       * frame so probe geometry follows the current character pose.
       */
      sampleVertices: new Uint32Array(8),

      samples,

      minY: Infinity,
      maxY: -Infinity,

      reset() {
        this.count = 0;
        this.vertexCount = 0;
        this.minY = Infinity;
        this.maxY = -Infinity;

        this.vertices.fill(0);
        this.sampleVertices.fill(0);

        for (let i = 0; i < this.samples.length; i++) {
          this.samples[i].set(0, 0, 0);
        }

        return this;
      },
    };
  }

  _createEvidence(logicalBone, side) {
    return {
      valid: false,

      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),

      separation: Infinity,

      surfaceId: null,
      surfaceType: null,

      confidence: 0,

      probeCount: 0,
      nearProbeCount: 0,

      probeAgreement: 0,

      bone: logicalBone,
      side,

      backend: null,
      timestamp: 0,
    };
  }

  _readSkinIndices(attribute, index) {
    const itemSize = attribute.itemSize;
    const offset = index * itemSize;
    const array = attribute.array;

    return [
      array[offset] || 0,
      itemSize > 1 ? array[offset + 1] || 0 : 0,
      itemSize > 2 ? array[offset + 2] || 0 : 0,
      itemSize > 3 ? array[offset + 3] || 0 : 0,
    ];
  }

  _readSkinWeights(attribute, index) {
    const itemSize = attribute.itemSize;
    const offset = index * itemSize;
    const array = attribute.array;

    return [
      array[offset] || 0,
      itemSize > 1 ? array[offset + 1] || 0 : 0,
      itemSize > 2 ? array[offset + 2] || 0 : 0,
      itemSize > 3 ? array[offset + 3] || 0 : 0,
    ];
  }

  _footVertexScore(
    indices,
    weights,
    footIndex,
    toeIndex,
    shinIndex
  ) {
    let footWeight = 0;
    let toeWeight = 0;
    let shinWeight = 0;

    for (let i = 0; i < 4; i++) {
      const bone = indices[i];
      const weight = weights[i];

      if (bone === footIndex) {
        footWeight += weight;
      }

      if (bone === toeIndex) {
        toeWeight += weight;
      }

      if (bone === shinIndex) {
        shinWeight += weight;
      }
    }

    const footScore = Math.max(
      footWeight,
      toeWeight
    );

    if (footScore < this.footInfluenceMin) {
      return 0;
    }

    if (shinWeight > this.shinInfluenceMax) {
      return 0;
    }

    return footScore;
  }

  _buildProbeSet(set, candidates) {
    if (!candidates.length) {
      set.count = 0;
      set.vertexCount = 0;
      return;
    }

    let minY = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].y < minY) {
        minY = candidates[i].y;
      }
    }

    set.minY = minY;

    const clusterMaxY = minY + this.clusterY;

    const cluster = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];

      if (c.y <= clusterMaxY) {
        cluster.push(c);
      }
    }

    if (!cluster.length) {
      set.count = 0;
      set.vertexCount = 0;
      return;
    }

    const retainedCount = Math.min(
      64,
      cluster.length
    );

    set.vertexCount = retainedCount;

    for (let i = 0; i < retainedCount; i++) {
      set.vertices[i] = cluster[i].index;
    }

    let first = cluster[0];

    for (let i = 1; i < cluster.length; i++) {
      if (cluster[i].y < first.y) {
        first = cluster[i];
      }
    }

    set.samples[0].set(
      first.x,
      first.y,
      first.z
    );

    set.sampleVertices[0] = first.index;

    let selected = 1;

    while (
      selected < this.targetProbes &&
      selected < cluster.length
    ) {
      let best = null;
      let bestDistance = -1;

      for (let i = 0; i < cluster.length; i++) {
        const candidate = cluster[i];

        let nearestSq = Infinity;

        for (let j = 0; j < selected; j++) {
          const probe = set.samples[j];

          const dx = candidate.x - probe.x;
          const dz = candidate.z - probe.z;

          const distanceSq =
            dx * dx +
            dz * dz;

          if (distanceSq < nearestSq) {
            nearestSq = distanceSq;
          }
        }

        if (nearestSq > bestDistance) {
          bestDistance = nearestSq;
          best = candidate;
        }
      }

      if (!best) {
        break;
      }

      set.samples[selected].set(
        best.x,
        best.y,
        best.z
      );

      set.sampleVertices[selected] = best.index;

      selected++;
    }

    set.count = selected;
  }

  _measureProbeSet(
    set,
    evidence,
    hits,
    separations,
    surfaceKeys
  ) {
    evidence.valid = false;

    evidence.point.set(0, 0, 0);
    evidence.normal.set(0, 1, 0);

    evidence.separation = Infinity;

    evidence.surfaceId = null;
    evidence.surfaceType = null;

    evidence.confidence = 0;

    evidence.probeCount = set.count;
    evidence.nearProbeCount = 0;
    evidence.probeAgreement = 0;

    evidence.backend = null;
    evidence.timestamp = this._lastUpdateTime;

    if (!set.count) {
      return;
    }

    /*
     * CRITICAL:
     * Refresh the selected probe vertices from the CURRENT skinned
     * pose before querying the surface.
     *
     * Candidate discovery remains initialization-only.
     * Runtime work is bounded by the fixed probe count.
     */
    this.skinnedMesh.updateMatrixWorld(true);

    for (let i = 0; i < set.count; i++) {
      const vertexIndex = set.sampleVertices[i];

      this.skinnedMesh.getVertexPosition(
        vertexIndex,
        this._vertexLocal
      );

      this._vertexWorld.copy(
        this._vertexLocal
      );

      this._vertexWorld.applyMatrix4(
        this.skinnedMesh.matrixWorld
      );

      set.samples[i].copy(
        this._vertexWorld
      );
    }

    let validCount = 0;
    let nearCount = 0;

    let minSeparation = Infinity;
    let maxSeparation = -Infinity;

    let pointX = 0;
    let pointY = 0;
    let pointZ = 0;

    let normalX = 0;
    let normalY = 0;
    let normalZ = 0;

    let bestProbeIndex = -1;
    let bestAbsSeparation = Infinity;

    for (let i = 0; i < set.count; i++) {
      const probe = set.samples[i];

      const result = this.surfaceQuery.queryDown({
        origin: probe,
        maxDistance: this.queryMaxDistance,
        out: this._queryResult,
      });

      if (!result.valid) {
        hits[i] = 0;
        separations[i] = Infinity;
        surfaceKeys[i] = null;
        continue;
      }

      const separation = result.separation;

      if (
        separation <
        -this.contactSeparation
      ) {
        hits[i] = 0;
        separations[i] = separation;
        surfaceKeys[i] = null;
        continue;
      }

      hits[i] = 1;
      separations[i] = separation;

      validCount++;

      if (
        separation <=
        this.contactSeparation
      ) {
        nearCount++;
      }

      if (separation < minSeparation) {
        minSeparation = separation;
      }

      if (separation > maxSeparation) {
        maxSeparation = separation;
      }

      pointX += result.point.x;
      pointY += result.point.y;
      pointZ += result.point.z;

      normalX += result.normal.x;
      normalY += result.normal.y;
      normalZ += result.normal.z;

      surfaceKeys[i] =
        this._surfaceKey(
          result.surfaceId,
          result.surfaceType
        );

      const absSeparation =
        Math.abs(separation);

      if (
        absSeparation <
        bestAbsSeparation
      ) {
        bestAbsSeparation = absSeparation;
        bestProbeIndex = i;
      }
    }
        evidence.nearProbeCount = nearCount;
    if (!validCount) {
      return;
    }

    if (nearCount < 2) {
      return;
    }

    const majorityIndex =
      this._majoritySurfaceIndex(
        surfaceKeys,
        set.count,
        hits
      );

    let majorityVotes = 0;

    if (majorityIndex >= 0) {
      majorityVotes =
        this._countSurfaceVotes(
          surfaceKeys,
          set.count,
          hits,
          surfaceKeys[majorityIndex]
        );
    }

    const majorityRatio =
      validCount > 0
        ? majorityVotes / validCount
        : 0;

    const nearRatio =
      nearCount / set.count;

    const spread =
      Math.max(
        0,
        maxSeparation - minSeparation
      );

    const separationConsistency =
      Math.max(
        0,
        1 -
          spread /
            Math.max(
              this.contactSeparation * 2,
              1e-6
            )
      );

    const confidence =
      nearRatio *
      separationConsistency *
      majorityRatio;

    evidence.confidence =
      Math.max(
        0,
        Math.min(1, confidence)
      );

    evidence.probeAgreement =
      nearRatio * 0.6 +
      separationConsistency * 0.4;

    let contactCount = 0;

    let contactX = 0;
    let contactY = 0;
    let contactZ = 0;

    let contactNormalX = 0;
    let contactNormalY = 0;
    let contactNormalZ = 0;

    for (let i = 0; i < set.count; i++) {
      if (!hits[i]) {
        continue;
      }

      if (
        separations[i] >
        this.contactSeparation
      ) {
        continue;
      }

      const probe = set.samples[i];

      const result =
        this.surfaceQuery.queryDown({
          origin: probe,
          maxDistance: this.queryMaxDistance,
          out: this._queryResult,
        });

      if (!result.valid) {
        continue;
      }

      contactX += result.point.x;
      contactY += result.point.y;
      contactZ += result.point.z;

      contactNormalX += result.normal.x;
      contactNormalY += result.normal.y;
      contactNormalZ += result.normal.z;

      contactCount++;
    }

    if (contactCount > 0) {
      const inv = 1 / contactCount;

      evidence.point.set(
        contactX * inv,
        contactY * inv,
        contactZ * inv
      );

      evidence.normal.set(
        contactNormalX * inv,
        contactNormalY * inv,
        contactNormalZ * inv
      );

      if (
        evidence.normal.lengthSq() >
        1e-8
      ) {
        evidence.normal.normalize();
      }
    } else if (bestProbeIndex >= 0) {
      const probe =
        set.samples[bestProbeIndex];

      const result =
        this.surfaceQuery.queryDown({
          origin: probe,
          maxDistance: this.queryMaxDistance,
          out: this._queryResult,
        });

      if (result.valid) {
        evidence.point.copy(
          result.point
        );

        evidence.normal.copy(
          result.normal
        );
      }
    }

    evidence.separation =
      minSeparation;

    if (
      majorityIndex >= 0 &&
      surfaceKeys[majorityIndex]
    ) {
      const key =
        surfaceKeys[majorityIndex];

      const separator =
        key.indexOf("|");

      if (separator >= 0) {
        evidence.surfaceId =
          key.slice(0, separator);

        evidence.surfaceType =
          key.slice(
            separator + 1
          );
      } else {
        evidence.surfaceId = key;
        evidence.surfaceType = null;
      }
    }

    evidence.backend =
      this._queryResult.backend;

    evidence.valid =
      evidence.confidence >=
        this.minConfidence &&
      nearCount >= 2 &&
      majorityRatio >= 0.5 &&
      separationConsistency > 0;

    if (
      !Number.isFinite(
        evidence.point.x
      ) ||
      !Number.isFinite(
        evidence.point.y
      ) ||
      !Number.isFinite(
        evidence.point.z
      )
    ) {
      evidence.valid = false;
    }
  }

  _surfaceKey(surfaceId, surfaceType) {
    return (
      String(
        surfaceId == null
          ? ""
          : surfaceId
      ) +
      "|" +
      String(
        surfaceType == null
          ? ""
          : surfaceType
      )
    );
  }

  _majoritySurfaceIndex(
    keys,
    count,
    hits
  ) {
    let bestIndex = -1;
    let bestVotes = 0;

    for (let i = 0; i < count; i++) {
      if (!hits[i]) {
        continue;
      }

      const key = keys[i];

      if (key == null) {
        continue;
      }

      let votes = 0;

      for (let j = 0; j < count; j++) {
        if (
          hits[j] &&
          keys[j] === key
        ) {
          votes++;
        }
      }

      if (votes > bestVotes) {
        bestVotes = votes;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  _countSurfaceVotes(
    keys,
    count,
    hits,
    key
  ) {
    let votes = 0;

    for (let i = 0; i < count; i++) {
      if (
        hits[i] &&
        keys[i] === key
      ) {
        votes++;
      }
    }

    return votes;
  }
}

export default ContactPerception;
