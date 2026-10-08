// src/character/ConstraintSolver.js

import * as THREE from 'three';

/**
 * ConstraintSolver
 *
 * Damped Least Squares (DLS) positional solver.
 *
 * IMPORTANT OWNERSHIP RULE:
 * - Solver NEVER mutates bones.
 * - Solver NEVER calls IK.
 * - Solver NEVER writes pose.
 * - Solver only reads the current skeleton state and returns a delta pose.
 *
 * Pipeline:
 *
 *   ConstraintSet
 *        ↓
 *   ConstraintSolver
 *        ↓
 *   deltaPose
 *        ↓
 *   PoseWriter
 *        ↓
 *   Skeleton
 *
 * Mathematical core:
 *
 *   Δθ = Jᵀ (J Jᵀ + λ² I)⁻¹ e
 *
 * For a 3D positional constraint:
 *
 *   J = 3 × (3N)
 *
 * and therefore:
 *
 *   J Jᵀ = 3 × 3
 *
 * This keeps the actual matrix inversion very small and suitable
 * for mobile / iPhone runtime.
 */

export class ConstraintSolver {
    constructor({
        skeleton = null,

        damping = 0.12,

        /**
         * Maximum angular delta applied to a single bone
         * during one solver step.
         *
         * Radians.
         */
        maxAngleStep = 0.20,

        /**
         * Position error below this value is considered solved.
         */
        positionTolerance = 0.005,

        enabled = true
    } = {}) {
        this.skeleton = skeleton;

        this.damping = damping;
        this.maxAngleStep = maxAngleStep;
        this.positionTolerance = positionTolerance;

        this.enabled = enabled;

        this.solveCount = 0;
        this.lastSolveTime = 0;
        this.lastResult = null;
    }

    setSkeleton(skeleton) {
        this.skeleton = skeleton;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
    }

    /**
     * Main entry point.
     *
     * Returns:
     *
     * {
     *   status,
     *   solved,
     *   constraints,
     *   deltaPose,
     *   maxError,
     *   totalDelta,
     *   solveTime
     * }
     */
    solve(constraintSet, {
        skeleton = this.skeleton
    } = {}) {
        const start = performance.now();

        this.solveCount++;

        if (!this.enabled) {
            return this._finish({
                status: 'disabled',
                solved: false,
                constraints: 0,
                deltaPose: [],
                maxError: 0,
                totalDelta: 0,
                solveTime: performance.now() - start
            });
        }

        if (!skeleton) {
            return this._finish({
                status: 'no-skeleton',
                solved: false,
                constraints: 0,
                deltaPose: [],
                maxError: 0,
                totalDelta: 0,
                solveTime: performance.now() - start
            });
        }

        if (!constraintSet) {
            return this._finish({
                status: 'no-constraints',
                solved: true,
                constraints: 0,
                deltaPose: [],
                maxError: 0,
                totalDelta: 0,
                solveTime: performance.now() - start
            });
        }

        const constraints = typeof constraintSet.getEnabled === 'function'
            ? constraintSet.getEnabled()
            : [];

        if (!constraints.length) {
            return this._finish({
                status: 'empty',
                solved: true,
                constraints: 0,
                deltaPose: [],
                maxError: 0,
                totalDelta: 0,
                solveTime: performance.now() - start
            });
        }

        /**
         * Make sure matrices represent the pose that currently exists.
         *
         * This is READ/UPDATE state only.
         * No bone transforms are modified here.
         */
        this._updateWorldMatrices(skeleton);

        const deltaPose = new Map();

        let maxError = 0;
        let anyUnsolved = false;
        let totalDelta = 0;
        let solvedConstraints = 0;

        for (const constraint of constraints) {
            if (!constraint || constraint.enabled === false) {
                continue;
            }

            if (constraint.type === 'position') {
                const result = this._solvePositionConstraint(
                    constraint,
                    skeleton,
                    deltaPose
                );

                maxError = Math.max(maxError, result.error);

                if (result.solved) {
                    solvedConstraints++;
                } else {
                    anyUnsolved = true;
                }

                totalDelta += result.deltaMagnitude;
            }
        }

        const poseArray = this._mapToPoseArray(deltaPose);

        let status = 'dls';

        if (solvedConstraints === constraints.length) {
            status = 'solved';
        } else if (poseArray.length === 0) {
            status = 'no-delta';
        }

        return this._finish({
            status,
            solved: !anyUnsolved,
            constraints: constraints.length,
            solvedConstraints,
            deltaPose: poseArray,
            maxError,
            totalDelta,
            solveTime: performance.now() - start
        });
    }

