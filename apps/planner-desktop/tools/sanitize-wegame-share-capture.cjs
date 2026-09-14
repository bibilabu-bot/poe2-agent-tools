"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { assertSanitized } = require("./wegame-share-schema.cjs");

const inputDirectory = process.argv[2];
const outputFile = process.argv[3];
if (!inputDirectory || !outputFile) {
  throw new Error("usage: node sanitize-wegame-share-capture.cjs <capture-directory> <output-file>");
}

const captures = {
  roleInfo: "p2at021a-roleinfo.json",
  roleProfile: "p2at021a-GetRoleProfile.json",
  equipments: "p2at021a-GetEquipments.json",
  panelAttributes: "p2at021a-GetPanelAttr.json",
  skills: "p2at021a-GetSkills.json",
  skillsDps: "p2at021a-GetSkillsDps.json",
  talentTree: "p2at021a-GetTalentTree.json",
  jewels: "p2at021a-GetJewels.json"
};

const document = {};
for (const [name, file] of Object.entries(captures)) {
  document[name] = JSON.parse(fs.readFileSync(path.join(inputDirectory, file), "utf8"));
}

const role = document.roleInfo.role || {};
for (const key of ["openid", "role_id", "name", "account_name", "created_time", "last_login_time", "season_game_duration", "total_game_duration"]) {
  delete role[key];
}
delete document.roleInfo.nick_name;
delete document.roleInfo.share_code;

const opaqueIds = new Map();
let nextOpaqueId = 1;
function pseudonym(value) {
  if (!opaqueIds.has(value)) opaqueIds.set(value, `opaque-item-${String(nextOpaqueId++).padStart(3, "0")}`);
  return opaqueIds.get(value);
}
function replaceOpaqueItemIds(value) {
  if (Array.isArray(value)) return value.map(item => replaceOpaqueItemIds(item));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && /^[a-f0-9]{64}$/i.test(child)) {
      result[key] = pseudonym(child);
    } else {
      result[key] = replaceOpaqueItemIds(child);
    }
  }
  return result;
}

for (const key of Object.keys(document)) document[key] = replaceOpaqueItemIds(document[key]);
assertSanitized(document);

const canonical = JSON.stringify(document, null, 2) + "\n";
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, canonical, "utf8");
console.log(JSON.stringify({
  outputFile,
  bytes: Buffer.byteLength(canonical),
  sha256: crypto.createHash("sha256").update(canonical).digest("hex"),
  pseudonymizedOpaqueItemIds: opaqueIds.size
}, null, 2));
