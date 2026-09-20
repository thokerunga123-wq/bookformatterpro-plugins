# BookFormatter Pro: plugin releases

This repository publishes every BookFormatter Pro plugin as its **own versioned package with a SHA-256
checksum**. The app checks `index.json` on start-up, downloads only the plugins that have a newer
version, verifies the checksum, and installs them next to the app. Users never reinstall the whole
app to get a plugin fix.

The app itself starts at **1.0.0**, and so does every plugin. Each plugin's version changes on its own.

```
plugins.json          the list of plugins, their current version and changelog (edited by the tools)
index.json            what the app reads: latest version, size, SHA-256 and download URL per plugin
packages/<id>/        <id>-<version>.bfpk  and  <id>-<version>.bfpk.sha256
tools/                release.mjs, verify.mjs, list.mjs  (Node 18+, no dependencies)
.github/workflows/    verify on every push; publish a GitHub release when a tag is pushed
```

## Publishing an update (one plugin)

1. Change the plugin in the app project and rebuild the frontend: `npm run build` (in the app folder).
2. In this repo:

   ```powershell
   node tools/release.mjs image-prompt-queue --bump patch --notes "Fixed the export dialog."
   git push origin main --follow-tags
   ```

   `--bump` is `patch`, `minor` or `major`; or use `--version 1.4.0`.
3. Pushing the tag `image-prompt-queue-v1.0.1` runs `publish.yml`, which creates the GitHub release with
   the package and its `.sha256` file. Users get the update the next time the app checks.

Other useful commands:

```powershell
node tools/release.mjs all --changed --bump patch --notes "Maintenance"   # only plugins whose files changed
node tools/list.mjs                                                        # versions and checksums
node tools/verify.mjs                                                      # re-check every package and checksum
```

The app project location defaults to `F:/TAURI APP - REDESIGNED`; use `--app <path>` or the
`BFP_APP_DIR` environment variable to change it.

## What is in a package

A `.bfpk` is a gzip-compressed JSON file: the plugin's own folder plus the hashed build files
(`assets/...`) it refers to, each with its own SHA-256. Shared files (`src/platform`, other plugins,
fonts) stay part of the installed app and are not repeated. `minAppVersion` says which app version a
plugin needs; the app skips a plugin update it is too old for.

## How the checksum protects the user

1. The app downloads `index.json` and compares versions.
2. It downloads the package and computes its SHA-256. If it differs from `index.json`, the file is
   deleted and nothing is installed.
3. While unpacking, every file is checked against its own SHA-256, and any path that tries to leave the
   plugin's folder is rejected.
4. The new version is unpacked beside the old one and switched on only when everything passed. The
   previous version is kept so the user can roll back.

Note that the checksum proves the download is intact and matches what was published. It does not prove
who published it: protect the GitHub account and repository (two-factor login, branch protection).
