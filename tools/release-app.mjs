#!/usr/bin/env node
// Records a release of the app itself (the installer), with its own SHA-256.
//
//   node tools/release-app.mjs --installer <path\to\...-setup.exe> [--version x.y.z] [--notes "..."]
//        [--app <app project folder>]  (used to read the version from src-tauri/tauri.conf.json)
//        [--no-git]
//
// 1. copies the installer to dist-app/BookFormatterPro-<version>-setup.exe (not committed: too big
//    for git; it is uploaded to the GitHub release instead)
// 2. writes dist-app/BookFormatterPro-<version>-setup.exe.sha256
// 3. records the version, size, SHA-256, URL and notes as the "app" entry of index.json
// 4. commits index.json and tags app-v<version>
// Then:  git push origin main --follow-tags   and   node tools/publish.mjs   (uploads the installer).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  INDEX_PATH, REPO_ROOT, appAssetName, appAssetUrl, appTag, compareVersions, git, loadIndex, parseVersion, sha256Hex, writeJson
} from "./lib/common.mjs";

function parseArgs(argv) {
  const out = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (["installer", "version", "notes", "app"].includes(key)) out.values[key] = argv[(i += 1)];
    else out.flags.add(key);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const installer = args.values.installer && resolve(args.values.installer);
if (!installer || !existsSync(installer)) {
  console.error("Usage: node tools/release-app.mjs --installer <path to the built ...-setup.exe> [--version x.y.z] [--notes \"...\"] [--no-git]");
  process.exit(1);
}

let version = args.values.version;
if (!version) {
  const appDir = resolve(args.values.app || process.env.BFP_APP_DIR || "F:/TAURI APP - REDESIGNED");
  version = JSON.parse(readFileSync(join(appDir, "src-tauri", "tauri.conf.json"), "utf8")).version;
}
parseVersion(version);

const index = loadIndex();
index.schema = 1;
if (index.app && compareVersions(version, index.app.version) <= 0) {
  console.error(`App version ${version} is not newer than the released ${index.app.version}.`);
  process.exit(1);
}

const bytes = readFileSync(installer);
const sha256 = sha256Hex(bytes);
const assetName = appAssetName(version);
const outDir = join(REPO_ROOT, "dist-app");
mkdirSync(outDir, { recursive: true });
copyFileSync(installer, join(outDir, assetName));
writeFileSync(join(outDir, `${assetName}.sha256`), `${sha256}\n`);

const today = new Date().toISOString().slice(0, 10);
const notes = args.values.notes || (index.app ? "Update." : "First release.");
index.app = {
  name: "BookFormatter Pro",
  version,
  size: statSync(installer).size,
  sha256,
  url: appAssetUrl(version),
  releasedAt: today,
  notes,
  history: [{ version, sha256, url: appAssetUrl(version), releasedAt: today, notes }, ...((index.app && index.app.history) || [])]
};
index.generatedAt = new Date().toISOString();
writeJson(INDEX_PATH, index);

console.log(`+ app ${version}  ${(index.app.size / 1048576).toFixed(1)} MB  sha256 ${sha256}\n  from ${basename(installer)}`);
if (args.flags.has("no-git")) process.exit(0);

git(["add", "index.json"]);
git(["commit", "-m", `App ${version}: ${notes}`]);
git(["tag", "-a", appTag(version), "-m", `BookFormatter Pro ${version}\n\n${notes}`]);
console.log(`\nCommitted and tagged ${appTag(version)}. Publish with:\n  git push origin main --follow-tags\n  node tools/publish.mjs`);
