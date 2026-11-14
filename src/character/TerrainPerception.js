
// src/character/TerrainPerception.js

import * as THREE from "three";

/**
 * TerrainPerception
 *
 * Локальное восприятие поверхности перед персонажем.
 *
 * Только наблюдение:
 * - высота;
 * - нормаль поверхности;
 * - уклон;
 * - перепады высоты;
 * - отсутствие геометрии.
 *
 * Не выбирает опору, не создаёт задачи,
 * не перемещает тело и не записывает кости.
 */
export class TerrainPerception {
  static DEFAULT_CONFIG = Object.freeze({
    columns: 5,
    rows: 5,
    lateralSpan: 0.8,
    forwardStart: 0.25,
    forwardSpan: 1.5,
    rayStartHeight: 1.5,
    maxDrop: 2.5,
    maxStepHeight: 0.12,
    maxSlopeRadians: THREE.MathUtils.degToRad(42),
  });

  constructor({
    surfaceQuery,
    columns,
    rows,
    lateralSpan,
    forwardStart,
    forwardSpan,
    rayStartHeight,
    maxDrop,
    maxStepHeight,
    maxSlopeRadians,
  } = {}) {
    if (typeof surfaceQuery?.queryDown !== "function") {
      throw new TypeError(
        "TerrainPerception: SurfaceQuery.queryDown is required"
      );
    }

    const defaults = TerrainPerception.DEFAULT_CONFIG;

    this.surfaceQuery = surfaceQuery;

    this.columns = this._integer(
      columns, defaults.columns, 3, 9
    );

    this.rows = this._integer(
      rows, defaults.rows, 2, 12
    );

    this.lateralSpan = this._number(
      lateralSpan, defaults.lateralSpan, 0.1, 4
    );

    this.forwardStart = this._number(
      forwardStart, defaults.forwardStart, 0, 2
    );

    this.forwardSpan = this._number(
      forwardSpan, defaults.forwardSpan, 0.2, 6
    );

    this.rayStartHeight = this._number(
      rayStartHeight, defaults.rayStartHeight, 0.2, 5
    );

    this.maxDrop = this._number(
      maxDrop, defaults.maxDrop, 0.2, 8
    );

    this.maxStepHeight = this._number(
      maxStepHeight, defaults.maxStepHeight, 0.01, 1
    );

    this.maxSlopeRadians = this._number(
      maxSlopeRadians,
      defaults.maxSlopeRadians,
      0,
      Math.PI / 2
    );

    this._up = new THREE.Vector3(0, 1, 0);
    this._right = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._rayOrigin = new THREE.Vector3();

    this._samples = [];

    const count = this.columns * this.rows;

    for (let i = 0; i < count; i++) {
      this._samples.push({
        index: i,
        row: Math.floor(i / this.columns),
        column: i % this.columns,

        valid: false,

        point: new THREE.Vector3(),
        normal: new THREE.Vector3(0, 1, 0),

        height: NaN,
        heightDelta: NaN,
        slopeRadians: NaN,

        surfaceId: null,
        surfaceType: null,
        backend: null,

        steep: false,
        heightDiscontinuity: false,

        _query: {
          valid: false,
          point: new THREE.Vector3(),
          normal: new THREE.Vector3(0, 1, 0),
          separation: 0,
          distance: Infinity,
          hitDistance: Infinity,
          angleToQuery: null,
          surfaceId: null,
          surfaceType: null,
          object: null,
          face: null,
          confidence: 0,
          backend: null,
          origin: new THREE.Vector3(),
          direction: new THREE.Vector3(0, -1, 0),
        },
      });
    }

    this._summary = {
      validCount: 0,
      missingCount: count,
      steepCount: 0,
      discontinuityCount: 0,
      sampleCount: count,
      centerHeight: NaN,
      samples: this._samples,
    };
  }

  _number(value, fallback, min, max) {
    const number = Number.isFinite(value)
      ? value
      : fallback;

    return Math.max(min, Math.min(max, number));
  }

  _integer(value, fallback, min, max) {
    return Math.round(
      this._number(value, fallback, min, max)
    );
  }

