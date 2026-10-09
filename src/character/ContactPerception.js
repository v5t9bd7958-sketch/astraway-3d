import * as THREE from "three";
import { BONE_MAP } from "./BoneMap.js";

const EPSILON = 1e-8;

/*
 * AstraWay Character Core
 *
 * Responsibility:
 *   skinned geometry
 *     -> foot probes
 *     -> SurfaceQuery measurements
 *     -> contact evidence
 *     -> existing ContactState consumer
 *
 * This module does NOT:
 *   - write bones or poses;
 *   - perform IK;
 *   - create or resolve tasks;
 *   - modify ContactState directly;
 *   - own a second animation pipeline.
 *
 * Important separation:
 *   validProbeCount = queryDown() results with valid === true.
 *   nearProbeCount  = valid measurements within contactDistance,
 *                     excluding excessive penetration.
 *   confidence      = nearProbeCount / probeCount.
 *   spread          = max separation - min separation.
 *
 * Temporary diagnostic logging is enabled to identify
 * why valid foot probes are not becoming near-contact probes.
 */

export class ContactPerception {
  static DEFAULT_CONFIG = Object.freeze({
    footInfluenceMin: 0.50,
    shinInfluenceMax: 0.05,

    targetProbes: 5,
    clusterY: 0.03,
    maxFootSpan: 0.22,

    heightThreshold: 0.08,
    velocityThreshold: 1.0,
    voteFrames: 5,

    queryMaxDistance: 0.20,
    maxPenetration: 0.035,
    minConfidence: 0.40,
    normalMinY: 0.45,

    fallbackDeltaTime: 1 / 60,
  });

  constructor({
    root,
    skeleton,
    skinnedMesh,
    surfaceQuery,

    footInfluenceMin,
    shinInfluenceMax,
    targetProbes,
    clusterY,
    maxFootSpan,

    heightThreshold,
    velocityThreshold,
    voteFrames,

    contactSeparation,
    contactDistance,
    queryMaxDistance,
    minConfidence,
    normalMinY,
    maxPenetration,
    fallbackDeltaTime,
  } = {}) {
    if (!root) {
      throw new TypeError("ContactPerception: root is required");
    }

    if (!skeleton?.bones) {
      throw new TypeError("ContactPerception: skeleton is required");
    }

    if (!skinnedMesh?.isSkinnedMesh) {
      throw new TypeError(
        "ContactPerception: skinnedMesh must be THREE.SkinnedMesh"
      );
    }

    if (typeof surfaceQuery?.queryDown !== "function") {
      throw new TypeError(
        "ContactPerception: SurfaceQuery.queryDown is required"
      );
    }

    const defaults = ContactPerception.DEFAULT_CONFIG;

    this.root = root;
    this.skeleton = skeleton;
    this.skinnedMesh = skinnedMesh;
    this.surfaceQuery = surfaceQuery;

    this.footInfluenceMin = this._number(
      footInfluenceMin,
      defaults.footInfluenceMin,
      0,
      1
    );

    this.shinInfluenceMax = this._number(
      shinInfluenceMax,
      defaults.shinInfluenceMax,
      0,
      1
    );

    this.targetProbes = Math.round(
      this._number(
        targetProbes,
        defaults.targetProbes,
        3,
        8
      )
    );

    this.clusterY = this._number(
      clusterY,
      defaults.clusterY,
      0.001,
      1
    );

    this.maxFootSpan = this._number(
      maxFootSpan,
      defaults.maxFootSpan,
      0.01,
      2
    );

    this.heightThreshold = this._number(
      heightThreshold,
      defaults.heightThreshold,
      0.001,
      0.5
    );

    /*
     * Preserve the existing contact threshold.
     * If main.js does not supply contactDistance, use heightThreshold.
     */
    this.contactDistance = this._number(
      contactDistance,
      this.heightThreshold,
      0.001,
      0.5
    );

    this.velocityThreshold = this._number(
      velocityThreshold,
      defaults.velocityThreshold,
      0.001,
      10
    );

    this.voteFrames = Math.round(
      this._number(
        voteFrames,
        defaults.voteFrames,
        3,
        9
      )
    );

    /*
     * Backward compatibility with existing callers that pass
     * contactSeparation instead of maxPenetration.
     */
    this.maxPenetration = this._number(
      maxPenetration,
      Number.isFinite(contactSeparation)
        ? contactSeparation
        : defaults.maxPenetration,
      0.001,
      0.25
    );

    this.queryMaxDistance = this._number(
      queryMaxDistance,
      defaults.queryMaxDistance,
      this.heightThreshold,
      2
    );

    this.minConfidence = this._number(
      minConfidence,
      defaults.minConfidence,
      0,
      1
    );

    this.normalMinY = this._number(
      normalMinY,
      defaults.normalMinY,
      -1,
      1
    );

    this.fallbackDeltaTime = this._number(
      fallbackDeltaTime,
      defaults.fallbackDeltaTime,
      1 / 1000,
      0.25
    );

    this._initialized = false;
    this._lastUpdateTime = null;

    this._probeSets = new Map();

    this._probeSets.set(
      "foot_L",
      this._createProbeSet("foot_L", "L")
    );

    this._probeSets.set(
      "foot_R",
      this._createProbeSet("foot_R", "R")
    );

    this._evidence = {
      left: this._createEvidence("foot_L", "L"),
      right: this._createEvidence("foot_R", "R"),
    };

    this._queryResult = {
      valid: false,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      separation: Infinity,
      distance: Infinity,
      surfaceId: null,
      surfaceType: null,
      confidence: 0,
      backend: null,
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(0, -1, 0),
    };

    this._vertexLocal = new THREE.Vector3();
    this._vertexWorld = new THREE.Vector3();

    this._skinIndexScratch = [0, 0, 0, 0];
    this._skinWeightScratch = [0, 0, 0, 0];
  }

