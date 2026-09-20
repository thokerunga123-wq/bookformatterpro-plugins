// Builds one plugin's .bfpk package from the app's built frontend (its `dist` folder).
//
// A .bfpk is a gzip-compressed JSON document:
//   { format, id, version, minAppVersion, entry, builtAt, contentHash,
//     files: [{ path, size, sha256, data }] }      // data = base64, path relative to dist/
// The whole file is checked against the SHA-256 published in index.json before the app opens it,
// and every file inside is checked against its own SHA-256 again while unpacking.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, posix, relative, resolve, sep } from "node:path";
import { PACKAGE_FORMAT, sha256Hex } from "./common.mjs";

const TEXT_EXT = new Set([".html", ".js", ".mjs", ".css"]);
const REF = /["'(=\s]((?:\.{1,2}\/|\/)[A-Za-z0-9_\-./~%@]+\.(?:js|mjs|css|woff2?|ttf|png|jpe?g|gif|svg|webp|ico|json|html|wasm|mp3|mp4))/g;

const toPosix = (p) => p.split(sep).join("/");
const extOf = (p) => (p.lastIndexOf(".") === -1 ? "" : p.slice(p.lastIndexOf(".")).toLowerCase());

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

// The folder under dist/src/ that a plugin owns, taken from its entry page.
export function pluginDirOf(entry) {
  const m = /^src\/([^/]+)\//.exec(entry);
  if (!m) throw new Error(`Entry "${entry}" is not under src/<plugin>/`);
  return `src/${m[1]}`;
}

// Everything the plugin needs: its own folder, plus the hashed chunks / fonts / images in
// dist/assets that those files (transitively) refer to. Shared scripts that live in other
// folders (src/platform, other plugins) are NOT packed: they stay part of the installed app.
export function collectFiles(distRoot, plugin) {
  const dist = resolve(distRoot);
  if (!existsSync(join(dist, plugin.entry))) {
    throw new Error(`Built entry page not found: ${join(dist, plugin.entry)} (run "npm run build" in the app first)`);
  }
  const ownDir = pluginDirOf(plugin.entry);
  const selected = new Map(); // dist-relative posix path -> absolute path
  const queue = [];

  const add = (relPath) => {
    if (selected.has(relPath)) return;
    const abs = join(dist, ...relPath.split("/"));
    if (!existsSync(abs) || !statSync(abs).isFile()) return;
    selected.set(relPath, abs);
    if (TEXT_EXT.has(extOf(relPath))) queue.push(relPath);
  };

  for (const abs of walk(join(dist, ...ownDir.split("/")))) add(toPosix(relative(dist, abs)));

  while (queue.length) {
    const rel = queue.pop();
    const text = readFileSync(selected.get(rel), "utf8");
    const baseDir = posix.dirname(rel);
    for (const match of text.matchAll(REF)) {
      let ref = match[1].split("?")[0].split("#")[0];
      const target = ref.startsWith("/") ? ref.slice(1) : posix.normalize(posix.join(baseDir, ref));
      if (target.startsWith("..")) continue;
      // only files the plugin owns or hashed build output; never another plugin or the platform
      if (target.startsWith("assets/") || target.startsWith(`${ownDir}/`)) add(target);
    }
  }
  return [...selected.keys()].sort();
}

export function buildPackage({ distRoot, plugin, version, minAppVersion }) {
  const dist = resolve(distRoot);
  const paths = collectFiles(dist, plugin);
  const files = paths.map((path) => {
    const bytes = readFileSync(join(dist, ...path.split("/")));
    return { path, size: bytes.length, sha256: sha256Hex(bytes), data: bytes.toString("base64") };
  });
  const contentHash = sha256Hex(files.map((f) => `${f.path}:${f.sha256}`).join("\n"));
  const document = {
    format: PACKAGE_FORMAT,
    id: plugin.id,
    version,
    minAppVersion,
    entry: plugin.entry,
    builtAt: new Date().toISOString(),
    contentHash,
    files
  };
  const bytes = gzipSync(Buffer.from(JSON.stringify(document), "utf8"), { level: 9 });
  return { bytes, sha256: sha256Hex(bytes), size: bytes.length, fileCount: files.length, contentHash };
}
