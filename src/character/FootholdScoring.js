// src/character/FootholdScoring.js

/**
 * FootholdScoring
 *
 * Оценивает пригодность измеренных участков поверхности
 * для постановки стопы.
 *
 * Только оценка:
 * - не выбирает действие;
 * - не создаёт Task или Constraint;
 * - не изменяет TerrainPerception;
 * - не перемещает тело и не записывает кости.
 */
export class FootholdScoring {
  static DEFAULT_CONFIG = Object.freeze({
    maxStepHeight: 0.12,
    maxSlopeRadians: Math.PI / 6,
    footRadius: 0.13,
    edgeMargin: 0.04,
    edgePenaltyRange: 0.45,
    supportRadius: 0.24,
    minSupportSamples: 2,
    maxLocalHeightRange: 0.035,
  });

  constructor(config = {}) {
    const defaults = FootholdScoring.DEFAULT_CONFIG;

    this.config = {
      maxStepHeight: this._number(
        config.maxStepHeight,
        defaults.maxStepHeight,
        0.01,
        1
      ),

      maxSlopeRadians: this._number(
        config.maxSlopeRadians,
        defaults.maxSlopeRadians,
        0.01,
        Math.PI / 2
      ),

      footRadius: this._number(
        config.footRadius,
        defaults.footRadius,
        0.02,
        0.5
      ),

      edgeMargin: this._number(
        config.edgeMargin,
        defaults.edgeMargin,
        0,
        0.5
      ),

      edgePenaltyRange: this._number(
        config.edgePenaltyRange,
        defaults.edgePenaltyRange,
        0.05,
        2
      ),

      supportRadius: this._number(
        config.supportRadius,
        defaults.supportRadius,
        0.05,
        1
      ),

      minSupportSamples: Math.round(
        this._number(
          config.minSupportSamples,
          defaults.minSupportSamples,
          1,
          9
        )
      ),

      maxLocalHeightRange: this._number(
        config.maxLocalHeightRange,
        defaults.maxLocalHeightRange,
        0.005,
        0.5
      ),
    };
  }

  _number(value, fallback, min, max) {
    const number = Number.isFinite(value)
      ? value
      : fallback;

    return Math.max(min, Math.min(max, number));
  }