  _number(value, fallback, min, max) {
    const number = Number.isFinite(value) ? value : fallback;
    return Math.max(min, Math.min(max, number));
  }

  _createEvidence(bone, side) {
    return {
      valid: false,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      separation: Infinity,
      surfaceId: null,
      surfaceType: null,

      confidence: 0,
      probeCount: 0,
      validProbeCount: 0,
      nearProbeCount: 0,
      spread: 0,
      probeAgreement: 0,

      bone,
      side,
      backend: null,
      timestamp: 0,

      averageSpeed: Infinity,
      heightRatio: 0,
      velocityRatio: 0,
      voteRatio: 0,
      rawContact: false,
      temporalContact: false,

      // Number of measurements passing penetration and normal checks.
      acceptedProbeCount: 0,
    };
  }

  _createProbeSet(logicalBone, side) {
    return {
      logicalBone,
      side,

      count: 0,
      sampleVertices: new Uint32Array(8),

      samples: Array.from(
        { length: 8 },
        () => new THREE.Vector3()
      ),

      previousSamples: Array.from(
        { length: 8 },
        () => new THREE.Vector3()
      ),

      sampleSpeeds: new Float32Array(8),
      sampleHasPrevious: new Uint8Array(8),

      votes: new Uint8Array(this.voteFrames),
      voteCount: 0,
      voteCursor: 0,
      positiveVotes: 0,
      wasTemporallyContacting: false,
    };
  }

