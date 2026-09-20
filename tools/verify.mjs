#!/usr/bin/env node
// Checks that everything index.json promises is true:
//   - every plugin in index.json has a package file whose SHA-256 matches the published one
//   - the .sha256 file next to it agrees
//   - the package opens, its manifest matches the index, and every file inside matches its own SHA-256
//   - the entry page is inside the package
//   - the version in index.json equals the one in plugins.json
// Exits non-zero on any problem, so it can run in CI and before every push.
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { APP_DIST_DIR, PACKAGES_DIR, PACKAGE_FORMAT, appAssetName, appAssetUrl, loadIndex, loadRegistry, packageFileName, parseVersion, sha256Hex, assetUrl } from "./lib/common.mjs";

const registry = loadRegistry();
const index = loadIndex();
const problems = [];
const fail = (id, message) => problems.push(`${id}: ${message}`);

for (const plugin of registry.plugins) {
  if (!index.plugins[plugin.id]) fail(plugin.id, "listed in plugins.json but has no release in index.json");
}

for (const [id, entry] of Object.entries(index.plugins)) {
  const plugin = registry.plugins.find((p) => p.id === id);
  if (!plugin) { fail(id, "in index.json but not in plugins.json"); continue; }
  if (plugin.version !== entry.version) fail(id, `plugins.json says ${plugin.version} but index.json says ${entry.version}`);
  if (entry.url !== assetUrl(id, entry.version)) fail(id, `url does not point at this release: ${entry.url}`);

  const fileName = packageFileName(id, entry.version);
  const path = join(PACKAGES_DIR, id, fileName);
  if (!existsSync(path)) { fail(id, `missing ${path}`); continue; }
  const bytes = readFileSync(path);
  const actual = sha256Hex(bytes);
  if (actual !== entry.sha256) fail(id, `SHA-256 mismatch (index ${entry.sha256.slice(0, 12)}..., file ${actual.slice(0, 12)}...)`);
  if (bytes.length !== entry.size) fail(id, `size mismatch (index ${entry.size}, file ${bytes.length})`);
  const sidecar = join(PACKAGES_DIR, id, `${fileName}.sha256`);
  if (!existsSync(sidecar) || !readFileSync(sidecar, "utf8").startsWith(entry.sha256)) fail(id, "the .sha256 file is missing or different");

  let doc;
  try {
    doc = JSON.parse(gunzipSync(bytes).toString("utf8"));
  } catch (error) {
    fail(id, `package does not open: ${error.message}`);
    continue;
  }
  if (doc.format !== PACKAGE_FORMAT) fail(id, `package format ${doc.format}, expected ${PACKAGE_FORMAT}`);
  if (doc.id !== id || doc.version !== entry.version) fail(id, "manifest id/version differ from index.json");
  if (doc.entry !== entry.entry) fail(id, "manifest entry differs from index.json");
  if (!doc.files.some((f) => f.path === doc.entry)) fail(id, `entry page ${doc.entry} is not inside the package`);
  for (const file of doc.files) {
    if (file.path.includes("..") || file.path.startsWith("/") || file.path.includes("\\")) fail(id, `unsafe path ${file.path}`);
    const data = Buffer.from(file.data, "base64");
    if (sha256Hex(data) !== file.sha256 || data.length !== file.size) fail(id, `file ${file.path} does not match its own SHA-256`);
  }
}

// --online: download every published plugin package and check it, exactly as the app does.
if (process.argv.includes("--online")) {
  let checked = 0;
  for (const [id, entry] of Object.entries(index.plugins)) {
    try {
      const response = await fetch(entry.url);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) fail(id, `download answered ${response.status}`);
      else if (sha256Hex(bytes) !== entry.sha256 || bytes.length !== entry.size) fail(id, "the published package does not match index.json");
      else checked += 1;
    } catch (error) {
      fail(id, `download failed: ${error.message}`);
    }
  }
  console.log(`Online: ${checked} of ${Object.keys(index.plugins).length} published plugin packages match their SHA-256.`);
}

// The app itself.
const app = index.app;
if (app) {
  try { parseVersion(app.version); } catch (error) { fail("app", error.message); }
  if (!/^[0-9a-f]{64}$/.test(app.sha256 || "")) fail("app", "sha256 is not a 64-character hex value");
  if (!(app.size > 0)) fail("app", "size is missing");
  if (app.url !== appAssetUrl(app.version)) fail("app", `url does not point at this release: ${app.url}`);
  const local = join(APP_DIST_DIR, appAssetName(app.version));
  if (existsSync(local)) {
    const bytes = readFileSync(local);
    if (sha256Hex(bytes) !== app.sha256 || bytes.length !== app.size) fail("app", "the installer in dist-app/ does not match index.json");
  }
  // --online: download the published installer and check it, exactly as the app does.
  if (process.argv.includes("--online")) {
    try {
      const response = await fetch(app.url);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) fail("app", `download answered ${response.status}`);
      else if (sha256Hex(bytes) !== app.sha256 || bytes.length !== app.size) fail("app", "the published installer does not match index.json");
      else console.log(`OK: the published app installer (${(bytes.length / 1048576).toFixed(1)} MB) matches its SHA-256.`);
    } catch (error) {
      fail("app", `download failed: ${error.message}`);
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} problem(s):\n - ${problems.join("\n - ")}`);
  process.exit(1);
}
console.log(`OK: ${Object.keys(index.plugins).length} plugin package(s)${app ? ` and the app ${app.version}` : ""} verified.`);