    /**
     * Solve one positional constraint.
     *
     * This is one DLS step.
     *
     * It intentionally does NOT mutate the skeleton.
     */
    _solvePositionConstraint(constraint, skeleton, deltaPose) {
        const bone = this._resolveBone(constraint, skeleton);

        if (!bone) {
            return {
                solved: false,
                error: Infinity,
                deltaMagnitude: 0
            };
        }

        const target = this._getTargetWorldPosition(constraint);

        if (!target) {
            return {
                solved: false,
                error: Infinity,
                deltaMagnitude: 0
            };
        }

        const current = new THREE.Vector3();

        bone.getWorldPosition(current);

        const error = new THREE.Vector3()
            .subVectors(target, current);

        const errorLength = error.length();

        if (!Number.isFinite(errorLength)) {
            return {
                solved: false,
                error: Infinity,
                deltaMagnitude: 0
            };
        }

        if (errorLength <= this.positionTolerance) {
            return {
                solved: true,
                error: errorLength,
                deltaMagnitude: 0
            };
        }

        const chain = this._buildRotationChain(bone);

        if (!chain.length) {
            return {
                solved: false,
                error: errorLength,
                deltaMagnitude: 0
            };
        }

        /**
         * Jacobian:
         *
         * each rotational DOF contributes:
         *
         *     J_i = axis_world × (effector - joint)
         *
         * We have 3 rows (XYZ task)
         * and 3 rotational DOFs per bone.
         */
        const columns = [];

        for (const joint of chain) {
            const jointPosition = new THREE.Vector3();

            joint.getWorldPosition(jointPosition);

            const offset = new THREE.Vector3()
                .subVectors(current, jointPosition);

            const axes = this._getWorldRotationAxes(joint);

            for (const axis of axes) {
                const column = new THREE.Vector3()
                    .crossVectors(axis, offset);

                columns.push({
                    bone: joint,
                    axis,
                    value: column
                });
            }
        }

        if (!columns.length) {
            return {
                solved: false,
                error: errorLength,
                deltaMagnitude: 0
            };
        }

        /**
         * Compute:
         *
         * A = J Jᵀ + λ² I
         *
         * A is 3×3.
         */
        const lambda = Math.max(0.000001, this.damping);
        const lambdaSq = lambda * lambda;

        const a00 = lambdaSq;
        const a01 = 0;
        const a02 = 0;

        const a10 = 0;
        const a11 = lambdaSq;
        const a12 = 0;

        const a20 = 0;
        const a21 = 0;
        const a22 = lambdaSq;

        let m00 = a00;
        let m01 = a01;
        let m02 = a02;

        let m10 = a10;
        let m11 = a11;
        let m12 = a12;

        let m20 = a20;
        let m21 = a21;
        let m22 = a22;

        for (const column of columns) {
            const j = column.value;

            m00 += j.x * j.x;
            m01 += j.x * j.y;
            m02 += j.x * j.z;

            m10 += j.y * j.x;
            m11 += j.y * j.y;
            m12 += j.y * j.z;

            m20 += j.z * j.x;
            m21 += j.z * j.y;
            m22 += j.z * j.z;
        }

        /**
         * Invert 3×3 matrix.
         *
         * Damping keeps the matrix away from singularity.
         */
        const inverse = this._invert3x3(
            m00, m01, m02,
            m10, m11, m12,
            m20, m21, m22
        );

        if (!inverse) {
            return {
                solved: false,
                error: errorLength,
                deltaMagnitude: 0
            };
        }

        /**
         * y = (J Jᵀ + λ²I)^-1 e
         */
        const y = new THREE.Vector3(
            inverse.m00 * error.x +
                inverse.m01 * error.y +
                inverse.m02 * error.z,

            inverse.m10 * error.x +
                inverse.m11 * error.y +
                inverse.m12 * error.z,

            inverse.m20 * error.x +
                inverse.m21 * error.y +
                inverse.m22 * error.z
        );

        /**
         * Δθ = Jᵀ y
         */
        for (const column of columns) {
            const j = column.value;

            const delta =
                j.x * y.x +
                j.y * y.y +
                j.z * y.z;

            if (!Number.isFinite(delta)) {
                continue;
            }

            const clamped = THREE.MathUtils.clamp(
                delta,
                -this.maxAngleStep,
                this.maxAngleStep
            );

            let entry = deltaPose.get(column.bone);

            if (!entry) {
                entry = {
                    bone: column.bone,
                    rotationWorld: new THREE.Vector3()
                };

                deltaPose.set(column.bone, entry);
            }

            entry.rotationWorld.addScaledVector(
                column.axis,
                clamped
            );
        }

        /**
         * This is deliberately only a one-step DLS solver.
         *
         * We do not pretend that the predicted post-step error
         * is the real measured error, because we have not yet
         * applied the pose.
         */
        const deltaMagnitude = this._calculateDeltaMagnitude(
            deltaPose,
            chain
        );

        return {
            solved: false,
            error: errorLength,
            deltaMagnitude
        };
    }

    /**
     * Resolve the constraint's logical bone.
     */
    _resolveBone(constraint, skeleton) {
        const metadata = constraint.metadata || {};

        const boneName =
            metadata.bone ||
            constraint.boneName ||
            constraint.bone ||
            null;

        if (!boneName) {
            return null;
        }

        if (typeof skeleton.getBoneByName === 'function') {
            const bone = skeleton.getBoneByName(boneName);

            if (bone) {
                return bone;
            }
        }

        if (Array.isArray(skeleton.bones)) {
            for (const bone of skeleton.bones) {
                if (bone && bone.name === boneName) {
                    return bone;
                }
            }
        }

        return null;
    }

