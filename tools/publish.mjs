#!/usr/bin/env node
// Creates a GitHub release for every plugin version in index.json that does not have one yet,
// using the GitHub CLI (`gh`, signed in to the account that owns the repository).
//
//   node tools/publish.mjs            publish everything that is missing
//   node tools/publish.mjs <id>       only that plugin
//
// Why this exists next to the publish workflow: GitHub does not start tag-triggered workflows when
// more than three tags are pushed at once (for example the first release of all plugins), so those
// releases are created here instead. Pushing one plugin's tag still runs the workflow as usual.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GITHUB_REPO, PACKAGES_DIR, REPO_ROOT, loadIndex, packageFileName, tagFor } from "./lib/common.mjs";

const only = process.argv[2];
const gh = (args) => execFileSync("gh", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();

const existing = new Set(
  gh(["release", "list", "--repo", GITHUB_REPO, "--limit", "500", "--json", "tagName", "--jq", ".[].tagName"])
    .split(/\r?\n/)
    .filter(Boolean)
);

const index = loadIndex();
let created = 0;
for (const [id, entry] of Object.entries(index.plugins)) {
  if (only && only !== id) continue;
  const tag = tagFor(id, entry.version);
  if (existing.has(tag)) {
    console.log(`= ${tag} already released`);
    continue;
  }
  const file = join(PACKAGES_DIR, id, packageFileName(id, entry.version));
  if (!existsSync(file)) {
    console.error(`! ${tag}: package file missing (${file})`);
    process.exitCode = 1;
    continue;
  }
  const notes = `${entry.notes || "Update."}\n\nSHA-256: ${entry.sha256}`;
  gh([
    "release", "create", tag, file, `${file}.sha256`,
    "--repo", GITHUB_REPO, "--verify-tag",
    "--title", `${entry.name || id} ${entry.version}`,
    "--notes", notes
  ]);
  console.log(`+ ${tag} published`);
  created += 1;
}
console.log(created ? `Published ${created} release(s).` : "Nothing to publish.");
