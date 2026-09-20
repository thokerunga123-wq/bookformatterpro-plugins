#!/usr/bin/env node
// Does on this PC everything the GitHub workflows used to do, in order:
//   1. verify every package and checksum in the repo          (was: verify.yml)
//   2. push the commits and tags to GitHub
//   3. create the GitHub releases that are missing            (was: publish.yml)
//   4. download what was published and check it against index.json's SHA-256
//
//   node tools/ship.mjs            everything
//   node tools/ship.mjs --no-push  verify only, then publish what is already pushed
//
// Needs `git` and `gh` (GitHub CLI, signed in). No GitHub Actions minutes are used.
import { execFileSync, spawnSync } from "node:child_process";
import { REPO_ROOT } from "./lib/common.mjs";

const noPush = process.argv.includes("--no-push");

function run(label, command, args) {
  console.log(`\n== ${label}`);
  const result = spawnSync(command, args, { cwd: REPO_ROOT, stdio: "inherit", shell: false });
  if (result.status !== 0) {
    console.error(`\nStopped: "${label}" failed.`);
    process.exit(result.status || 1);
  }
}

const node = process.execPath;
run("1/4 Verify packages and checksums", node, ["tools/verify.mjs"]);
if (execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()) {
  console.error("\nThere are uncommitted changes. Commit them (tools/release.mjs and tools/release-app.mjs do this for you) and run again.");
  process.exit(1);
}
if (!noPush) run("2/4 Push commits and tags", "git", ["push", "origin", "main", "--follow-tags"]);
run("3/4 Create the GitHub releases", node, ["tools/publish.mjs"]);
run("4/4 Download the published files and check their checksums", node, ["tools/verify.mjs", "--online"]);
console.log("\nDone. Installed apps will find the new versions the next time they check.");
