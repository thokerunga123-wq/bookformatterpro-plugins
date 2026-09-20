#!/usr/bin/env node
// Builds and records a release of one plugin (or all of them).
//
//   node tools/release.mjs <plugin-id|all> [--app <path to the app project>]
//        [--bump patch|minor|major | --version x.y.z] [--notes "what changed"]
//        [--initial]   first release: every plugin is published at its current version, unchanged
//        [--changed]   with "all": only plugins whose built files differ from their last release
//        [--no-git]    do not commit or tag
//
// What it does, for each plugin:
//   1. packs the plugin from <app>/dist into packages/<id>/<id>-<version>.bfpk
//   2. writes packages/<id>/<id>-<version>.bfpk.sha256
//   3. records version, size, SHA-256, download URL and notes in index.json
//   4. updates plugins.json (version + changelog)
//   5. commits and creates the tag <id>-v<version>
// It never pushes. Pushing the tag (git push --follow-tags) is what publishes the GitHub release.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PACKAGES_DIR, REGISTRY_PATH, INDEX_PATH, GITHUB_REPO,
  assetUrl, bumpVersion, compareVersions, git, loadIndex, loadRegistry, packageFileName, tagFor, writeJson
} from "./lib/common.mjs";
import { buildPackage } from "./lib/package-plugin.mjs";

function parseArgs(argv) {
  const args = { _: [], flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["app", "bump", "version", "notes"].includes(key)) args.values[key] = argv[(i += 1)];
      else args.flags.add(key);
    } else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = args._[0];
if (!target) {
  console.error("Usage: node tools/release.mjs <plugin-id|all> [--app <path>] [--bump patch|minor|major | --version x.y.z] [--notes \"...\"] [--initial] [--changed] [--no-git]");
  process.exit(1);
}
const appRoot = resolve(args.values.app || process.env.BFP_APP_DIR || "F:/TAURI APP - REDESIGNED");
const distRoot = join(appRoot, "dist");
if (!existsSync(distRoot)) {
  console.error(`No built frontend at ${distRoot}. Run "npm run build" in the app project first.`);
  process.exit(1);
}

const registry = loadRegistry();
const index = loadIndex();
index.schema = 1;
index.repo = GITHUB_REPO;
index.plugins ||= {};

const selected = target === "all" ? registry.plugins : registry.plugins.filter((p) => p.id === target);
if (!selected.length) {
  console.error(`Unknown plugin "${target}". Known: ${registry.plugins.map((p) => p.id).join(", ")}`);
  process.exit(1);
}

const released = [];
for (const plugin of selected) {
  const previous = index.plugins[plugin.id];
  let version;
  if (args.flags.has("initial")) {
    if (previous) { console.log(`- ${plugin.id}: already released as ${previous.version}, skipped (--initial)`); continue; }
    version = plugin.version;
  } else if (args.values.version) {
    version = args.values.version;
  } else if (args.values.bump) {
    version = bumpVersion(previous ? previous.version : plugin.version, args.values.bump);
  } else {
    console.error(`${plugin.id}: say how to version this release (--bump patch|minor|major, --version x.y.z or --initial)`);
    process.exit(1);
  }
  if (previous && compareVersions(version, previous.version) <= 0) {
    console.error(`${plugin.id}: ${version} is not newer than the released ${previous.version}`);
    process.exit(1);
  }

  const built = buildPackage({ distRoot, plugin, version, minAppVersion: plugin.minAppVersion });
  if (args.flags.has("changed") && previous && previous.contentHash === built.contentHash) {
    console.log(`- ${plugin.id}: unchanged since ${previous.version}, skipped`);
    continue;
  }

  const dir = join(PACKAGES_DIR, plugin.id);
  mkdirSync(dir, { recursive: true });
  const fileName = packageFileName(plugin.id, version);
  writeFileSync(join(dir, fileName), built.bytes);
  writeFileSync(join(dir, `${fileName}.sha256`), `${built.sha256}  ${fileName}\n`);

  const notes = args.values.notes || (args.flags.has("initial") ? "First release." : "Update.");
  const today = new Date().toISOString().slice(0, 10);
  const history = [
    { version, sha256: built.sha256, url: assetUrl(plugin.id, version), releasedAt: today, notes },
    ...((previous && previous.history) || [])
  ];
  index.plugins[plugin.id] = {
    name: plugin.name,
    description: plugin.description,
    version,
    minAppVersion: plugin.minAppVersion,
    entry: plugin.entry,
    size: built.size,
    sha256: built.sha256,
    url: assetUrl(plugin.id, version),
    contentHash: built.contentHash,
    releasedAt: today,
    notes,
    history
  };
  plugin.version = version;
  plugin.changelog = [{ version, date: today, notes }, ...(plugin.changelog || [])];
  released.push({ plugin, version, size: built.size, files: built.fileCount, sha256: built.sha256, notes });
  console.log(`+ ${plugin.id} ${version}  ${(built.size / 1024).toFixed(0)} KB  ${built.fileCount} files  sha256 ${built.sha256.slice(0, 16)}...`);
}

if (!released.length) {
  console.log("Nothing to release.");
  process.exit(0);
}

index.generatedAt = new Date().toISOString();
writeJson(INDEX_PATH, index);
writeJson(REGISTRY_PATH, registry);

if (args.flags.has("no-git")) {
  console.log("Done (git skipped).");
  process.exit(0);
}

git(["add", "-A"]);
const message = released.length === 1
  ? `${released[0].plugin.id} ${released[0].version}: ${released[0].notes}`
  : `Release ${released.length} plugins: ${released.map((r) => `${r.plugin.id} ${r.version}`).join(", ")}`;
git(["commit", "-m", message]);
for (const r of released) git(["tag", "-a", tagFor(r.plugin.id, r.version), "-m", `${r.plugin.name} ${r.version}\n\n${r.notes}`]);
console.log(`\nCommitted and tagged ${released.length} release(s). Publish with:\n  git push origin main --follow-tags`);
