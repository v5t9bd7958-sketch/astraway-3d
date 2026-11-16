
// src/world/WorldAdapter.js

import * as THREE from "three";

const VALID_ROLES = new Set([
  "ground",
  "obstacle",
  "touchable",
]);

function isMesh(object) {
  return !!object?.isMesh && !!object.geometry;
}

function getRole(object) {
  const role = object?.userData?.astraWay?.role;
  return VALID_ROLES.has(role) ? role : null;
}

function isDescendantOfAny(object, roots) {
  for (const root of roots) {
    let current = object;

    while (current) {
      if (current === root) return true;
      current = current.parent;
    }
  }

  return false;
}

export class WorldAdapter {
  constructor({
    scene,
    characterRoots = [],
    ground = [],
    obstacles = [],
    touchables = [],
    includeTaggedObjects = true,
    minimumColliderRadius = 0.025,
    minimumColliderHeight = 0.05,
  } = {}) {
    if (!scene?.isObject3D) {
      throw new Error("WorldAdapter: THREE.Scene required");
    }

    if (!Array.isArray(characterRoots)) {
      throw new TypeError("characterRoots must be an array");
    }

    if (
      !Array.isArray(ground) ||
      !Array.isArray(obstacles) ||
      !Array.isArray(touchables)
    ) {
      throw new TypeError("World object collections must be arrays");
    }

    if (
      !Number.isFinite(minimumColliderRadius) ||
      minimumColliderRadius <= 0 ||
      !Number.isFinite(minimumColliderHeight) ||
      minimumColliderHeight <= 0
    ) {
      throw new RangeError("Invalid minimum collider dimensions");
    }

    this.scene = scene;
    this.characterRoots = [...characterRoots];
    this.includeTaggedObjects = !!includeTaggedObjects;

    this.minimumColliderRadius = minimumColliderRadius;
    this.minimumColliderHeight = minimumColliderHeight;

    this.explicit = {
      ground: new Set(ground),
      obstacles: new Set(obstacles),
      touchables: new Set(touchables),
    };

    this.box = new THREE.Box3();
    this.size = new THREE.Vector3();
    this.center = new THREE.Vector3();

    this.revision = 0;
    this.snapshot = null;

    this.refresh();

    if (!this.snapshot.ground.length) {
      throw new Error(
        'No walkable meshes. Tag a mesh with userData.astraWay.role = "ground" or pass it in ground[].'
      );
    }
  }

  addGround(object) {
    this._assertMesh(object, "ground");
    this.explicit.ground.add(object);
    this.snapshot = null;
    return this;
  }

  addObstacle(object) {
    this._assertMesh(object, "obstacle");
    this.explicit.obstacles.add(object);
    this.snapshot = null;
    return this;
  }

  addTouchable(object) {
    this._assertMesh(object, "touchable");
    this.explicit.touchables.add(object);
    this.snapshot = null;
    return this;
  }

  remove(object) {
    this.explicit.ground.delete(object);
    this.explicit.obstacles.delete(object);
    this.explicit.touchables.delete(object);
    this.snapshot = null;
    return this;
  }

  setCharacterRoots(roots = []) {
    if (!Array.isArray(roots)) {
      throw new TypeError("roots must be an array");
    }

    this.characterRoots = [...roots];
    this.snapshot = null;
    return this;
  }

  _assertMesh(object, label) {
    if (!object?.isObject3D || !isMesh(object)) {
      throw new TypeError(
        `WorldAdapter: ${label} must be a THREE.Mesh`
      );
    }
  }

  _isCharacterObject(object) {
    return isDescendantOfAny(
      object,
      this.characterRoots
    );
  }

  _collectTagged() {
    const tagged = {
      ground: new Set(),
      obstacles: new Set(),
      touchables: new Set(),
    };

    if (!this.includeTaggedObjects) return tagged;

    this.scene.traverse((object) => {
      if (!isMesh(object) || this._isCharacterObject(object)) {
        return;
      }

      const role = getRole(object);

      if (role === "ground") tagged.ground.add(object);
      if (role === "obstacle") tagged.obstacles.add(object);
      if (role === "touchable") tagged.touchables.add(object);
    });

    return tagged;
  }

  _collectMeshes(explicitSet, taggedSet) {
    const result = new Set();

    for (const object of explicitSet) {
      if (
        isMesh(object) &&
        object.visible !== false &&
        !this._isCharacterObject(object)
      ) {
        result.add(object);
      }
    }

    for (const object of taggedSet) {
      if (
        isMesh(object) &&
        object.visible !== false &&
        !this._isCharacterObject(object)
      ) {
        result.add(object);
      }
    }

    return [...result];
  }

  _buildCollider(mesh) {
    mesh.updateWorldMatrix(true, false);
    this.box.setFromObject(mesh, true);

    if (this.box.isEmpty()) return null;

    this.box.getSize(this.size);
    this.box.getCenter(this.center);

    const radius = Math.max(
      this.size.x * 0.5,
      this.size.z * 0.5
    );

    const height = this.size.y;

    if (
      !Number.isFinite(radius) ||
      !Number.isFinite(height) ||
      radius < this.minimumColliderRadius ||
      height < this.minimumColliderHeight
    ) {
      return null;
    }

    // Donor collider convention: bottom-center.
    return {
      center: new THREE.Vector3(
        this.center.x,
        this.box.min.y,
        this.center.z
      ),
      radius,
      height,
    };
  }

  refresh() {
    const tagged = this._collectTagged();

    const ground = this._collectMeshes(
      this.explicit.ground,
      tagged.ground
    );

    const obstacleMeshes = this._collectMeshes(
      this.explicit.obstacles,
      tagged.obstacles
    );

    const touchables = this._collectMeshes(
      this.explicit.touchables,
      tagged.touchables
    );

    const colliders = [];

    for (const mesh of obstacleMeshes) {
      const collider = this._buildCollider(mesh);

      if (collider) colliders.push(collider);
    }

    this.revision += 1;

    this.snapshot = {
      revision: this.revision,
      ground,
      obstacleMeshes,
      touchables,
      colliders,
    };

    return this.snapshot;
  }

  getSnapshot() {
    return this.snapshot || this.refresh();
  }

  getGround() {
    return [...this.getSnapshot().ground];
  }

  getObstacleMeshes() {
    return [...this.getSnapshot().obstacleMeshes];
  }

  getTouchables() {
    return [...this.getSnapshot().touchables];
  }

  getColliders() {
    return this.getSnapshot().colliders.map((item) => ({
      center: item.center.clone(),
      radius: item.radius,
      height: item.height,
    }));
  }

  getDiagnostics() {
    const data = this.getSnapshot();

    return {
      revision: data.revision,
      groundCount: data.ground.length,
      obstacleMeshCount: data.obstacleMeshes.length,
      colliderCount: data.colliders.length,
      touchableCount: data.touchables.length,
      characterRootCount: this.characterRoots.length,
      ready: data.ground.length > 0,
    };
  }

  toProceduralHumanOptions() {
    const data = this.getSnapshot();

    if (!data.ground.length) {
      throw new Error(
        "WorldAdapter: no ground meshes available"
      );
    }

    return {
      ground: [...data.ground],
      colliders: data.colliders.map((item) => ({
        center: item.center.clone(),
        radius: item.radius,
        height: item.height,
      })),
      touchables: [...data.touchables],
    };
  }
}

export default WorldAdapter;
