import {
  CANONICAL_JOINTS,
  LOGICAL_JOINTS,
  BONE_MAP,
} from "./character/BoneMap.js";

function collectBones(scene) {
  const bones = [];

  scene.traverse((object) => {
    if (object.isBone) {
      bones.push(object);
    }
  });

  return bones;
}

function getTerminalBones(bones) {
  return bones.filter((bone) => {
    const name = bone.name || "";

    return (
      /_End$/i.test(name) ||
      /4$/i.test(name) ||
      /Top_End$/i.test(name)
    );
  });
}

function getDuplicateNames(bones) {
  const counts = new Map();

  for (const bone of bones) {
    counts.set(
      bone.name,
      (counts.get(bone.name) || 0) + 1
    );
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({
      name,
      count,
    }));
}

function getHierarchy(bones) {
  return bones.map((bone) => ({
    index: bones.indexOf(bone),
    name: bone.name,
    parent: bone.parent?.isBone
      ? bone.parent.name
      : null,
    children: bone.children
      .filter((child) => child.isBone)
      .map((child) => child.name),
  }));
}

function buildInventory(scene) {
  const bones = collectBones(scene);

  const boneNames = new Set(
    bones.map((bone) => bone.name)
  );

  const canonicalFound =
    CANONICAL_JOINTS.filter((name) =>
      boneNames.has(name)
    );

  const canonicalMissing =
    CANONICAL_JOINTS.filter(
      (name) => !boneNames.has(name)
    );

  const logicalFound =
    Object.entries(BONE_MAP).filter(
      ([, canonicalName]) =>
        boneNames.has(canonicalName)
    );

  const logicalMissing =
    Object.entries(BONE_MAP)
      .filter(
        ([, canonicalName]) =>
          !boneNames.has(canonicalName)
      )
      .map(
        ([logicalName, canonicalName]) =>
          `${logicalName} → ${canonicalName}`
      );

  const extras =
    bones
      .map((bone) => bone.name)
      .filter(
        (name) =>
          !CANONICAL_JOINTS.includes(name)
      );

  const terminals =
    getTerminalBones(bones);

  const duplicates =
    getDuplicateNames(bones);

  const hierarchy =
    getHierarchy(bones);

  const roots =
    bones.filter(
      (bone) =>
        !bone.parent ||
        !bone.parent.isBone
    );

  return {
    totalBones: bones.length,

    canonicalFound:
      canonicalFound.length,

    canonicalTotal:
      CANONICAL_JOINTS.length,

    canonicalMissing,

    logicalFound:
      logicalFound.length,

    logicalTotal:
      LOGICAL_JOINTS.length,

    logicalMissing,

    extras,

    terminals:
      terminals.map((bone) => bone.name),

    duplicates,

    roots:
      roots.map((bone) => bone.name),

    boneNames:
      bones.map((bone) => bone.name),

    hierarchy,
  };
}

function printInventoryToConsole(report) {
  console.group(
    "[AstraWay] XBot RUNTIME INVENTORY"
  );

  console.log(
    "Physical THREE.Bone count:",
    report.totalBones
  );

  console.log(
    "Canonical coverage:",
    `${report.canonicalFound}/${report.canonicalTotal}`
  );

  console.log(
    "Logical coverage:",
    `${report.logicalFound}/${report.logicalTotal}`
  );

  console.log(
    "Canonical missing:",
    report.canonicalMissing
  );

  console.log(
    "Logical missing:",
    report.logicalMissing
  );

  console.log(
    "Terminal / tip bones:",
    report.terminals
  );

  console.log(
    "Extra bones:",
    report.extras
  );

  console.log(
    "Duplicate names:",
    report.duplicates
  );

  console.log(
    "Root bones:",
    report.roots
  );

  console.table(
    report.hierarchy
  );

  console.log(
    "ALL BONE NAMES:",
    report.boneNames
  );

  console.groupEnd();
}

