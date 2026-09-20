#!/usr/bin/env node
// Prints every plugin with its released version and checksum.
import { loadIndex, loadRegistry } from "./lib/common.mjs";
const index = loadIndex();
for (const plugin of loadRegistry().plugins) {
  const entry = index.plugins[plugin.id];
  console.log(`${plugin.id.padEnd(28)} ${(entry ? entry.version : "(unreleased)").padEnd(12)} ${entry ? entry.sha256.slice(0, 16) : ""}`);
}