    /**
     * Build the chain from effector to root.
     *
     * Every ancestor is a potential rotational joint.
     */
    _buildRotationChain(effector) {
        const chain = [];

        let current = effector;

        while (current) {
            if (current.isBone || current.type === 'Bone') {
                chain.push(current);
            }

            current = current.parent;
        }

        /**
         * The root itself can be included.
         * Whether the production policy allows root rotation
         * can be restricted later through joint metadata.
         */
        return chain;
    }

    /**
     * Return the three world-space rotation axes of a bone.
     *
     * They are obtained from the bone's current world quaternion.
     */
    _getWorldRotationAxes(bone) {
        const q = new THREE.Quaternion();

        bone.getWorldQuaternion(q);

        const x = new THREE.Vector3(1, 0, 0)
            .applyQuaternion(q)
            .normalize();

        const y = new THREE.Vector3(0, 1, 0)
            .applyQuaternion(q)
            .normalize();

        const z = new THREE.Vector3(0, 0, 1)
            .applyQuaternion(q)
            .normalize();

        return [x, y, z];
    }

    /**
     * Target position is currently expected in WORLD space.
     *
     * TaskConstraintBuilder currently creates WORLD positional
     * constraints, so this is the authoritative path.
     */
    _getTargetWorldPosition(constraint) {
        const target = constraint.target;

        if (!target) {
            return null;
        }

        if (target instanceof THREE.Vector3) {
            return target.clone();
        }

        if (Array.isArray(target) && target.length >= 3) {
            return new THREE.Vector3(
                Number(target[0]) || 0,
                Number(target[1]) || 0,
                Number(target[2]) || 0
            );
        }

        if (
            typeof target.x === 'number' &&
            typeof target.y === 'number' &&
            typeof target.z === 'number'
        ) {
            return new THREE.Vector3(
                target.x,
                target.y,
                target.z
            );
        }

        return null;
    }

    /**
     * Update matrices without changing the pose.
     */
    _updateWorldMatrices(skeleton) {
        if (skeleton.bones && skeleton.bones.length) {
            const root = skeleton.bones[0];

            if (root && root.parent) {
                root.parent.updateMatrixWorld(true);
            } else if (root) {
                root.updateMatrixWorld(true);
            }
        }
    }

    /**
     * Convert internal Map into public deltaPose array.
     *
     * The solver output is intentionally explicit and serializable.
     */
    _mapToPoseArray(deltaPose) {
        const result = [];

        for (const entry of deltaPose.values()) {
            const rotationWorld = entry.rotationWorld;

            if (
                !rotationWorld ||
                !Number.isFinite(rotationWorld.x) ||
                !Number.isFinite(rotationWorld.y) ||
                !Number.isFinite(rotationWorld.z)
            ) {
                continue;
            }

            const magnitude = rotationWorld.length();

            if (magnitude <= 1e-8) {
                continue;
            }

            result.push({
                bone: entry.bone,
                boneName: entry.bone.name,
                rotationWorld: rotationWorld.clone(),
                magnitude
            });
        }

        return result;
    }

    _calculateDeltaMagnitude(deltaPose, chain) {
        let total = 0;

        for (const bone of chain) {
            const entry = deltaPose.get(bone);

            if (!entry) {
                continue;
            }

            total += entry.rotationWorld.length();
        }

        return total;
    }

    /**
     * Stable 3×3 inverse.
     *
     * Returns null only if the matrix is genuinely non-invertible.
     * Damping should normally prevent that state.
     */
    _invert3x3(
        m00, m01, m02,
        m10, m11, m12,
        m20, m21, m22
    ) {
        const c00 = m11 * m22 - m12 * m21;
        const c01 = m02 * m21 - m01 * m22;
        const c02 = m01 * m12 - m02 * m11;

        const c10 = m12 * m20 - m10 * m22;
        const c11 = m00 * m22 - m02 * m20;
        const c12 = m02 * m10 - m00 * m12;

        const c20 = m10 * m21 - m11 * m20;
        const c21 = m01 * m20 - m00 * m21;
        const c22 = m00 * m11 - m01 * m10;

        const determinant =
            m00 * c00 +
            m01 * c10 +
            m02 * c20;

        if (!Number.isFinite(determinant)) {
            return null;
        }

        if (Math.abs(determinant) < 1e-12) {
            return null;
        }

        const invDet = 1 / determinant;

        return {
            m00: c00 * invDet,
            m01: c01 * invDet,
            m02: c02 * invDet,

            m10: c10 * invDet,
            m11: c11 * invDet,
            m12: c12 * invDet,

            m20: c20 * invDet,
            m21: c21 * invDet,
            m22: c22 * invDet
        };
    }

    _finish(result) {
        this.lastSolveTime = result.solveTime;
        this.lastResult = result;

        return result;
    }

    getLastResult() {
        return this.lastResult;
    }

    getStats() {
        return {
            solveCount: this.solveCount,
            lastSolveTime: this.lastSolveTime,
            enabled: this.enabled
        };
    }
}

export default ConstraintSolver;