function renderInventoryToStatus(report) {
  const status =
    document.querySelector("#status");

  if (!status) {
    return;
  }

  const canonicalPass =
    report.canonicalFound ===
    report.canonicalTotal;

  const logicalPass =
    report.logicalFound ===
    report.logicalTotal;

  const duplicatesPass =
    report.duplicates.length === 0;

  const overallPass =
    canonicalPass &&
    logicalPass &&
    duplicatesPass;

  const terminalText =
    report.terminals.length > 0
      ? report.terminals.join(", ")
      : "none";

  const missingCanonicalText =
    report.canonicalMissing.length > 0
      ? report.canonicalMissing.join(", ")
      : "none";

  const missingLogicalText =
    report.logicalMissing.length > 0
      ? report.logicalMissing.join(", ")
      : "none";

  const duplicateText =
    report.duplicates.length > 0
      ? report.duplicates
          .map(
            (item) =>
              `${item.name} ×${item.count}`
          )
          .join(", ")
      : "none";

  status.textContent =
    [
      `XBOT RUNTIME INVENTORY — ${
        overallPass ? "GREEN" : "RED"
      }`,

      `THREE.Bone: ${report.totalBones}`,

      `Canonical: ${
        report.canonicalFound
      }/${report.canonicalTotal}`,

      `Logical: ${
        report.logicalFound
      }/${report.logicalTotal}`,

      `Terminal/tip: ${terminalText}`,

      `Duplicates: ${duplicateText}`,

      `Missing canonical: ${
        missingCanonicalText
      }`,

      `Missing logical: ${
        missingLogicalText
      }`,

      `Roots: ${
        report.roots.join(", ") || "none"
      }`,

      `Full hierarchy: console`,
    ].join("\n");
}

function runRuntimeInventory(scene) {
  const report =
    buildInventory(scene);

  printInventoryToConsole(report);
  renderInventoryToStatus(report);

  /*
   * Diagnostic mode:
   *
   * ?inventory=1
   *
   * We deliberately stop the normal Character Lab
   * pipeline after obtaining the inventory.
   *
   * This prevents Gate 7 from mutating the skeleton
   * while we inspect it.
   */

  const params =
    new URLSearchParams(
      window.location.search
    );

  if (
    params.get("inventory") === "1"
  ) {
    const compactReport =
      [
        `BONES=${report.totalBones}`,
        `CANONICAL=${report.canonicalFound}/${report.canonicalTotal}`,
        `LOGICAL=${report.logicalFound}/${report.logicalTotal}`,
        `TERMINALS=${report.terminals.length}`,
        `DUPLICATES=${report.duplicates.length}`,
      ].join(" | ");

    throw new Error(
      `RUNTIME INVENTORY COMPLETE — ${compactReport}`
    );
  }

  return report;
}

export function inspectBones(scene) {
  return runRuntimeInventory(scene);
}

export function renderBoneReport(report) {
  const info =
    document.querySelector("#info");

  if (!info) {
    return;
  }

  const canonicalStatus =
    report.canonicalFound ===
    report.canonicalTotal
      ? "GREEN"
      : "RED";

  const missingHtml =
    report.canonicalMissing.length > 0
      ? `
        <div style="margin-top:8px;color:#ff7070">
          Missing: ${report.canonicalMissing.join(", ")}
        </div>
      `
      : "";

  info.innerHTML = `
    <div>
      <strong>AstraWay 3D — Character Lab</strong>
    </div>

    <div style="margin-top:6px">
      <strong>${canonicalStatus}</strong>
      — Canonical joints:
      ${report.canonicalFound}/${report.canonicalTotal}
    </div>

    <div>
      Logical API:
      ${report.logicalFound}/${report.logicalTotal}
    </div>

    <div>
      Total bones:
      ${report.totalBones}
    </div>

    <div>
      Extra bones:
      ${report.extras.length}
    </div>

    ${missingHtml}
  `;
}