  initialize() {
    this.root.updateMatrixWorld(true);
    this.skeleton.update();
    this.skinnedMesh.updateMatrixWorld(true);

    const geometry = this.skinnedMesh.geometry;
    const position = geometry?.getAttribute("position");
    const skinIndex = geometry?.getAttribute("skinIndex");
    const skinWeight = geometry?.getAttribute("skinWeight");

    if (!position || !skinIndex || !skinWeight) {
      throw new Error(
        "ContactPerception.initialize: position, skinIndex and skinWeight are required"
      );
    }

    const indices = {
      footL: this._findBoneIndex(BONE_MAP.foot_L),
      footR: this._findBoneIndex(BONE_MAP.foot_R),
      toeL: this._findBoneIndex(BONE_MAP.toe_L),
      toeR: this._findBoneIndex(BONE_MAP.toe_R),
      shinL: this._findBoneIndex(BONE_MAP.shin_L),
      shinR: this._findBoneIndex(BONE_MAP.shin_R),
    };

    if (indices.footL < 0 || indices.footR < 0) {
      throw new Error(
        "ContactPerception.initialize: canonical foot bones not found"
      );
    }

    const candidatesL = [];
    const candidatesR = [];

    for (let i = 0; i < position.count; i++) {
      this._readAttribute4(
        skinIndex,
        i,
        this._skinIndexScratch
      );

      this._readAttribute4(
        skinWeight,
        i,
        this._skinWeightScratch
      );

      const leftScore = this._footVertexScore(
        this._skinIndexScratch,
        this._skinWeightScratch,
        indices.footL,
        indices.toeL,
        indices.shinL
      );

      const rightScore = this._footVertexScore(
        this._skinIndexScratch,
        this._skinWeightScratch,
        indices.footR,
        indices.toeR,
        indices.shinR
      );

      if (leftScore > 0) {
        this._readWorldVertex(i, this._vertexWorld);

        candidatesL.push({
          index: i,
          x: this._vertexWorld.x,
          y: this._vertexWorld.y,
          z: this._vertexWorld.z,
          score: leftScore,
        });
      }

      if (rightScore > 0) {
        this._readWorldVertex(i, this._vertexWorld);

        candidatesR.push({
          index: i,
          x: this._vertexWorld.x,
          y: this._vertexWorld.y,
          z: this._vertexWorld.z,
          score: rightScore,
        });
      }
    }

    this._buildProbeSet(
      this._probeSets.get("foot_L"),
      candidatesL
    );

    this._buildProbeSet(
      this._probeSets.get("foot_R"),
      candidatesR
    );

    for (const set of this._probeSets.values()) {
      if (set.count < 3) {
        console.warn(
          `[AstraWay] ContactPerception: ${set.logicalBone} has only ${set.count} probes`
        );
      }
    }

    this._initialized = true;
    return this;
  }

  update(time = 0) {
    if (!this._initialized) {
      this.initialize();
    }

    const dt = this._getDeltaTime(time);
    this._lastUpdateTime = Number.isFinite(time) ? time : 0;

    this._measureProbeSet(
      this._probeSets.get("foot_L"),
      this._evidence.left,
      dt
    );

    this._measureProbeSet(
      this._probeSets.get("foot_R"),
      this._evidence.right,
      dt
    );

    return this._evidence;
  }

  _getDeltaTime(time) {
    if (
      Number.isFinite(time) &&
      Number.isFinite(this._lastUpdateTime) &&
      this._lastUpdateTime !== null
    ) {
      const delta = time - this._lastUpdateTime;

      if (delta > 0.0001 && delta <= 0.25) {
        return delta;
      }
    }

    return this.fallbackDeltaTime;
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

  getProbeCount(logicalBone) {
    return this._probeSets.get(logicalBone)?.count ?? 0;
  }

  isInitialized() {
    return this._initialized;
  }

  _findBoneIndex(name) {
    if (!name) {
      return -1;
    }

    const bones = this.skeleton.bones;

    for (let i = 0; i < bones.length; i++) {
      if (bones[i]?.name === name) {
        return i;
      }
    }

    return -1;
  }

  _readAttribute4(attribute, index, out) {
    const offset = index * attribute.itemSize;
    const array = attribute.array;

    for (let i = 0; i < 4; i++) {
      out[i] = i < attribute.itemSize
        ? (array[offset + i] || 0)
        : 0;
    }

    return out;
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
      if (indices[i] === footIndex) {
        footWeight += weights[i];
      }

      if (toeIndex >= 0 && indices[i] === toeIndex) {
        toeWeight += weights[i];
      }

      if (shinIndex >= 0 && indices[i] === shinIndex) {
        shinWeight += weights[i];
      }
    }

    const footScore = Math.max(footWeight, toeWeight);

    if (footScore < this.footInfluenceMin) {
      return 0;
    }

    if (shinWeight > this.shinInfluenceMax) {
      return 0;
    }

    return footScore;
  }

  _readWorldVertex(vertexIndex, out) {
    /*
     * getVertexPosition applies skinning.
     * matrixWorld converts the skinned vertex into world space.
     */
    this.skinnedMesh.getVertexPosition(
      vertexIndex,
      this._vertexLocal
    );

    out.copy(this._vertexLocal);
    out.applyMatrix4(this.skinnedMesh.matrixWorld);

    return out;
  }