  /**
   * Сканирует прямоугольную область перед персонажем.
   *
   * origin и forward — мировые THREE.Vector3.
   *
   * Результаты переиспользуются между кадрами.
   */
  scan({
    origin,
    forward,
  } = {}) {
    if (!origin?.isVector3 || !forward?.isVector3) {
      throw new TypeError(
        "TerrainPerception.scan: origin and forward Vector3 are required"
      );
    }

    this._forward.copy(forward);
    this._forward.y = 0;

    if (this._forward.lengthSq() < 1e-8) {
      throw new Error(
        "TerrainPerception.scan: forward direction is zero"
      );
    }

    this._forward.normalize();

    // Для направления +Z правая сторона — +X.
    this._right
      .crossVectors(this._up, this._forward)
      .normalize();

    let validCount = 0;
    let steepCount = 0;
    let discontinuityCount = 0;

    const centerColumn = (this.columns - 1) * 0.5;
    const centerRow = (this.rows - 1) * 0.5;

    for (const sample of this._samples) {
      const lateral = (
        (sample.column - centerColumn) /
        Math.max(centerColumn, 1)
      ) * (this.lateralSpan * 0.5);

      const forwardDistance =
        this.forwardStart +
        (sample.row / Math.max(this.rows - 1, 1)) *
        this.forwardSpan;

      this._rayOrigin
        .copy(origin)
        .addScaledVector(this._right, lateral)
        .addScaledVector(this._forward, forwardDistance);

      this._rayOrigin.y += this.rayStartHeight;

      const result = this.surfaceQuery.queryDown({
        origin: this._rayOrigin,

        maxDistance:
          this.rayStartHeight + this.maxDrop,

        // Не подменяем отсутствие геометрии
        // бесконечной резервной плоскостью.
        filter: (hit) =>
          hit.backend !== "ground-plane",

        out: sample._query,
      });

      sample.valid = !!result?.valid;

      sample.steep = false;
      sample.heightDiscontinuity = false;

      sample.height = NaN;
      sample.heightDelta = NaN;
      sample.slopeRadians = NaN;

      sample.surfaceId = null;
      sample.surfaceType = null;
      sample.backend = null;

      if (!sample.valid) {
        continue;
      }

      sample.point.copy(result.point);
      sample.normal.copy(result.normal);

      sample.height = result.point.y;

      sample.slopeRadians = Math.acos(
        THREE.MathUtils.clamp(
          result.normal.y,
          -1,
          1
        )
      );

      sample.steep =
        sample.slopeRadians > this.maxSlopeRadians;

      sample.surfaceId = result.surfaceId;
      sample.surfaceType = result.surfaceType;
      sample.backend = result.backend;

      validCount++;

      if (sample.steep) {
        steepCount++;
      }
    }

    // Ищем резкие перепады между соседними ячейками.
    // Это геометрический признак, а не готовая классификация стены.
    for (const sample of this._samples) {
      if (!sample.valid) continue;

      const rightIndex =
        sample.row * this.columns +
        sample.column + 1;

      const nextRowIndex =
        (sample.row + 1) * this.columns +
        sample.column;

      if (
        sample.column + 1 < this.columns &&
        this._samples[rightIndex].valid &&
        Math.abs(
          sample.height -
          this._samples[rightIndex].height
        ) > this.maxStepHeight
      ) {
        sample.heightDiscontinuity = true;

        this._samples[rightIndex]
          .heightDiscontinuity = true;
      }

      if (
        sample.row + 1 < this.rows &&
        this._samples[nextRowIndex].valid &&
        Math.abs(
          sample.height -
          this._samples[nextRowIndex].height
        ) > this.maxStepHeight
      ) {
        sample.heightDiscontinuity = true;

        this._samples[nextRowIndex]
          .heightDiscontinuity = true;
      }
    }

    for (const sample of this._samples) {
      if (sample.heightDiscontinuity) {
        discontinuityCount++;
      }
    }

    const centerIndex =
      Math.floor(centerRow) * this.columns +
      Math.floor(centerColumn);

    const center = this._samples[centerIndex];

    for (const sample of this._samples) {
      sample.heightDelta =
        sample.valid && center?.valid
          ? sample.height - center.height
          : NaN;
    }

    this._summary.validCount = validCount;

    this._summary.missingCount =
      this._samples.length - validCount;

    this._summary.steepCount = steepCount;

    this._summary.discontinuityCount =
      discontinuityCount;

    this._summary.centerHeight =
      center?.valid
        ? center.height
        : NaN;

    return this._summary;
  }

  getSummary() {
    return this._summary;
  }
}

export default TerrainPerception;
