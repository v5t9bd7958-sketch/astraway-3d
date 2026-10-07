import {
  CANONICAL_JOINTS,
  LOGICAL_JOINTS,
  BONE_MAP,
} from "./character/BoneMap.js";

export function inspectBones(scene) {
  const bones = [];

  scene.traverse((object) => {
    if (object.isBone) {
      bones.push(object);
    }
  });

  const boneNames = new Set(bones.map((bone) => bone.name));

  const canonicalFound = CANONICAL_JOINTS.filter((name) =>
    boneNames.has(name)
  );

  const canonicalMissing = CANONICAL_JOINTS.filter(
    (name) => !boneNames.has(name)
  );

  const logicalFound = Object.entries(BONE_MAP).filter(
    ([, canonicalName]) => boneNames.has(canonicalName)
  );

  const extras = bones
    .map((bone) => bone.name)
    .filter((name) => !CANONICAL_JOINTS.includes(name));

  return {
    totalBones: bones.length,
    canonicalFound: canonicalFound.length,
    canonicalTotal: CANONICAL_JOINTS.length,
    canonicalMissing,
    logicalFound: logicalFound.length,
    logicalTotal: LOGICAL_JOINTS.length,
    extras,
    boneNames: bones.map((bone) => bone.name),
  };
}

export function renderBoneReport(report) {
  const info = document.querySelector("#info");

  if (!info) {
    return;
  }

  const canonicalStatus =
    report.canonicalFound === report.canonicalTotal
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
    <div><strong>AstraWay 3D — Character Lab</strong></div>

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