  _buildProbeSet(set, candidates) {
    set.count = 0;

    if (!candidates.length) {
      return;
    }

    let lowestY = Infinity;

    for (const candidate of candidates) {
      if (candidate.y < lowestY) {
        lowestY = candidate.y;
      }
    }

    const cluster = candidates.filter(
      (candidate) => candidate.y <= lowestY + this.clusterY
    );

    if (!cluster.length) {
      return;
    }

    const selected = [];
    let first = cluster[0];

    for (const candidate of cluster) {
      if (candidate.y < first.y) {
        first = candidate;
      }
    }

    selected.push(first);

    /*
     * Choose spatially separated vertices to sample different
     * regions of the foot instead of repeatedly sampling one triangle.
     */
    while (
      selected.length < this.targetProbes &&
      selected.length < cluster.length
    ) {
      let best = null;
      let bestDistance = -1;

      for (const candidate of cluster) {
        const alreadySelected = selected.some(
          (chosen) => candidate.index === chosen.index
        );

        if (alreadySelected) {
          continue;
        }

        let nearestSq = Infinity;

        for (const chosen of selected) {
          const dx = candidate.x - chosen.x;
          const dy = candidate.y - chosen.y;
          const dz = candidate.z - chosen.z;

          const distanceSq =
            dx * dx + dz * dz + dy * dy * 0.25;

          nearestSq = Math.min(nearestSq, distanceSq);
        }

        if (nearestSq > bestDistance) {
          bestDistance = nearestSq;
          best = candidate;
        }
      }

      if (!best) {
        break;
      }

      selected.push(best);
    }

    /*
     * If the lowest cluster is too small, supplement it with
     * additional low, foot-influenced vertices.
     */
    if (selected.length < Math.min(3, this.targetProbes)) {
      const extras = candidates
        .filter(
          (candidate) =>
            candidate.y <= lowestY + this.clusterY * 2
        )
        .sort((a, b) => a.y - b.y);

      for (const candidate of extras) {
        if (selected.length >= this.targetProbes) {
          break;
        }

        if (
          !selected.some(
            (item) => item.index === candidate.index
          )
        ) {
          selected.push(candidate);
        }
      }
    }

    set.count = Math.min(
      selected.length,
      this.targetProbes
    );

    for (let i = 0; i < set.count; i++) {
      const candidate = selected[i];

      set.sampleVertices[i] = candidate.index;

      set.samples[i].set(
        candidate.x,
        candidate.y,
        candidate.z
      );

      set.previousSamples[i].copy(set.samples[i]);
      set.sampleHasPrevious[i] = 0;
      set.sampleSpeeds[i] = Infinity;
    }
  }

  _resetEvidence(evidence, set) {
    evidence.valid = false;

    evidence.point.set(0, 0, 0);
    evidence.normal.set(0, 1, 0);

    evidence.separation = Infinity;
    evidence.surfaceId = null;
    evidence.surfaceType = null;

    evidence.confidence = 0;
    evidence.probeCount = set.count;
    evidence.validProbeCount = 0;
    evidence.nearProbeCount = 0;
    evidence.spread = 0;
    evidence.probeAgreement = 0;

    evidence.backend = null;
    evidence.timestamp = this._lastUpdateTime ?? 0;

    evidence.averageSpeed = Infinity;
    evidence.heightRatio = 0;
    evidence.velocityRatio = 0;
    evidence.voteRatio = 0;

    evidence.rawContact = false;
    evidence.temporalContact = false;
    evidence.acceptedProbeCount = 0;
  }

