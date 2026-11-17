// src/world/NightPlazaLocation.js
// AstraWay — Night Plaza: cinematic walkable location (mobile-friendly)
import * as THREE from "three";

/**
 * @param {THREE.Scene} scene
 * @param {{
 *   forward?: THREE.Vector3,
 *   origin?: THREE.Vector3,
 *   enableShadows?: boolean
 * }} [options]
 * @returns {{
 *   root: THREE.Group,
 *   groundMeshes: THREE.Mesh[],
 *   obstacleMeshes: THREE.Mesh[],
 *   lights: THREE.Light[]
 * }}
 */
export function buildNightPlaza(scene, options = {}) {
  const forward = (options.forward || new THREE.Vector3(0, 0, -1))
    .clone()
    .setY(0)
    .normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const origin = options.origin || new THREE.Vector3(0, 0, 0);
  const shadows = options.enableShadows !== false;

  const root = new THREE.Group();
  root.name = "AstraWay_NightPlaza";

  const groundMeshes = [];
  const obstacleMeshes = [];
  const lights = [];

  // ---------- materials ----------
  const matFloor = new THREE.MeshStandardMaterial({
    color: 0x1a1f2e,
    roughness: 0.72,
    metalness: 0.18,
  });
  const matFloorAccent = new THREE.MeshStandardMaterial({
    color: 0x243044,
    roughness: 0.55,
    metalness: 0.28,
  });
  const matStone = new THREE.MeshStandardMaterial({
    color: 0x2c3344,
    roughness: 0.82,
    metalness: 0.12,
  });
  const matStoneLight = new THREE.MeshStandardMaterial({
    color: 0x3a4558,
    roughness: 0.7,
    metalness: 0.15,
  });
  const matMetal = new THREE.MeshStandardMaterial({
    color: 0x8a93a8,
    roughness: 0.35,
    metalness: 0.75,
  });
  const matNeonCyan = new THREE.MeshStandardMaterial({
    color: 0x0a1a22,
    emissive: 0x2ee6ff,
    emissiveIntensity: 2.2,
    roughness: 0.4,
    metalness: 0.2,
  });
  const matNeonMagenta = new THREE.MeshStandardMaterial({
    color: 0x1a0a16,
    emissive: 0xff3d9a,
    emissiveIntensity: 1.8,
    roughness: 0.4,
    metalness: 0.2,
  });
  const matNeonAmber = new THREE.MeshStandardMaterial({
    color: 0x1a1208,
    emissive: 0xffb347,
    emissiveIntensity: 1.5,
    roughness: 0.45,
    metalness: 0.15,
  });
  const matGlass = new THREE.MeshStandardMaterial({
    color: 0x88aacc,
    roughness: 0.15,
    metalness: 0.4,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });

  function place(localX, localY, localZ) {
    return origin
      .clone()
      .add(right.clone().multiplyScalar(localX))
      .add(new THREE.Vector3(0, localY, 0))
      .add(forward.clone().multiplyScalar(localZ));
  }

  function addGround(mesh) {
    mesh.receiveShadow = shadows;
    mesh.castShadow = shadows;
    root.add(mesh);
    groundMeshes.push(mesh);
    return mesh;
  }

  function addObstacle(mesh) {
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.userData.astraWay = { role: "obstacle" };
    root.add(mesh);
    obstacleMeshes.push(mesh);
    return mesh;
  }

  function box(w, h, d, mat, x, y, z, name) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const p = place(x, y, z);
    m.position.copy(p);
    m.name = name || "PlazaBox";
    return m;
  }

  function cyl(rTop, rBot, h, seg, mat, x, y, z, name) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
    const p = place(x, y, z);
    m.position.copy(p);
    m.name = name || "PlazaCyl";
    return m;
  }

  // ---------- sky / fog mood ----------
  scene.background = new THREE.Color(0x070a12);
  scene.fog = new THREE.FogExp2(0x070a12, 0.028);

  // ---------- main plaza floor ----------
  {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      matFloor
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(place(0, 0.01, 2));
    floor.name = "PlazaFloor";
    addGround(floor);

    // inner ring (accent)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.2, 5.1, 64),
      matFloorAccent
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(place(0, 0.02, 2));
    ring.name = "PlazaRing";
    addGround(ring);

    // neon ring strip
    const neonRing = new THREE.Mesh(
      new THREE.TorusGeometry(4.65, 0.04, 10, 80),
      matNeonCyan
    );
    neonRing.rotation.x = Math.PI / 2;
    neonRing.position.copy(place(0, 0.05, 2));
    neonRing.name = "PlazaNeonRing";
    root.add(neonRing);
  }

  // outer walk slabs (not infinite plane — designed islands)
  const slabOffsets = [
    [0, 10],
    [-7, 6],
    [7, 6],
    [-5, -2],
    [5, -2],
    [0, -6],
  ];
  for (let i = 0; i < slabOffsets.length; i++) {
    const [lx, lz] = slabOffsets[i];
    const slab = box(5.5, 0.12, 4.2, matFloorAccent, lx, 0.06, lz + 2, `PlazaSlab_${i}`);
    addGround(slab);
  }

  // ---------- ceremonial stairs (curved approach feel via stepped platforms) ----------
  {
    const steps = 7;
    const tread = 0.42;
    const rise = 0.11;
    const width = 3.4;
    const baseZ = 8.5;

    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      const z = baseZ + i * tread;
      const step = box(width - i * 0.08, h, tread * 0.95, matStone, 0, h / 2, z, `PlazaStep_${i}`);
      addGround(step);

      // neon edge on each step
      const edge = box(width - i * 0.08, 0.03, 0.04, matNeonMagenta, 0, h + 0.01, z + tread * 0.4, `StepNeon_${i}`);
      root.add(edge);
    }

    const landingH = steps * rise;
    const landing = box(3.8, 0.16, 2.2, matStoneLight, 0, landingH - 0.02, baseZ + steps * tread + 0.9, "UpperLanding");
    addGround(landing);
  }

  // ---------- side ramp (smooth-ish wedge via thin steps) ----------
  {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const h = 0.08 + t * 0.55;
      const z = 7.5 + i * 0.28;
      const x = 4.2;
      const s = box(1.6, h, 0.3, matStone, x, h / 2, z, `SideRamp_${i}`);
      addGround(s);
    }
  }

  // ---------- columns with capitals + neon bands ----------
  function pillar(x, z, h, r) {
    const shaft = cyl(r, r * 1.05, h, 20, matStone, x, h / 2, z, "PillarShaft");
    addObstacle(shaft);

    const base = cyl(r * 1.35, r * 1.45, 0.18, 16, matStoneLight, x, 0.09, z, "PillarBase");
    addObstacle(base);

    const capital = cyl(r * 1.4, r * 0.95, 0.22, 16, matMetal, x, h - 0.05, z, "PillarCap");
    addObstacle(capital);

    const band = cyl(r * 1.08, r * 1.08, 0.06, 16, matNeonCyan, x, h * 0.55, z, "PillarNeon");
    root.add(band);

    // point light near capital
    const pl = new THREE.PointLight(0x2ee6ff, 1.4, 8, 2);
    pl.position.copy(place(x, h + 0.3, z));
    root.add(pl);
    lights.push(pl);
  }

  pillar(-3.2, 3.5, 2.6, 0.22);
  pillar(3.2, 3.5, 2.6, 0.22);
  pillar(-4.5, 9.0, 3.1, 0.26);
  pillar(4.5, 9.0, 3.1, 0.26);
  pillar(-2.0, 13.5, 2.4, 0.2);
  pillar(2.0, 13.5, 2.4, 0.2);

  // ---------- arch gateway ----------
  {
    const archZ = 12.2;
    const postL = box(0.35, 2.8, 0.35, matStone, -1.6, 1.4, archZ, "ArchPostL");
    const postR = box(0.35, 2.8, 0.35, matStone, 1.6, 1.4, archZ, "ArchPostR");
    addObstacle(postL);
    addObstacle(postR);

    const beam = box(3.6, 0.28, 0.4, matMetal, 0, 2.85, archZ, "ArchBeam");
    addObstacle(beam);

    const neonBeam = box(3.5, 0.06, 0.08, matNeonAmber, 0, 2.72, archZ + 0.2, "ArchNeon");
    root.add(neonBeam);

    // soft glass panel
    const glass = box(2.8, 2.2, 0.06, matGlass, 0, 1.3, archZ + 0.15, "ArchGlass");
    root.add(glass);
  }

  // ---------- elevated overlook platforms ----------
  {
    const deck = box(3.2, 0.18, 2.4, matFloorAccent, -7.5, 0.9, 8, "OverlookDeck");
    addGround(deck);

    // supports
    for (const sx of [-8.4, -6.6]) {
      const leg = box(0.22, 0.9, 0.22, matMetal, sx, 0.45, 8, "DeckLeg");
      addObstacle(leg);
    }

    // rail (visual + light obstacle)
    const rail = box(3.2, 0.08, 0.08, matNeonMagenta, -7.5, 1.35, 9.1, "DeckRail");
    addObstacle(rail);

    // stairs to deck
    for (let i = 0; i < 5; i++) {
      const h = 0.18 * (i + 1);
      const st = box(1.2, h, 0.32, matStone, -5.8, h / 2, 7.2 + i * 0.32, `DeckStair_${i}`);
      addGround(st);
    }
  }

  // ---------- floating neon monoliths (touchable obstacles) ----------
  const mono = [
    [6.5, 2.5, 1.8, 0.35],
    [-8.0, 5.5, 1.4, 0.28],
    [5.5, 11.0, 2.2, 0.32],
  ];
  for (let i = 0; i < mono.length; i++) {
    const [x, z, h, r] = mono[i];
    const m = cyl(r, r * 1.1, h, 12, i % 2 ? matNeonMagenta : matNeonCyan, x, h / 2, z, `Monolith_${i}`);
    addObstacle(m);
  }

  // ---------- low benches / ledges (walkable tops) ----------
  {
    const bench = box(2.4, 0.42, 0.55, matStoneLight, 6.2, 0.21, 4.0, "Bench");
    addGround(bench);
    const bench2 = box(2.4, 0.42, 0.55, matStoneLight, -6.2, 0.21, 4.0, "Bench2");
    addGround(bench2);
  }

  // ---------- ambient fill lights ----------
  {
    const hemi = new THREE.HemisphereLight(0x6a8cff, 0x0a0c12, 0.55);
    root.add(hemi);
    lights.push(hemi);

    const key = new THREE.DirectionalLight(0xc8d8ff, 1.15);
    key.position.copy(place(6, 12, -4));
    key.target.position.copy(place(0, 0, 4));
    root.add(key);
    root.add(key.target);
    lights.push(key);

    const rim = new THREE.DirectionalLight(0xff4da6, 0.35);
    rim.position.copy(place(-8, 6, 10));
    root.add(rim);
    lights.push(rim);

    const plazaGlow = new THREE.PointLight(0x2ee6ff, 1.6, 18, 2);
    plazaGlow.position.copy(place(0, 2.2, 2));
    root.add(plazaGlow);
    lights.push(plazaGlow);
  }

  scene.add(root);

  console.log("[AstraWay] Night Plaza built", {
    ground: groundMeshes.length,
    obstacles: obstacleMeshes.length,
    lights: lights.length,
  });

  return { root, groundMeshes, obstacleMeshes, lights };
}
