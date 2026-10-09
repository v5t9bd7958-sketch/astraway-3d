
// src/character/ContactPerception.js
import * as THREE from "three";
import { BONE_MAP } from "./BoneMap.js";

const EPSILON = 1e-8;

export class ContactPerception {
  static DEFAULT_CONFIG = Object.freeze({
    footInfluenceMin: 0.35,
    shinInfluenceMax: 0.30,
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

    if (!surfaceQuery?.queryDown) {
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
      this._number(targetProbes, defaults.targetProbes, 3, 8)
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

    this.velocityThreshold = this._number(
      velocityThreshold,
      defaults.velocityThreshold,
      0.001,
      10
    );

    this.voteFrames = Math.round(
      this._number(voteFrames, defaults.voteFrames, 3, 9)
    );

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
    this._probeSets.set("foot_L", this._createProbeSet("foot_L", "L"));
    this._probeSets.set("foot_R", this._createProbeSet("foot_R", "R"));

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
      spread: 0,
      surfaceId: null,
      surfaceType: null,
      confidence: 0,
      probeCount: 0,
      validProbeCount: 0,
      nearProbeCount: 0,
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
      this._readAttribute4(skinIndex, i, this._skinIndexScratch);
      this._readAttribute4(skinWeight, i, this._skinWeightScratch);

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