  _measureProbeSet(set, evidence, dt) {
    this._resetEvidence(evidence, set);

    if (set.count === 0) {
      this._pushVote(set, false);
      set.wasTemporallyContacting = false;
      this._updateVoteDiagnostics(set, evidence);
      return;
    }

    this.root.updateMatrixWorld(true);
    this.skeleton.update();
    this.skinnedMesh.updateMatrixWorld(true);

    let validCount = 0;
    let nearCount = 0;
    let acceptedCount = 0;
    let acceptedNearCount = 0;
    let slowCount = 0;

    let minSeparation = Infinity;
    let maxSeparation = -Infinity;
    let totalSpeed = 0;
    let speedSampleCount = 0;

    let pointX = 0;
    let pointY = 0;
    let pointZ = 0;

    let normalX = 0;
    let normalY = 0;
    let normalZ = 0;

    let surfaceId = null;
    let surfaceType = null;
    let backend = null;
    let matchingSurfaceCount = 0;

    for (let i = 0; i < set.count; i++) {
      const vertexIndex = set.sampleVertices[i];

      this._readWorldVertex(
        vertexIndex,
        this._vertexWorld
      );

      const sample = set.samples[i];
      const previous = set.previousSamples[i];

      sample.copy(this._vertexWorld);

      let speed = Infinity;

      if (set.sampleHasPrevious[i] && dt > 0) {
        speed = sample.distanceTo(previous) / dt;
      }

      set.sampleSpeeds[i] = speed;

      previous.copy(sample);
      set.sampleHasPrevious[i] = 1;

      const result = this.surfaceQuery.queryDown({
        origin: sample,
        maxDistance: this.queryMaxDistance,
        out: this._queryResult,
      });

      /*
       * Contract:
       * validProbeCount counts every queryDown result marked valid.
       * Do this before penetration and normal filtering.
       */
      if (!result || result.valid !== true) {
        continue;
      }

      validCount++;

      const separation = result.separation;

      /*
       * TEMPORARY DIAGNOSTIC:
       * Print the raw separation and the exact near-contact decision.
       * This does not change the contact calculation.
       */
      console.log("[AstraWay ContactProbe]", {
        side: set.side,
        probe: i,
        separation: Number.isFinite(separation)
          ? Number(separation.toFixed(4))
          : separation,
        contactDistance: this.contactDistance,
        maxPenetration: this.maxPenetration,
        near: Number.isFinite(separation)
          && separation <= this.contactDistance,
        rejectedByPenetration: Number.isFinite(separation)
          && separation < -this.maxPenetration,
      });

      /*
       * Spread uses all valid, finite separation measurements.
       * It is diagnostic only; it does not suppress contact.
       */
      if (Number.isFinite(separation)) {
        minSeparation = Math.min(
          minSeparation,
          separation
        );

        maxSeparation = Math.max(
          maxSeparation,
          separation
        );
      }

      /*
       * A probe deeply below the surface is not near-contact evidence.
       * This safety rule is independent of the confidence formula.
       */
      if (!Number.isFinite(separation)) {
        continue;
      }

      if (separation < -this.maxPenetration) {
        continue;
      }

      /*
       * Count near probes after the penetration guard.
       * The normal check remains a separate safety condition for
       * accepted surface contact.
       */
      const near = separation <= this.contactDistance;

      if (near) {
        nearCount++;
      }

      if (
        !Number.isFinite(result.normal?.y) ||
        result.normal.y < this.normalMinY
      ) {
        continue;
      }

      acceptedCount++;

      if (near) {
        acceptedNearCount++;
      }

      if (
        Number.isFinite(speed) &&
        speed <= this.velocityThreshold
      ) {
        slowCount++;
      }

      if (Number.isFinite(speed)) {
        totalSpeed += speed;
        speedSampleCount++;
      }

      if (
        result.point &&
        Number.isFinite(result.point.x) &&
        Number.isFinite(result.point.y) &&
        Number.isFinite(result.point.z)
      ) {
        pointX += result.point.x;
        pointY += result.point.y;
        pointZ += result.point.z;
      } else {
        /*
         * A valid contact candidate must still have a usable point.
         * Do not include malformed points in the accepted surface sum.
         */
        acceptedCount--;

        if (near) {
          acceptedNearCount--;
        }

        continue;
      }

      normalX += result.normal.x;
      normalY += result.normal.y;
      normalZ += result.normal.z;

      if (surfaceId === null) {
        surfaceId = result.surfaceId;
        surfaceType = result.surfaceType;
        backend = result.backend;
        matchingSurfaceCount = 1;
      } else if (
        surfaceId === result.surfaceId &&
        surfaceType === result.surfaceType
      ) {
        matchingSurfaceCount++;
      }
    }

    evidence.validProbeCount = validCount;
    evidence.nearProbeCount = nearCount;
    evidence.acceptedProbeCount = acceptedCount;

    evidence.confidence = set.count > 0
      ? nearCount / set.count
      : 0;

    evidence.confidence = Math.max(
      0,
      Math.min(1, evidence.confidence)
    );

    evidence.probeAgreement = evidence.confidence;

    if (Number.isFinite(minSeparation)) {
      evidence.separation = minSeparation;
    }

    if (
      Number.isFinite(minSeparation) &&
      Number.isFinite(maxSeparation)
    ) {
      evidence.spread = Math.max(
        0,
        maxSeparation - minSeparation
      );
    } else {
      evidence.spread = 0;
    }

    /*
     * No usable surface measurements: record a negative temporal vote
     * and clear stale temporal contact.
     */
    if (validCount === 0 || acceptedCount === 0) {
      this._pushVote(set, false);
      set.wasTemporallyContacting = false;

      evidence.heightRatio = set.count > 0
        ? nearCount / set.count
        : 0;

      evidence.velocityRatio = 0;
      evidence.averageSpeed = Infinity;
      evidence.rawContact = false;
      evidence.temporalContact = false;

      this._updateVoteDiagnostics(set, evidence);
      return;
    }

    const nearRatio = nearCount / set.count;
    const slowRatio = slowCount / set.count;
    const surfaceRatio = matchingSurfaceCount / acceptedCount;

    /*
     * Keep existing temporal and surface-safety requirements.
     * Confidence is NOT multiplied by these ratios.
     */
    const rawContact = (
      acceptedNearCount >= Math.min(2, set.count) &&
      slowCount >= Math.min(2, set.count) &&
      nearRatio >= 0.4 &&
      slowRatio >= 0.4 &&
      surfaceRatio >= 0.5
    );

    this._pushVote(set, rawContact);

    const yes = set.positiveVotes;

    const unanimous = (
      set.voteCount >= this.voteFrames &&
      yes === set.voteCount
    );

    const majority = (
      set.voteCount >= this.voteFrames &&
      yes > set.voteCount / 2
    );

    const temporalContact = set.wasTemporallyContacting
      ? majority
      : unanimous;

    set.wasTemporallyContacting = temporalContact;

    evidence.heightRatio = nearRatio;
    evidence.velocityRatio = slowRatio;
    evidence.rawContact = rawContact;
    evidence.temporalContact = temporalContact;

    evidence.averageSpeed = speedSampleCount > 0
      ? totalSpeed / speedSampleCount
      : Infinity;

    evidence.surfaceId = surfaceId;
    evidence.surfaceType = surfaceType;
    evidence.backend = backend;

    const inverse = 1 / acceptedCount;

    evidence.point.set(
      pointX * inverse,
      pointY * inverse,
      pointZ * inverse
    );

    evidence.normal.set(
      normalX,
      normalY,
      normalZ
    );

    if (
      Number.isFinite(evidence.normal.lengthSq()) &&
      evidence.normal.lengthSq() > EPSILON
    ) {
      evidence.normal.normalize();
    } else {
      evidence.normal.set(0, 1, 0);
    }

    /*
     * Preserve the established consumer contract:
     * valid means temporally confirmed, sufficiently confident,
     * supported by multiple near probes, and backed by finite geometry.
     */
    evidence.valid = (
      temporalContact &&
      evidence.confidence >= this.minConfidence &&
      acceptedNearCount >= Math.min(2, set.count) &&
      Number.isFinite(evidence.point.x) &&
      Number.isFinite(evidence.point.y) &&
      Number.isFinite(evidence.point.z)
    );

    this._updateVoteDiagnostics(set, evidence);
  }

  _pushVote(set, value) {
    const vote = value ? 1 : 0;

    if (set.voteCount < this.voteFrames) {
      set.votes[set.voteCursor] = vote;
      set.positiveVotes += vote;
      set.voteCount++;
    } else {
      set.positiveVotes -= set.votes[set.voteCursor];
      set.votes[set.voteCursor] = vote;
      set.positiveVotes += vote;
    }

    set.voteCursor = (
      set.voteCursor + 1
    ) % this.voteFrames;
  }

  _updateVoteDiagnostics(set, evidence) {
    evidence.voteRatio = set.voteCount > 0
      ? set.positiveVotes / set.voteCount
      : 0;

    evidence.temporalContact = set.wasTemporallyContacting;
  }
}

export default ContactPerception;
