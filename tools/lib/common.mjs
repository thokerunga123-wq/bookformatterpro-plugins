// Shared helpers for the plugin release tools (Node 18+, no dependencies).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REGISTRY_PATH = join(REPO_ROOT, "plugins.json");
export const INDEX_PATH = join(REPO_ROOT, "index.json");
export const PACKAGES_DIR = join(REPO_ROOT, "packages");

// The GitHub repository that hosts the releases. index.json points at its release assets.
export const GITHUB_REPO = "thokerunga123-wq/bookformatterpro-plugins";

// Package format version understood by the app. Bump only with a matching app change.
export const PACKAGE_FORMAT = 1;

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing file: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(version) {
  const m = SEMVER.exec(String(version));
  if (!m) throw new Error(`"${version}" is not a plain x.y.z version`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export function bumpVersion(version, kind) {
  const [major, minor, patch] = parseVersion(version);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump "${kind}" (use patch, minor or major)`);
}

export const tagFor = (id, version) => `${id}-v${version}`;
export const packageFileName = (id, version) => `${id}-${version}.bfpk`;
export const assetUrl = (id, version) =>
  `https://github.com/${GITHUB_REPO}/releases/download/${tagFor(id, version)}/${packageFileName(id, version)}`;

export function git(args, options = {}) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", ...options }).trim();
}

export function loadRegistry() {
  const registry = readJson(REGISTRY_PATH);
  for (const plugin of registry.plugins) {
    if (!/^[a-z0-9-]+$/.test(plugin.id)) throw new Error(`Bad plugin id: ${plugin.id}`);
    parseVersion(plugin.version);
  }
  return registry;
}

export function loadIndex() {
  return readJson(INDEX_PATH, { schema: 1, plugins: {} });
}