  /**
   * Оценивает все валидные пробы TerrainPerception.
   *
   * Возвращает:
   * - candidates — кандидаты по индексам проб;
   * - ranked — кандидаты по убыванию оценки;
   * - best — лучший допустимый кандидат;
   * - summary — статистику оценки.
   */
  evaluate(terrainSummary) {
    const samples = terrainSummary?.samples;

    if (!Array.isArray(samples)) {
      throw new TypeError(
        "FootholdScoring.evaluate: samples are required"
      );
    }

    const edges = this._findEdges(samples);

    const candidates = new Array(samples.length).fill(null);

    const ranked = [];

    for (const sample of samples) {
      if (!sample?.valid) {
        continue;
      }

      const candidate = this._evaluateSample(
        sample,
        samples,
        edges
      );

      candidates[sample.index] = candidate;

      if (candidate.eligible) {
        ranked.push(candidate);
      }
    }

    ranked.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (a.row !== b.row) {
        return a.row - b.row;
      }

      return (
        Math.abs(a.column - 2) -
        Math.abs(b.column - 2)
      );
    });

    const eligibleCount = ranked.length;

    const rejectedCount =
      samples.filter((sample) => sample?.valid).length -
      eligibleCount;

    return {
      candidates,
      ranked,
      best: ranked[0] || null,

      summary: {
        candidateCount: samples.filter(
          (sample) => sample?.valid
        ).length,

        eligibleCount,
        rejectedCount,
        edgeCount: edges.length,
      },
    };
  }

  /**
   * Находит перепады между соседними пробами.
   * Каждая граница представлена серединой между
   * двумя точками с разной высотой.
   */
  _findEdges(samples) {
    const edges = [];

    const byGridPosition = new Map();

    for (const sample of samples) {
      if (!sample?.valid) continue;

      byGridPosition.set(
        `${sample.row}:${sample.column}`,
        sample
      );
    }

    for (const sample of samples) {
      if (!sample?.valid) continue;

      const neighbors = [
        byGridPosition.get(
          `${sample.row}:${sample.column + 1}`
        ),

        byGridPosition.get(
          `${sample.row + 1}:${sample.column}`
        ),
      ];

      for (const neighbor of neighbors) {
        if (!neighbor?.valid) continue;

        const heightDifference = Math.abs(
          sample.height - neighbor.height
        );

        if (
          heightDifference <=
          this.config.maxStepHeight
        ) {
          continue;
        }

        edges.push({
          x: (
            sample.point.x +
            neighbor.point.x
          ) * 0.5,

          z: (
            sample.point.z +
            neighbor.point.z
          ) * 0.5,

          heightDifference,
        });
      }
    }

    return edges;
  }

  _evaluateSample(sample, samples, edges) {
    const reasons = [];

    const localSamples = [];

    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (const other of samples) {
      if (!other?.valid) continue;

      const distance = Math.hypot(
        sample.point.x - other.point.x,
        sample.point.z - other.point.z
      );

      if (distance > this.config.supportRadius) {
        continue;
      }

      localSamples.push(other);

      minHeight = Math.min(
        minHeight,
        other.height
      );

      maxHeight = Math.max(
        maxHeight,
        other.height
      );
    }

    const supportCount = localSamples.length;

    const localHeightRange =
      supportCount > 0
        ? maxHeight - minHeight
        : Infinity;

    const slopeRadians = Number.isFinite(
      sample.slopeRadians
    )
      ? sample.slopeRadians
      : Math.PI / 2;

    let edgeClearance = Infinity;

    for (const edge of edges) {
      const distance = Math.hypot(
        sample.point.x - edge.x,
        sample.point.z - edge.z
      );

      edgeClearance = Math.min(
        edgeClearance,
        distance
      );
    }

    const requiredEdgeClearance =
      this.config.footRadius +
      this.config.edgeMargin;

    if (
      slopeRadians >
      this.config.maxSlopeRadians
    ) {
      reasons.push("SLOPE");
    }

    if (
      supportCount <
      this.config.minSupportSamples
    ) {
      reasons.push("SUPPORT");
    }

    if (
      localHeightRange >
      this.config.maxLocalHeightRange
    ) {
      reasons.push("ROUGH");
    }

    if (
      edgeClearance <
      requiredEdgeClearance
    ) {
      reasons.push("EDGE");
    }

    const eligible = reasons.length === 0;

    const slopePenalty =
      Math.min(
        1,
        slopeRadians /
          this.config.maxSlopeRadians
      ) * 20;

    const roughnessPenalty =
      Math.min(
        1,
        localHeightRange /
          this.config.maxLocalHeightRange
      ) * 15;

    const edgePenalty =
      Number.isFinite(edgeClearance)
        ? Math.max(
            0,
            (
              this.config.edgePenaltyRange -
              edgeClearance
            ) /
            this.config.edgePenaltyRange
          ) * 25
        : 0;

    const supportBonus = Math.min(
      12,
      Math.max(0, supportCount - 1) * 3
    );

    const score = Math.max(
      0,
      Math.min(
        100,
        100 -
          slopePenalty -
          roughnessPenalty -
          edgePenalty +
          supportBonus
      )
    );

    return {
      index: sample.index,
      row: sample.row,
      column: sample.column,

      x: sample.point.x,
      y: sample.point.y,
      z: sample.point.z,

      height: sample.height,

      score: Math.round(score * 10) / 10,

      eligible,
      reasons,

      supportCount,
      localHeightRange,
      slopeRadians,
      edgeClearance,

      surfaceId: sample.surfaceId,
      surfaceType: sample.surfaceType,
    };
  }
}

export default FootholdScoring;
